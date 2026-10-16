import type { Local, Plan } from '../types'
import { blockedSteps, isAnswered, isThoughtOnly, itemStates, openCards } from './view.ts'

export const GUIDE: string = [
  '# Plan board',
  "This repo's plan (the first line of the summary says where it is kept) has items (the user's level) and steps (yours). The pane shows it to the user. Change it only through these tools, never by editing files under plan/.",
  "- Item changes (add, remove, split, merge, edit title or goal, reorder) need the user's approval: call propose_change, wait for the user's answer, then apply_change with that card. If the user agreed in chat rather than in the pane, pass their words as `chat`. When the user asked for an item change themselves in the chat, call apply_change right after propose_change, with their own words as `chat`, and do not stop to wait for approval in the pane: only a change you thought of yourself waits for the user's approval in the pane. If they changed the proposal in a thought, resolve the card and propose again.",
  '- Steps are yours: add, edit, remove, move, assign and set their status with update_step whenever the work changes, without asking. Always give a one-line why.',
  "- When adding a step, set its status, assignee (to) and note on the add op itself instead of in a second call.",
  '- Where a step stands or who it waits on goes in its note (update_step, action note), never in its title. The note clears itself when the step is done; a call with only notes needs no why.',
  "- When one session works across several repos, tag each step with the repo it is done in: update_step action repo, or repo on the add op, with the repo's folder name (such as auth-center). Leave steps untagged in a plan that covers one repo only.",
  "- The first time you tag a step with a repo, give that repo a short name the user knows in the same call: update_step action repo_name, a few words in the user's language (such as ERC後端). After that use the names on the summary's Repo names line and do not make up another; change one only when the user asks.",
  '- Mark a step done only with evidence, put on the op that sets status done: the Thoth task id once your Thoth tools show the task passed, otherwise a one-line result.',
  '- Ask the user with add_decision whenever a choice is theirs: a one-line question, why you ask now in one short sentence, 2-4 options each with what it leads to, at most one recommended with its reason. Attach it to the item and step it is about. Set blocking only when you cannot continue without the answer.',
  '- When the user has to do something themselves (run a command in their terminal, approve something, log in), open a card with add_user_action (one line, and the command word for word) instead of only saying it in chat. When they mark it done, check it if you can, then close it with resolve_decision.',
  '- Choices from the pane reach you as messages. Close every answered card: resolve_decision with a non-empty outcome, or apply_change for an approved proposal.',
  "- A card the user answered with a thought is settled now, in the same turn: if the thought answers it, resolve the card with that outcome; if it does not, resolve it and open a new card whose question and options take the thought into account, instead of only replying in chat. For a proposal, a thought that agrees means apply_change with the user's words as chat; one that changes or rejects it means resolve the card and, if needed, propose again.",
  '- When the summary lists directly edited lines, read `git diff -- plan/log.jsonl`. If they touch items, ask the user with a card whether to keep or revert them, then call resolve_direct_edit with that card; otherwise call resolve_direct_edit yourself. To revert a line that was valid before, restore it with git instead of dropping it.',
  '- Where the plan is kept: the first line of the summary says. If it says "this machine only", the plan is not in git yet; when this repo looks like a good place to keep it, ask the user with add_decision before suggesting /plan init, and never create plan/ yourself.',
  '- When you write a superpowers spec or plan for an item, link the file to it with update_step, action link (item, doc: the path from the repo root). Once the plan is written, add each of its tasks as a step of that item (title copied as written), and when a task is done, mark its step done. Superpowers says how the work is done; plan-board says how far it is and why it changed.',
  "- Every why, card question, item or step title and outcome is read by the user: write it in plain words in the user's language, with no ids and no file or function names they have not used.",
  '- The ids in the summary are for you; never show them to the user.',
].join('\n')

const WORDS = { done: 'done', doing: 'in progress', next: 'next', later: 'later' }
const STORAGE = {
  repo: 'Plan storage: repo (plan/log.jsonl)',
  local: 'Plan storage: this machine only (run /plan init to keep it in the repo)',
}

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
    const docs = item.docs.length > 0 ? `; docs: ${item.docs.join(', ')}` : ''
    items.push(`${index + 1}. [${id}] ${item.title} — ${WORDS[state]} (goal: ${item.goal}${docs})`)
    if (state !== 'doing' && state !== 'next') return
    for (const stepId of item.steps) {
      const step = plan.steps[stepId]
      let line = `   - [${stepId}] ${step.title} — ${step.status}`
      if (step.assignee !== undefined) line += `, assigned to ${step.assignee}`
      if (step.repo !== undefined) line += `, repo: ${step.repo}${Object.hasOwn(plan.repoNames, step.repo) ? ` (${plan.repoNames[step.repo]})` : ''}`
      if (step.note !== undefined) line += `, note: ${step.note}`
      if (step.evidence?.thoth !== undefined) line += `, thoth ${step.evidence.thoth}`
      else if (step.evidence?.result !== undefined) line += `, result: ${step.evidence.result}`
      if (blocked.has(stepId)) line += `, blocked by card ${blocking.get(stepId)}`
      items.push(line)
    }
  })
  if (items.length > 0) sections.push(['Items:', ...items].join('\n'))
  const named = Object.entries(plan.repoNames)
  if (named.length > 0) sections.push(`Repo names: ${named.map(([repo, name]) => `${repo} = ${name}`).join(', ')}`)

  if (cards.length > 0) {
    const lines = cards.map(card => {
      let line = `- [${card.id}] ${card.question} {${card.type}}`
      if (card.blocking) line += ' (blocking)'
      if (isThoughtOnly(local, card.id)) line += ' (the user answered with a thought; settle this card now)'
      else if (isAnswered(local, card.id)) line += ' (sent, waiting for you to resolve)'
      return line
    })
    sections.push(['Open cards:', ...lines].join('\n'))
  }

  if (plan.flagged.length > 0) sections.push(`Directly edited lines: ${plan.flagged.length} (see git diff -- plan/log.jsonl)`)

  if (plan.skipped.length > 0) {
    const lines = plan.skipped.map(s => `- ${s.entry.kind} ${s.entry.id}: ${s.reason}`)
    sections.push(['Skipped entries:', ...lines].join('\n'))
  }

  const head = STORAGE[plan.storage]
  if (sections.length === 0) return `${head}\n${plan.storage === 'local' ? 'No plan yet.' : 'No plan yet in plan/log.jsonl.'}`
  return [head, ...sections].join('\n')
}
