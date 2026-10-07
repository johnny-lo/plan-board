import type { EngineInterface } from 'claude-code'

import { t } from './i18n.ts'
import type { Key, Lang } from './i18n.ts'
import { changeLine, fit, historyLines, textWidth } from './lines.ts'
import { bandCounts, blockedSteps, cardPosition, historyOf, itemStates, openCards, recentFor } from './view.ts'
import type { Card, ItemState, Local, Plan, Step } from '../types'

/** How many earlier entries a card shows. */
const RECENT = 3

/** The elements of the surface being drawn, as `$.ui.resolve(e)` hands them over. */
export type Elements = ReturnType<EngineInterface['ui']['resolve']>

/** What a press or an input in the pane does; register.tsx owns `$`, so it supplies these. */
export type Actions = {
  toggle: (id: string) => unknown
  show: (view: Local['view']) => unknown
  choose: (card: Card, choice: string) => unknown
  dismiss: (card: Card) => unknown
  think: (card: Card, text: string) => unknown
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

function whereText(current: Plan, card: Card, lang: Lang): string {
  const where = cardPosition(current, card)
  if (where.item === undefined) return t(lang, 'posOther')
  const n = where.index ?? 0
  return where.step === undefined
    ? t(lang, 'posItem', { item: where.item.title, n })
    : t(lang, 'posStep', { item: where.item.title, n, step: where.step.title })
}

/** The label a staged pick is shown under: proposals and skips have words of their own. */
function pickText(card: Card, choice: string | undefined, lang: Lang): string {
  if (card.type === 'proposal' && choice === 'approve') return t(lang, 'approve')
  if (card.type === 'proposal' && choice === 'reject') return t(lang, 'reject')
  return choice ?? ''
}

export function paneView(elements: Elements, current: Plan, mine: Local, lang: Lang, actions: Actions) {
  const { Box, Text, Button } = elements
  // Mobile has no Input element; the card then offers the options alone.
  const Input = 'Input' in elements ? elements.Input : undefined
  const open = openCards(current)
  const counts = bandCounts(current, mine)
  const stagedCount = open.filter(card => Object.hasOwn(mine.staged, card.id)).length
  const isSent = (card: Card): boolean => Object.hasOwn(mine.sent, card.id)
  // The card that opens by itself is the first one still waiting for the user.
  const firstId = open.find(card => !isSent(card))?.id

  const overview = () => {
    if (current.order.length === 0) return <Text dimColor>{t(lang, 'emptyRepo')}</Text>
    const states = itemStates(current)
    const blocked = blockedSteps(current)
    return (
      <Box flexDirection="column">
        {current.order.map(id => {
          const item = current.items[id]
          const isOpen = mine.expanded.includes(id)
          const hasBlocked = item.steps.some(stepId => blocked.has(stepId))
          const label = `${isOpen ? '▾' : '▸'} ${item.title} · ${t(lang, STATE_KEY[states[id]])}${hasBlocked ? ' ⚑' : ''}`
          return (
            <Box key={`box:item:${id}`} flexDirection="column">
              <Button key={`item:${id}`} plain label={label} onPress={() => actions.toggle(id)} />
              {isOpen && (
                <Box flexDirection="column" paddingLeft={2}>
                  <Text wrap="wrap">{t(lang, 'goal', { goal: item.goal })}</Text>
                  {item.steps
                    .filter(stepId => Object.hasOwn(current.steps, stepId))
                    .map(stepId => {
                      const step = current.steps[stepId]
                      const waiting = open.find(card => card.step === stepId)
                      const note = waiting === undefined ? evidenceOf(step, lang) : t(lang, 'blockedBy', { question: waiting.question })
                      return (
                        <Box key={`step:${stepId}`} flexDirection="row" gap={2}>
                          <Text>{`${markOf(step, waiting !== undefined, lang)} ${step.title}`}</Text>
                          {note !== '' && <Text dimColor>{note}</Text>}
                        </Box>
                      )
                    })}
                  <Text dimColor>{t(lang, 'logRule')}</Text>
                  {historyOf(current, id).map(entry => {
                    const lines = historyLines(entry, current, lang)
                    return (
                      <Box key={`log:${id}:${entry.id}`} flexDirection="column">
                        <Text wrap="wrap">{lines[0]}</Text>
                        {lines.length > 1 && (
                          <Box paddingLeft={2}>
                            <Text dimColor wrap="wrap">
                              {lines[1]}
                            </Text>
                          </Box>
                        )}
                      </Box>
                    )
                  })}
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )
  }

  const cardBox = (card: Card) => {
    const where = whereText(current, card, lang)
    const staged = Object.hasOwn(mine.staged, card.id) ? mine.staged[card.id] : undefined
    const isFirst = card.id === firstId
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
          <Text dimColor>{t(lang, 'sentWaiting')}</Text>
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

    const recent = recentFor(current, card, RECENT)
    const hasStaged = staged !== undefined
    return (
      <Box key={`card:box:${card.id}`} flexDirection="column" {...border(hasStaged ? 'green' : isFirst ? 'yellow' : 'gray')}>
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
        <Text dimColor italic wrap="wrap">
          {where}
        </Text>
        <Text wrap="wrap">{t(lang, 'why', { why: card.why })}</Text>
        {recent.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>{t(lang, 'recent')}</Text>
            {recent.map(entry => (
              <Box key={`recent:${card.id}:${entry.id}`} paddingLeft={2}>
                <Text dimColor wrap="wrap">
                  {historyLines(entry, current, lang)[0]}
                </Text>
              </Box>
            ))}
          </Box>
        )}
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
        {Input && (
          <Box marginTop={1}>
            <Input
              key={`${card.id}:note`}
              placeholder={t(lang, card.blocking === true ? 'notePlaceholderNow' : 'notePlaceholderStaged')}
              submitLabel={t(lang, card.blocking === true ? 'noteNow' : 'noteStaged')}
              onSubmit={(value: string) => actions.think(card, value)}
            />
          </Box>
        )}
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

/** The line above the prompt: the plan's counts and a button for the pane. */
export function bandView(elements: Elements, current: Plan, mine: Local, lang: Lang, columns: number, open: () => unknown) {
  const counts = bandCounts(current, mine)
  const text = t(lang, 'band', { doing: counts.doing, waiting: counts.waiting })
  const line = counts.isEdited ? `${text} ${t(lang, 'editedBand')}` : text
  const { Box, Text, Button } = elements
  const label = t(lang, 'open')
  // The Button draws as `[ label ]`, one cell of gap before it.
  const room = Math.max(0, columns - textWidth(label) - 5)
  return (
    <Box flexDirection="row" gap={1}>
      <Text>{fit(line, room)}</Text>
      <Button key="open" label={label} onPress={() => open()} />
    </Box>
  )
}
