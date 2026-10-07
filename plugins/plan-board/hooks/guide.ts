import type { Local, Plan } from '../types'
import { blockedSteps, itemStates, openCards } from './view.ts'

export const GUIDE: string = [
  '# Plan board',
  "This repo keeps its plan in plan/log.jsonl: items (the user's level) and steps (yours). The pane shows it to the user. Change it only through these tools, never by editing files under plan/.",
  "- Item changes (add, remove, split, merge, edit title or goal, reorder) need the user's approval: call propose_change, wait for the user's answer, then apply_change with that card. If the user agreed in chat rather than in the pane, pass their words as `chat`. If they changed the proposal in a thought, resolve the card and propose again.",
  '- Steps are yours: add, edit, remove, move, assign and set their status with update_step whenever the work changes, without asking. Always give a one-line why.',
  '- Mark a step done only with evidence: the Thoth task id once your Thoth tools show the task passed, otherwise a one-line result.',
  '- Ask the user with add_decision whenever a choice is theirs: a one-line question, why you ask now, 2-4 options each with what it leads to, at most one recommended with its reason. Attach it to the item and step it is about. Set blocking only when you cannot continue without the answer.',
  '- Choices from the pane reach you as messages. Close every answered card: resolve_decision with a non-empty outcome, or apply_change for an approved proposal.',
  '- When the summary lists directly edited lines, read `git diff -- plan/log.jsonl`. If they touch items, ask the user with a card whether to keep or revert them, then call resolve_direct_edit with that card; otherwise call resolve_direct_edit yourself. To revert a line that was valid before, restore it with git instead of dropping it.',
  '- The ids in the summary are for you; never show them to the user.',
].join('\n')

const WORDS = { done: 'done', doing: 'in progress', next: 'next', later: 'later' }

export function summary(plan: Plan, local: Local): string {
  const sections: string[] = []
  const states = itemStates(plan)
  const blocking = new Map<string, string>()
  const cards = openCards(plan)
  for (const card of cards) if (card.step !== undefined && !blocking.has(card.step)) blocking.set(card.step, card.id)
  const blocked = blockedSteps(plan)

  const items: string[] = []
  plan.order.forEach((id, index) => {
    const item = plan.items[id]
    const state = states[id]
    items.push(`${index + 1}. [${id}] ${item.title} — ${WORDS[state]} (goal: ${item.goal})`)
    if (state !== 'doing' && state !== 'next') return
    for (const stepId of item.steps) {
      const step = plan.steps[stepId]
      let line = `   - [${stepId}] ${step.title} — ${step.status}`
      if (step.assignee !== undefined) line += `, assigned to ${step.assignee}`
      if (step.evidence?.thoth !== undefined) line += `, thoth ${step.evidence.thoth}`
      else if (step.evidence?.result !== undefined) line += `, result: ${step.evidence.result}`
      if (blocked.has(stepId)) line += `, blocked by card ${blocking.get(stepId)}`
      items.push(line)
    }
  })
  if (items.length > 0) sections.push(['Items:', ...items].join('\n'))

  if (cards.length > 0) {
    const lines = cards.map(card => {
      let line = `- [${card.id}] ${card.question} {${card.type}}`
      if (card.blocking) line += ' (blocking)'
      if (local.sent[card.id] !== undefined) line += ' (sent, waiting for you to resolve)'
      return line
    })
    sections.push(['Open cards:', ...lines].join('\n'))
  }

  if (plan.flagged.length > 0) sections.push(`Directly edited lines: ${plan.flagged.length} (see git diff -- plan/log.jsonl)`)

  if (plan.skipped.length > 0) {
    const lines = plan.skipped.map(s => `- ${s.entry.kind} ${s.entry.id}: ${s.reason}`)
    sections.push(['Skipped entries:', ...lines].join('\n'))
  }

  return sections.length === 0 ? 'No plan yet in plan/log.jsonl.' : sections.join('\n')
}
