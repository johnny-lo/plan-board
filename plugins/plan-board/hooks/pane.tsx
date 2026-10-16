import type { EngineInterface } from 'claude-code'

import { t } from './i18n.ts'
import type { Key, Lang } from './i18n.ts'
import { assignedText, changeLine, fit, foldText, historyLines, stamp, textWidth } from './lines.ts'
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

/** `typing` is what each card's thought field holds now: the field is one row, so the pane echoes the whole text under it. */
export function paneView(elements: Elements, current: Plan, mine: Local, typing: Record<string, string>, lang: Lang, actions: Actions) {
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

  /** One entry of an item's history: a line to press for its reason. */
  const logRow = (itemId: string, entry: Entry, isNested: boolean) => {
    const [line, reason] = historyLines(entry, current, lang)
    const whyKey = `why:${entry.id}`
    return (
      <Box key={`box:log:${itemId}:${entry.id}`} flexDirection="column" paddingLeft={isNested ? 2 : 0}>
        <Button key={`log:${itemId}:${entry.id}`} plain label={line} onPress={() => actions.toggle(whyKey)} />
        {reason !== undefined && mine.expanded.includes(whyKey) && (
          <Box paddingLeft={2}>
            <Text dimColor wrap="wrap">
              {reason}
            </Text>
          </Box>
        )}
      </Box>
    )
  }

  /** A row of an item's history: an entry, or a fold that opens into its entries. */
  const historyRow = (itemId: string, row: Row) => {
    if (row.kind === 'entry') return logRow(itemId, row.entry, false)
    const foldKey = `fold:${row.key}`
    const isOpen = mine.expanded.includes(foldKey)
    const label = `${stamp(row.entries[0].at)} ${isOpen ? '▾' : '▸'} ${foldText(row.entries, lang)}`
    return (
      <Box key={`box:fold:${itemId}:${row.key}`} flexDirection="column">
        <Button key={`fold:${itemId}:${row.key}`} plain label={label} onPress={() => actions.toggle(foldKey)} />
        {isOpen && row.entries.map(entry => logRow(itemId, entry, true))}
      </Box>
    )
  }

  /** A line that opens and closes what sits under it; `key` is what `mine.expanded` keeps. */
  const foldButton = (key: string, label: string) => (
    <Button key={key} plain label={`${mine.expanded.includes(key) ? '▾' : '▸'} ${label}`} onPress={() => actions.toggle(key)} />
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

    const stepRow = (stepId: string) => {
      const step = current.steps[stepId]
      const waiting = open.find(card => card.step === stepId)
      const note =
        waiting === undefined ? evidenceOf(step, lang) : t(lang, waiting.type === 'action' ? 'waitingAction' : 'blockedBy', { question: waiting.question })
      const mark = markOf(step, waiting !== undefined, lang)
      return (
        <Box key={`step:${stepId}`} flexDirection="row" gap={2}>
          {step.repo === undefined ? (
            <Text>{`${mark} ${step.title}`}</Text>
          ) : (
            <Box flexDirection="row" gap={1}>
              <Text>{mark}</Text>
              <Text dimColor>{`${repoLabel(current, step.repo)} ·`}</Text>
              <Text>{step.title}</Text>
            </Box>
          )}
          {step.assignee !== undefined && <Text dimColor>{assignedText(step.assignee, lang)}</Text>}
          {step.note !== undefined && <Text dimColor>{step.note}</Text>}
          {note !== '' && <Text dimColor>{note}</Text>}
        </Box>
      )
    }

    const itemBox = (id: string) => {
      const item = current.items[id]
      const isOpen = mine.expanded.includes(id)
      const hasBlocked = item.steps.some(stepId => blocked.has(stepId))
      const label = `${isOpen ? '▾' : '▸'} ${item.title} · ${t(lang, STATE_KEY[states[id]])}${hasBlocked ? ' ⚑' : ''}`
      // How far each repo is, dimmed after the state; it wraps rather than being cut.
      const progress = repoProgress(current, id)
        .map(row => `· ${repoLabel(current, row.repo)} ${row.done}/${row.total}`)
        .join(' ')
      const itemButton = <Button key={`item:${id}`} plain label={label} onPress={() => actions.toggle(id)} />
      const steps = splitSteps(current, id, blocked)
      const stepsKey = `steps:${id}`
      const logKey = `log:${id}`
      const rows = foldHistory(historyOf(current, id))
      return (
        <Box key={`box:item:${id}`} flexDirection="column">
          {progress === '' ? (
            itemButton
          ) : (
            <Box flexDirection="row" gap={1}>
              {itemButton}
              <Box flexShrink={1}>
                <Text dimColor wrap="wrap">
                  {progress}
                </Text>
              </Box>
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
    const border = (color: string) => ({ borderStyle: 'round', borderColor: color, paddingX: 1 }) as const

    if (isSent(card)) {
      return (
        <Box key={`card:box:${card.id}`} flexDirection="column" {...border('gray')}>
          <Text dimColor wrap="wrap">
            {card.question}
          </Text>
          <Text dimColor wrap="wrap">
            {where}
          </Text>
          <Text dimColor>{t(lang, isAction ? 'sentChecking' : 'sentWaiting')}</Text>
          {isThoughtOnly(mine, card.id) && thought !== undefined && (
            <Text dimColor wrap="wrap">
              {t(lang, 'yourThought', { draft: thought })}
            </Text>
          )}
        </Box>
      )
    }
    if (!isFirst && !mine.expanded.includes(card.id)) {
      return (
        <Box key={`card:box:${card.id}`} flexDirection="column" {...border('gray')}>
          <Button key={`card:${card.id}`} plain label={card.question} onPress={() => actions.toggle(card.id)} />
          <Text dimColor wrap="wrap">
            {where}
          </Text>
        </Box>
      )
    }

    const head = (
      <Box justifyContent="space-between">
        <Box flexShrink={1}>
          {isFirst ? (
            <Text bold wrap="wrap">
              {card.question}
            </Text>
          ) : (
            <Button key={`card:${card.id}`} plain label={card.question} onPress={() => actions.toggle(card.id)} />
          )}
        </Box>
        <Button key={`${card.id}:x`} plain dimColor role="dismiss" label="✕" onPress={() => actions.dismiss(card)} />
      </Box>
    )
    /** The label on a line of its own, the reason indented under it. */
    const whyBox = (label: 'why' | 'actionWhy') => (
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{t(lang, label)}</Text>
        <Box paddingLeft={2}>
          <Text wrap="wrap">{card.why}</Text>
        </Box>
      </Box>
    )
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
      return (
        <Box key={`card:box:${card.id}`} flexDirection="column" {...border(isFirst ? 'yellow' : 'gray')}>
          {head}
          <Text dimColor italic wrap="wrap">
            {where}
          </Text>
          {whyBox('actionWhy')}
          {card.command !== undefined && <Text wrap="wrap">{t(lang, 'command', { command: card.command })}</Text>}
          <Box marginTop={1}>
            <Button key={`${card.id}:done`} plain {...hotkey(0)} label={t(lang, 'actionDone')} onPress={() => actions.choose(card, 'done')} />
          </Box>
          {noteBox}
        </Box>
      )
    }

    const recent = recentFor(current, card, RECENT)
    const recentKey = `recent:${card.id}`
    const hasStaged = staged !== undefined
    return (
      <Box key={`card:box:${card.id}`} flexDirection="column" {...border(hasStaged ? 'green' : isFirst ? 'yellow' : 'gray')}>
        {head}
        <Text dimColor italic wrap="wrap">
          {where}
        </Text>
        {whyBox('why')}
        <Box flexDirection="column" marginTop={1}>
          {card.type === 'proposal' ? (
            <Box flexDirection="column">
              <Button
                key={`${card.id}:approve`}
                plain
                {...hotkey(0)}
                label={`${staged?.choice === 'approve' ? '● ' : ''}${t(lang, 'approve')}`}
                onPress={() => actions.choose(card, 'approve')}
              />
              {(card.changes ?? []).map((change, i) => (
                <Box key={`change:${card.id}:${i}`} paddingLeft={2}>
                  <Text dimColor wrap="wrap">
                    {changeLine(change, current, lang)}
                  </Text>
                </Box>
              ))}
              <Button
                key={`${card.id}:reject`}
                plain
                {...hotkey(1)}
                label={`${staged?.choice === 'reject' ? '● ' : ''}${t(lang, 'reject')}`}
                onPress={() => actions.choose(card, 'reject')}
              />
            </Box>
          ) : (
            card.options.map((option, i) => {
              const mark = staged?.choice === option.label ? '● ' : ''
              const label = `${mark || (isFirst && i < 9 ? '' : '› ')}${option.label}${option.recommended === true ? t(lang, 'recommended') : ''}`
              const effect = option.reason !== undefined && option.reason !== '' ? `${option.effect} · ${option.reason}` : option.effect
              return (
                <Box key={`option:${card.id}:${i}`} flexDirection="column">
                  <Button key={`${card.id}:${i}`} plain {...hotkey(i)} label={label} onPress={() => actions.choose(card, option.label)} />
                  <Box paddingLeft={2}>
                    <Text dimColor wrap="wrap">
                      {effect}
                    </Text>
                  </Box>
                </Box>
              )
            })
          )}
        </Box>
        {hasStaged && (
          <Box justifyContent="space-between" marginTop={1}>
            <Box flexDirection="column" flexShrink={1}>
              {staged.isDismissed === true && (
                <Text color="green" wrap="wrap">
                  {t(lang, 'picked', { choice: t(lang, 'skip') })}
                </Text>
              )}
              {staged.isDismissed !== true && staged.choice !== undefined && (
                <Text color="green" wrap="wrap">
                  {t(lang, 'picked', { choice: pickText(card, staged.choice, lang) })}
                </Text>
              )}
              {staged.draft !== undefined && (
                <Text color="green" wrap="wrap">
                  {t(lang, 'drafted', { draft: staged.draft })}
                </Text>
              )}
            </Box>
            <Button key={`${card.id}:clear`} plain dimColor label={t(lang, 'clear')} onPress={() => actions.clear(card)} />
          </Box>
        )}
        {recent.length > 0 && (
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
        )}
        {noteBox}
      </Box>
    )
  }

  const cards = () => {
    if (open.length === 0) return <Text color="green">{t(lang, 'nothingWaiting')}</Text>
    return <Box flexDirection="column">{open.map(card => cardBox(card))}</Box>
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1} marginBottom={1}>
        <Button
          key="view:overview"
          variant={mine.view === 'overview' ? 'primary' : 'secondary'}
          label={t(lang, 'viewOverview')}
          onPress={() => actions.show('overview')}
        />
        <Button
          key="view:cards"
          variant={mine.view === 'cards' ? 'primary' : 'secondary'}
          label={t(lang, 'viewCards', { n: counts.waiting })}
          onPress={() => actions.show('cards')}
        />
      </Box>
      {counts.isEdited && (
        <Text color="yellow" wrap="wrap">
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

/** The line above the prompt: the plan's counts and a button for the pane, over what the mods after this one drew there. */
export function bandView(elements: Elements, current: Plan, mine: Local, lang: Lang, columns: number, open: () => unknown, theirs?: unknown) {
  const counts = bandCounts(current, mine)
  const text = t(lang, 'band', { doing: counts.doing, waiting: counts.waiting })
  const line = counts.isEdited ? `${text} ${t(lang, 'editedBand')}` : text
  const { Box, Text, Button } = elements
  const label = t(lang, 'open')
  // The Button draws as `[ label ]`, one cell of gap before it.
  const room = Math.max(0, columns - textWidth(label) - 5)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text>{fit(line, room)}</Text>
        <Button key="open" label={label} onPress={() => open()} />
      </Box>
      {theirs ?? null}
    </Box>
  )
}
