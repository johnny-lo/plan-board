import type { EngineInterface } from 'claude-code'

import { t } from './i18n.ts'
import type { Key, Lang } from './i18n.ts'
import { assignedText, changeLine, fit, foldText, historyLines, stamp, textWidth } from './lines.ts'
import { TONE, bar, barCells, pill, pillWidth, stripe } from './look.tsx'
import type { Tone } from './look.tsx'
import {
  bandCounts,
  blockedSteps,
  cardPosition,
  entryCount,
  foldHistory,
  historyOf,
  isAnswered,
  isThoughtOnly,
  itemStates,
  openCards,
  recentFor,
  repoLabel,
  repoProgress,
  splitItems,
  splitSteps,
} from './view.ts'
import type { Row } from './view.ts'
import type { Card, Entry, ItemState, Local, Plan, Step } from '../types'

/** How many earlier entries a card shows. */
const RECENT = 3

/** The widest an item's name gets in the line that says where a card sits. */
const CRUMB_ITEM = 20

/** The elements of the surface being drawn, as `$.ui.resolve(e)` hands them over. */
export type Elements = ReturnType<EngineInterface['ui']['resolve']>

/** What a Box may hold, for the parts handed to the pieces that draw a frame or a toggle. */
type Children = Parameters<Elements['Box']>[0]['children']

/** What a press or an input in the pane does; register.tsx owns `$`, so it supplies these. */
export type Actions = {
  toggle: (id: string) => unknown
  show: (view: Local['view']) => unknown
  choose: (card: Card, choice: string) => unknown
  dismiss: (card: Card) => unknown
  think: (card: Card, text: string) => unknown
  type: (card: Card, text: string) => unknown
  clear: (card: Card) => unknown
  send: () => unknown
}

const STATE_KEY: Record<ItemState, Key> = { done: 'stateDone', doing: 'stateDoing', next: 'stateNext', later: 'stateLater' }

function evidenceOf(step: Step, lang: Lang): string {
  if (step.status !== 'done' || step.evidence === undefined) return ''
  if (step.evidence.thoth !== undefined) return t(lang, 'evidenceThoth')
  if (step.evidence.result !== undefined) return t(lang, 'evidenceResult', { result: step.evidence.result })
  return ''
}

function markOf(step: Step, isBlocked: boolean, lang: Lang): string {
  if (isBlocked) return t(lang, 'markBlocked')
  if (step.status === 'done') return t(lang, 'markDone')
  return t(lang, step.status === 'doing' ? 'markDoing' : 'markTodo')
}

/** Where a card sits as a breadcrumb: item › step, with the step's repo before the step. */
function whereText(current: Plan, card: Card, lang: Lang): string {
  const where = cardPosition(current, card)
  if (where.item === undefined) return t(lang, 'posOther')
  const item = fit(where.item.title, CRUMB_ITEM)
  if (where.step === undefined) return t(lang, 'posItem', { item })
  const vars = { item, step: where.step.title }
  return where.step.repo === undefined ? t(lang, 'posStep', vars) : t(lang, 'posStepRepo', { ...vars, repo: repoLabel(current, where.step.repo) })
}

/** The label a staged pick is shown under: proposals and skips have words of their own. */
function pickText(card: Card, choice: string | undefined, lang: Lang): string {
  if (card.type === 'proposal' && choice === 'approve') return t(lang, 'approve')
  if (card.type === 'proposal' && choice === 'reject') return t(lang, 'reject')
  return choice ?? ''
}

/** `typing` is what each card's thought field holds now: the field is one row, so the pane echoes the whole text under it.
 *  `columns` is the pane's body width, which sets how wide the progress bars are. */
export function paneView(elements: Elements, current: Plan, mine: Local, typing: Record<string, string>, lang: Lang, columns: number, actions: Actions) {
  const { Box, Text, Button } = elements
  // Mobile has no Input element; the card then offers the options alone.
  const Input = 'Input' in elements ? elements.Input : undefined
  const open = openCards(current)
  const counts = bandCounts(current, mine)
  const stagedCount = open.filter(card => Object.hasOwn(mine.staged, card.id)).length
  // A card the user answered (a choice, a skip or a thought) is dimmed until the AI closes it.
  const isSent = (card: Card): boolean => isAnswered(mine, card.id)
  // The card that opens by itself is the first one still waiting for the user.
  const firstId = open.find(card => !isSent(card))?.id
  const localLine = current.storage === 'local' ? <Text dimColor wrap="wrap">{t(lang, 'localMode')}</Text> : null

  /** One entry of an item's history: a line to press for its reason, and its detail under the reason.
   *  The line draws its time dim and, when it opens to something, a dim arrow at the end; its label is the whole line. */
  const logRow = (itemId: string, entry: Entry, isNested: boolean) => {
    const [line, reason] = historyLines(entry, current, lang)
    const whyKey = `why:${entry.id}`
    const isOpen = mine.expanded.includes(whyKey)
    const detail = entry.detail ?? ''
    const time = stamp(entry.at)
    const opens = reason !== undefined || detail !== ''
    return (
      <Box key={`box:log:${itemId}:${entry.id}`} flexDirection="column" paddingLeft={isNested ? 2 : 0}>
        <Button key={`log:${itemId}:${entry.id}`} plain label={line} onPress={() => actions.toggle(whyKey)}>
          <Text dimColor>{time}</Text>
          {line.slice(time.length)}
          {opens && <Text dimColor>{` ${isOpen ? '▾' : '▸'}`}</Text>}
        </Button>
        {reason !== undefined && isOpen && (
          <Box paddingLeft={2}>
            <Text dimColor wrap="wrap">
              {reason}
            </Text>
          </Box>
        )}
        {isOpen && detail !== '' && detailBlock(whyKey, detail, 4)}
      </Box>
    )
  }

  /** A row of an item's history: an entry, or a fold that opens into its entries. */
  const historyRow = (itemId: string, row: Row) => {
    if (row.kind === 'entry') return logRow(itemId, row.entry, false)
    const foldKey = `fold:${row.key}`
    const isOpen = mine.expanded.includes(foldKey)
    const time = stamp(row.entries[0].at)
    const rest = `${isOpen ? '▾' : '▸'} ${foldText(row.entries, lang)}`
    return (
      <Box key={`box:fold:${itemId}:${row.key}`} flexDirection="column">
        <Button key={`fold:${itemId}:${row.key}`} plain label={`${time} ${rest}`} onPress={() => actions.toggle(foldKey)}>
          <Text dimColor>{time}</Text>
          {` ${rest}`}
        </Button>
        {isOpen && row.entries.map(entry => logRow(itemId, entry, true))}
      </Box>
    )
  }

  /** A dim line that opens and closes what sits under it; `key` is what `mine.expanded` keeps. */
  const foldButton = (key: string, label: string) => (
    <Button key={key} plain dimColor label={`${mine.expanded.includes(key) ? '▾' : '▸'} ${label}`} onPress={() => actions.toggle(key)} />
  )

  /** The one control that opens and closes a detail: a plain Button keyed `key` (also its key in mine.expanded), ▸ closed and ▾ open,
   *  before the label or after it; after an empty label it is the arrow alone. No hotkey.
   *  On its own it is dim. Given `parts` (a step's coloured mark and title), it draws them and a dim arrow after them; the label stays the words. */
  const detailToggle = (key: string, label: string, place: 'before' | 'after', parts?: Children[]) => {
    const arrow = mine.expanded.includes(key) ? '▾' : '▸'
    const text = label === '' ? arrow : place === 'before' ? `${arrow} ${label}` : `${label} ${arrow}`
    if (parts === undefined) return <Button key={key} plain dimColor label={text} onPress={() => actions.toggle(key)} />
    return (
      <Button key={key} plain label={text} onPress={() => actions.toggle(key)}>
        {parts}
        <Text dimColor>{` ${arrow}`}</Text>
      </Button>
    )
  }

  /**
   * The one place a detail is drawn: its text starts `indent` cells in, one dim wrapping Text per line (keys `${key}:${n}`), a blank line as ' ';
   * the two cells left of the text hold an inactive bar (`bar:${key}`) and a space, so the detail reads as a block of its own.
   * Fallback (R5 fails): drop the stripe and the inner padding and give the outer Box `paddingLeft={indent}`, as 0.5.0 drew it.
   */
  const detailBlock = (key: string, detail: string, indent: number) => (
    <Box key={`box:${key}`} flexDirection="row" alignItems="stretch" paddingLeft={indent - 2}>
      {stripe(elements, `bar:${key}`, TONE.neutral)}
      <Box flexDirection="column" flexShrink={1} paddingLeft={1}>
        {detail.split('\n').map((line, n) => (
          <Text key={`${key}:${n}`} dimColor wrap="wrap">
            {line === '' ? ' ' : line}
          </Text>
        ))}
      </Box>
    </Box>
  )

  /**
   * The one place a card's frame is drawn: a row Box (`card:box:<id>`) with a 1-cell line in the card's tone (`card:line:<id>`) beside
   * its body (`card:body:<id>`, a column one cell in from the line), and a blank row under it. Both surfaces draw the line.
   * Fallback (R6: the desktop does not draw the line): pass the surface in and, for the desktop, drop the stripe and give the card Box
   * `borderStyle="round" borderColor={tone} paddingX={1}` instead.
   */
  const cardFrame = (card: Card, tone: Tone, body: Children[]) => (
    <Box key={`card:box:${card.id}`} flexDirection="row" alignItems="stretch" marginBottom={1}>
      {stripe(elements, `card:line:${card.id}`, tone)}
      <Box key={`card:body:${card.id}`} flexDirection="column" flexGrow={1} flexShrink={1} paddingLeft={1}>
        {body}
      </Box>
    </Box>
  )

  const overview = () => {
    if (current.order.length === 0) {
      return (
        <Box flexDirection="column">
          {localLine}
          <Text dimColor>{t(lang, 'emptyRepo')}</Text>
        </Box>
      )
    }
    const states = itemStates(current)
    const blocked = blockedSteps(current)

    /** A step: its mark in colour and its title (and the repo, dim, between them), who it is given to on the right;
     *  four cells in under it its note, what waits for the user or what the AI or Thoth reported; then its detail when open. */
    const stepRow = (stepId: string) => {
      const step = current.steps[stepId]
      const waiting = open.find(card => card.step === stepId)
      const waitText = waiting === undefined ? '' : t(lang, waiting.type === 'action' ? 'waitingAction' : 'blockedBy', { question: waiting.question })
      const report = waiting === undefined ? evidenceOf(step, lang) : ''
      const mark = markOf(step, waiting !== undefined, lang)
      const markTone = waiting !== undefined ? TONE.waiting : step.status === 'done' ? TONE.done : step.status === 'doing' ? TONE.doing : undefined
      const markText = markTone === undefined ? <Text dimColor>{mark}</Text> : <Text color={markTone}>{mark}</Text>
      const titleText = step.status === 'doing' ? <Text bold>{step.title}</Text> : <Text dimColor>{step.title}</Text>
      // A step with a detail draws its title as the toggle (route A): with no repo the mark is pressed too, with one only the title.
      const detail = step.detail ?? ''
      const detailKey = `detail:${stepId}`
      const left =
        step.repo === undefined ? (
          <Box flexShrink={1}>
            {detail === '' ? (
              <Text wrap="wrap">
                {markText} {titleText}
              </Text>
            ) : (
              detailToggle(detailKey, `${mark} ${step.title}`, 'after', [markText, ' ', titleText])
            )}
          </Box>
        ) : (
          <Box flexDirection="row" gap={1} flexShrink={1}>
            {markText}
            <Text dimColor>{`${repoLabel(current, step.repo)} ·`}</Text>
            {detail === '' ? titleText : detailToggle(detailKey, step.title, 'after', [titleText])}
          </Box>
        )
      const hasBelow = step.note !== undefined || waitText !== '' || report !== ''
      return (
        <Box key={`box:step:${stepId}`} flexDirection="column">
          <Box key={`step:${stepId}`} flexDirection="row" justifyContent="space-between" gap={2}>
            {left}
            {step.assignee !== undefined && (
              <Box flexShrink={0}>
                <Text dimColor>{assignedText(step.assignee, lang)}</Text>
              </Box>
            )}
          </Box>
          {hasBelow && (
            <Box flexDirection="column" paddingLeft={4}>
              {step.note !== undefined && (
                <Text dimColor wrap="wrap">
                  {step.note}
                </Text>
              )}
              {waitText !== '' && (
                <Text color={TONE.waiting} wrap="wrap">
                  {waitText}
                </Text>
              )}
              {report !== '' && (
                <Text dimColor wrap="wrap">
                  {report}
                </Text>
              )}
            </Box>
          )}
          {detail !== '' && mine.expanded.includes(detailKey) && detailBlock(detailKey, detail, 2)}
        </Box>
      )
    }

    /** What an item's right side says of its state: a pill in progress or done, plain words next, dim words later. */
    const stateLook = (state: ItemState) => {
      const words = t(lang, STATE_KEY[state])
      if (state === 'doing') return pill(elements, words, TONE.doing)
      if (state === 'done') return pill(elements, words, TONE.done)
      return state === 'next' ? <Text>{words}</Text> : <Text dimColor>{words}</Text>
    }

    /** An item: its toggle (arrow, bold title, amber ⚑ while a card waits) on the left; its state, progress bar and done/total on the right;
     *  under it each repo's done/total, dim, folded or open. Open, its goal, docs, steps and history follow, and a blank row. */
    const itemBox = (id: string) => {
      const item = current.items[id]
      const state = states[id]
      const isOpen = mine.expanded.includes(id)
      const hasBlocked = item.steps.some(stepId => blocked.has(stepId))
      const arrow = isOpen ? '▾' : '▸'
      const label = `${arrow} ${item.title} · ${t(lang, STATE_KEY[state])}${hasBlocked ? ' ⚑' : ''}`
      // How far each repo is; it wraps rather than being cut.
      const progress = repoProgress(current, id)
        .map(row => `${repoLabel(current, row.repo)} ${row.done}/${row.total}`)
        .join(' · ')
      const steps = splitSteps(current, id, blocked)
      const total = steps.open.length + steps.done.length
      const done = [...steps.open, ...steps.done].filter(stepId => current.steps[stepId].status === 'done').length
      const stepsKey = `steps:${id}`
      const logKey = `log:${id}`
      const rows = foldHistory(historyOf(current, id))
      return (
        <Box key={`box:item:${id}`} flexDirection="column" {...(isOpen ? { marginBottom: 1 } : {})}>
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Box flexShrink={1}>
              <Button key={`item:${id}`} plain label={label} onPress={() => actions.toggle(id)}>
                {`${arrow} `}
                <Text bold>{item.title}</Text>
                {hasBlocked && <Text color={TONE.waiting}> ⚑</Text>}
              </Button>
            </Box>
            <Box key={`state:${id}`} flexShrink={0} gap={1}>
              {stateLook(state)}
              {total > 0 && bar(elements, done, total, barCells(columns), state === 'done' ? TONE.done : TONE.doing)}
              {total > 0 && <Text>{`${done}/${total}`}</Text>}
            </Box>
          </Box>
          {progress !== '' && (
            <Box paddingLeft={2}>
              <Text dimColor wrap="wrap">
                {progress}
              </Text>
            </Box>
          )}
          {isOpen && (
            <Box flexDirection="column" paddingLeft={2}>
              <Text wrap="wrap">{t(lang, 'goal', { goal: item.goal })}</Text>
              {item.docs.map((doc, i) => (
                <Text key={`doc:${id}:${i}`} wrap="wrap">
                  {t(lang, 'doc', { path: doc })}
                </Text>
              ))}
              {steps.open.map(stepRow)}
              {steps.done.length > 0 && foldButton(stepsKey, t(lang, 'doneSteps', { n: steps.done.length }))}
              {steps.done.length > 0 && mine.expanded.includes(stepsKey) && (
                <Box flexDirection="column" paddingLeft={2}>
                  {steps.done.map(stepRow)}
                </Box>
              )}
              {rows.length > 0 && foldButton(logKey, t(lang, 'logFold', { n: entryCount(rows) }))}
              {rows.length > 0 && mine.expanded.includes(logKey) && (
                <Box flexDirection="column" paddingLeft={2}>
                  {rows.map(row => historyRow(id, row))}
                </Box>
              )}
            </Box>
          )}
        </Box>
      )
    }

    const items = splitItems(current, states, blocked)
    return (
      <Box flexDirection="column">
        {localLine}
        {items.open.map(itemBox)}
        {items.done.length > 0 && foldButton('group:done', t(lang, 'doneItems', { n: items.done.length }))}
        {items.done.length > 0 && mine.expanded.includes('group:done') && (
          <Box flexDirection="column" paddingLeft={2}>
            {items.done.map(itemBox)}
          </Box>
        )}
      </Box>
    )
  }

  const cardBox = (card: Card) => {
    const where = whereText(current, card, lang)
    const staged = Object.hasOwn(mine.staged, card.id) ? mine.staged[card.id] : undefined
    const thought = Object.hasOwn(mine.sent, card.id) ? mine.sent[card.id].draft : undefined
    const isFirst = card.id === firstId
    const isAction = card.type === 'action'
    // An action card is answered at once, as a blocking one is.
    const isNow = card.blocking === true || isAction
    const hotkey = (i: number) => (isFirst && i < 9 ? { hotkey: String(i + 1) } : {})
    const isStaged = staged !== undefined
    // The line's colour: sent faint, staged green (before first), the first amber, the others grey.
    const tone: Tone = isSent(card) ? TONE.sent : isStaged ? TONE.done : isFirst ? TONE.waiting : TONE.neutral

    if (isSent(card)) {
      return cardFrame(card, tone, [
        <Text dimColor wrap="wrap">
          {card.question}
        </Text>,
        <Text dimColor wrap="wrap">
          {where}
        </Text>,
        <Text dimColor>{t(lang, isAction ? 'sentChecking' : 'sentWaiting')}</Text>,
        isThoughtOnly(mine, card.id) && thought !== undefined && (
          <Text dimColor wrap="wrap">
            {t(lang, 'yourThought', { draft: thought })}
          </Text>
        ),
      ])
    }
    if (!isFirst && !mine.expanded.includes(card.id)) {
      return cardFrame(card, tone, [
        <Button key={`card:${card.id}`} plain label={card.question} onPress={() => actions.toggle(card.id)}>
          {`▸ ${card.question}`}
        </Button>,
        <Text dimColor wrap="wrap">
          {where}
        </Text>,
      ])
    }

    // An open card's first row names what it asks of the user, the first card's as an amber pill, with the ✕ on the right.
    const kind = t(lang, isAction ? 'headAction' : card.type === 'proposal' ? 'headProposal' : card.blocking === true ? 'headDecideNow' : 'headDecide')
    const head = (
      <Box key={`card:head:${card.id}`} justifyContent="space-between">
        <Box flexShrink={1}>{isFirst ? pill(elements, kind, TONE.waiting) : <Text color={tone}>{kind}</Text>}</Box>
        <Button key={`${card.id}:x`} plain dimColor role="dismiss" label="✕" onPress={() => actions.dismiss(card)} />
      </Box>
    )
    const crumb = (
      <Text dimColor italic wrap="wrap">
        {where}
      </Text>
    )
    const questionRow = isFirst ? (
      <Text bold wrap="wrap">
        {card.question}
      </Text>
    ) : (
      <Button key={`card:${card.id}`} plain label={card.question} onPress={() => actions.toggle(card.id)} />
    )
    /** The label, dim, and the reason in one wrapping Text. */
    const whyLine = (label: 'why' | 'actionWhy') => (
      <Text wrap="wrap">
        <Text dimColor>{t(lang, label)}</Text>
        {`${lang === 'zh-TW' ? '' : ' '}${card.why}`}
      </Text>
    )
    /** A choice's look: green after "● " once picked; the label stays the words as they were. */
    const choiceLook = (words: string, isPicked: boolean) => (isPicked ? <Text color={TONE.done}>{`● ${words}`}</Text> : <Text>{words}</Text>)
    // A card's details open under one toggle, kept as detail:<card id>; sent and folded cards returned above, so they draw none.
    const detailKey = `detail:${card.id}`
    const isDetailOpen = mine.expanded.includes(detailKey)
    const cardDetail = card.detail ?? ''
    const typed = Object.hasOwn(typing, card.id) ? typing[card.id] : ''
    const noteBox = Input && (
      <Box flexDirection="column" marginTop={1}>
        <Input
          key={`${card.id}:note`}
          placeholder={t(lang, isNow ? 'notePlaceholderNow' : 'notePlaceholderStaged')}
          submitLabel={t(lang, isNow ? 'noteNow' : 'noteStaged')}
          onInput={(value: string) => actions.type(card, value)}
          onSubmit={(value: string) => actions.think(card, value)}
        />
        {typed.trim() !== '' && (
          <Text dimColor wrap="wrap">
            {t(lang, 'typing', { text: typed })}
          </Text>
        )}
      </Box>
    )

    if (isAction) {
      return cardFrame(card, tone, [
        head,
        crumb,
        questionRow,
        whyLine('actionWhy'),
        cardDetail !== '' && detailToggle(detailKey, t(lang, 'details'), 'before'),
        cardDetail !== '' && isDetailOpen && detailBlock(detailKey, cardDetail, 2),
        card.command !== undefined && <Text wrap="wrap">{t(lang, 'command', { command: card.command })}</Text>,
        <Box marginTop={1}>
          <Button key={`${card.id}:done`} plain {...hotkey(0)} label={t(lang, 'actionDone')} onPress={() => actions.choose(card, 'done')} />
        </Box>,
        noteBox,
      ])
    }

    const recent = recentFor(current, card, RECENT)
    const recentKey = `recent:${card.id}`
    // One toggle opens every option's detail at once, so they can be compared side by side.
    const hasOptionDetails = card.type !== 'proposal' && card.options.some(option => (option.detail ?? '') !== '')
    const isApproved = staged?.choice === 'approve'
    const isRejected = staged?.choice === 'reject'
    return cardFrame(card, tone, [
      head,
      crumb,
      questionRow,
      whyLine('why'),
      <Box flexDirection="column" marginTop={1}>
        {hasOptionDetails && detailToggle(detailKey, t(lang, 'optionDetails'), 'before')}
        {card.type === 'proposal' ? (
          <Box flexDirection="column">
            <Button
              key={`${card.id}:approve`}
              plain
              {...hotkey(0)}
              label={`${isApproved ? '● ' : ''}${t(lang, 'approve')}`}
              onPress={() => actions.choose(card, 'approve')}
            >
              {choiceLook(t(lang, 'approve'), isApproved)}
            </Button>
            {(card.changes ?? []).map((change, i) => (
              <Box key={`change:${card.id}:${i}`} paddingLeft={2}>
                <Text dimColor wrap="wrap">
                  {changeLine(change, current, lang)}
                </Text>
              </Box>
            ))}
            {cardDetail !== '' && <Box paddingLeft={2}>{detailToggle(detailKey, t(lang, 'details'), 'before')}</Box>}
            {cardDetail !== '' && isDetailOpen && detailBlock(detailKey, cardDetail, 4)}
            <Button
              key={`${card.id}:reject`}
              plain
              {...hotkey(1)}
              label={`${isRejected ? '● ' : ''}${t(lang, 'reject')}`}
              onPress={() => actions.choose(card, 'reject')}
            >
              {choiceLook(t(lang, 'reject'), isRejected)}
            </Button>
          </Box>
        ) : (
          card.options.map((option, i) => {
            const isPicked = staged?.choice === option.label
            const isNumbered = isFirst && i < 9
            // The engine draws "1:" before a numbered option; the others start with "›".
            const name = `${isNumbered ? '' : '› '}${option.label}`
            const label = `${isPicked ? '● ' : isNumbered ? '' : '› '}${option.label}${option.recommended === true ? t(lang, 'recommended') : ''}`
            const effect = option.reason !== undefined && option.reason !== '' ? `${option.effect} · ${option.reason}` : option.effect
            const optionDetail = option.detail ?? ''
            return (
              <Box key={`option:${card.id}:${i}`} flexDirection="column">
                <Button key={`${card.id}:${i}`} plain {...hotkey(i)} label={label} onPress={() => actions.choose(card, option.label)}>
                  {choiceLook(isPicked ? option.label : name, isPicked)}
                  {option.recommended === true && ' '}
                  {option.recommended === true && pill(elements, t(lang, 'recommendedPill'), TONE.doing)}
                </Button>
                {/* The effect starts under the name's first character: after "1: " or after "› ". */}
                <Box paddingLeft={isNumbered ? 3 : 2}>
                  <Text dimColor wrap="wrap">
                    {effect}
                  </Text>
                </Box>
                {isDetailOpen && optionDetail !== '' && detailBlock(`${detailKey}:${i}`, optionDetail, 4)}
              </Box>
            )
          })
        )}
      </Box>,
      staged !== undefined && (
          <Box justifyContent="space-between" marginTop={1}>
            <Box flexDirection="column" flexShrink={1}>
              {staged.isDismissed === true && (
                <Text color={TONE.done} wrap="wrap">
                  {t(lang, 'picked', { choice: t(lang, 'skip') })}
                </Text>
              )}
              {staged.isDismissed !== true && staged.choice !== undefined && (
                <Text color={TONE.done} wrap="wrap">
                  {t(lang, 'picked', { choice: pickText(card, staged.choice, lang) })}
                </Text>
              )}
              {staged.draft !== undefined && (
                <Text color={TONE.done} wrap="wrap">
                  {t(lang, 'drafted', { draft: staged.draft })}
                </Text>
              )}
            </Box>
            <Button key={`${card.id}:clear`} plain dimColor label={t(lang, 'clear')} onPress={() => actions.clear(card)} />
          </Box>
        ),
      recent.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {foldButton(recentKey, t(lang, 'recent', { n: recent.length }))}
          {mine.expanded.includes(recentKey) &&
            recent.map(row =>
              row.kind === 'entry' ? (
                logRow(card.id, row.entry, true)
              ) : (
                <Box key={`recent:${card.id}:${row.key}`} paddingLeft={2}>
                  <Text dimColor wrap="wrap">{`${stamp(row.entries[0].at)} ${foldText(row.entries, lang)}`}</Text>
                </Box>
              ),
            )}
        </Box>
      ),
      noteBox,
    ])
  }

  const cards = () => {
    if (open.length === 0) return <Text color={TONE.done}>{t(lang, 'nothingWaiting')}</Text>
    return <Box flexDirection="column">{open.map(card => cardBox(card))}</Box>
  }

  /**
   * A tab: a plain Button keyed `view:<view>`, its label as before. The chosen one draws a blue pill; the other draws its words,
   * in `look` (the waiting tab amber while something waits, dim when nothing does).
   * Fallback (R3 fails): drop the children and `plain` and give the Button `variant={isOn ? 'primary' : 'secondary'}`, as 0.5.x drew it.
   */
  const tab = (view: Local['view'], label: string, look: { color?: Tone; dimColor?: boolean }) => {
    const isOn = mine.view === view
    return (
      <Button key={`view:${view}`} plain label={label} onPress={() => actions.show(view)}>
        {isOn ? pill(elements, label, TONE.doing) : <Text {...look}>{label}</Text>}
      </Button>
    )
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1} marginBottom={1}>
        {tab('overview', t(lang, 'viewOverview'), {})}
        {tab('cards', t(lang, 'viewCards', { n: counts.waiting }), counts.waiting > 0 ? { color: TONE.waiting } : { dimColor: true })}
      </Box>
      {counts.isEdited && (
        <Text color={TONE.waiting} wrap="wrap">
          {t(lang, 'editedPane')}
        </Text>
      )}
      {stagedCount > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Button key="send" variant="primary" hotkey="s" label={t(lang, 'send', { n: stagedCount })} onPress={() => actions.send()} />
          <Text dimColor wrap="wrap">
            {t(lang, 'sendNote')}
          </Text>
        </Box>
      )}
      {mine.view === 'cards' ? cards() : overview()}
    </Box>
  )
}

/** Whether there is nothing to say above the prompt: no items, no open cards, no hand-edited lines. */
export const isBandEmpty = (current: Plan): boolean => current.order.length === 0 && openCards(current).length === 0 && current.flagged.length === 0

/** The line above the prompt: the plan's counts and a button for the pane, over what the mods after this one drew there.
 *  With room, "Plan", a blue pill for what is in progress, an amber pill for what waits (dim words when nothing does) and an amber
 *  warning after a direct edit, with Open on the right; without, the single line of 0.5.x, cut to fit. */
export function bandView(elements: Elements, current: Plan, mine: Local, lang: Lang, columns: number, open: () => unknown, theirs?: unknown) {
  const counts = bandCounts(current, mine)
  const { Box, Text, Button } = elements
  const label = t(lang, 'open')
  // The Button draws as `[ label ]`, one cell of gap before it.
  const room = Math.max(0, columns - textWidth(label) - 5)
  const title = t(lang, 'bandTitle')
  const doing = t(lang, 'bandDoing', { n: counts.doing })
  const waiting = t(lang, 'bandWaiting', { n: counts.waiting })
  const edited = t(lang, 'bandEdited')
  const cells = [
    textWidth(title),
    pillWidth(textWidth(doing)),
    counts.waiting > 0 ? pillWidth(textWidth(waiting)) : textWidth(waiting),
    ...(counts.isEdited ? [textWidth(edited)] : []),
  ]
  const fits = cells.reduce((sum, n) => sum + n, 0) + cells.length - 1 <= room
  const text = t(lang, 'band', { doing: counts.doing, waiting: counts.waiting })
  const line = counts.isEdited ? `${text} ${t(lang, 'editedBand')}` : text
  return (
    <Box flexDirection="column">
      {fits ? (
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Box key="band:line" flexDirection="row" gap={1} flexShrink={1}>
            <Text>{title}</Text>
            {pill(elements, doing, TONE.doing)}
            {counts.waiting > 0 ? pill(elements, waiting, TONE.waiting) : <Text dimColor>{waiting}</Text>}
            {counts.isEdited && <Text color={TONE.waiting}>{edited}</Text>}
          </Box>
          <Button key="open" label={label} onPress={() => open()} />
        </Box>
      ) : (
        <Box flexDirection="row" gap={1}>
          <Text>{fit(line, room)}</Text>
          <Button key="open" label={label} onPress={() => open()} />
        </Box>
      )}
      {theirs ?? null}
    </Box>
  )
}
