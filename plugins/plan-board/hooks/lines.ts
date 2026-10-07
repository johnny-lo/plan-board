import { t } from './i18n.ts'
import type { Lang } from './i18n.ts'
import type { Change, Entry, Plan } from '../types'

/** Cells a character takes on a terminal: two for wide East Asian characters. */
function cellWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0
  return (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
    ? 2
    : 1
}

export function textWidth(text: string): number {
  let width = 0
  for (const char of text) width += cellWidth(char)
  return width
}

/** The text cut to `columns` cells, an ellipsis marking the cut. */
export function fit(text: string, columns: number): string {
  if (textWidth(text) <= columns) return text
  if (columns <= 0) return ''
  let out = ''
  let width = 0
  for (const char of text) {
    const w = cellWidth(char)
    if (width + w > columns - 1) break
    out += char
    width += w
  }
  return `${out}…`
}

const two = (n: number): string => String(n).padStart(2, '0')

/** The local time of an entry as `MM/DD HH:mm`. */
export function stamp(at: string): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return '--/-- --:--'
  return `${two(date.getMonth() + 1)}/${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** The last known name of an item, step or card; a name never falls back to the id. */
export function nameOf(plan: Plan, id: string, lang: Lang): string {
  return Object.hasOwn(plan.names, id) ? plan.names[id] : t(lang, 'unknownName')
}

const quoted = (titles: string[], lang: Lang): string =>
  lang === 'zh-TW' ? titles.map(title => `「${title}」`).join('') : titles.map(title => `"${title}"`).join(', ')

/** What one change does, as `kind word` and a sentence, with names for everything it points at. */
export function changeLine(change: Change, plan: Plan, lang: Lang): string {
  const name = (id: string): string => nameOf(plan, id, lang)
  switch (change.kind) {
    case 'item.add':
      return `${t(lang, 'kindItem')} ${t(lang, 'itemAdd', { title: change.data.item.title })}`
    case 'item.remove':
      return `${t(lang, 'kindItem')} ${t(lang, 'itemRemove', { item: name(change.data.item) })}`
    case 'item.split':
      return `${t(lang, 'kindItem')} ${t(lang, 'itemSplit', { item: name(change.data.item), into: quoted(change.data.into.map(i => i.title), lang) })}`
    case 'item.merge':
      return `${t(lang, 'kindItem')} ${t(lang, 'itemMerge', { items: quoted(change.data.items.map(name), lang), into: change.data.into.title })}`
    case 'item.edit': {
      const parts: string[] = []
      if (change.data.title !== undefined) parts.push(t(lang, 'itemEditTitle', { title: change.data.title }))
      if (change.data.goal !== undefined) parts.push(t(lang, 'itemEditGoal', { goal: change.data.goal }))
      return `${t(lang, 'kindItem')} ${t(lang, 'itemEdit', { item: name(change.data.item), changes: parts.join(lang === 'zh-TW' ? '；' : '; ') })}`
    }
    case 'item.reorder':
      return `${t(lang, 'kindItem')} ${t(lang, 'itemReorder')}`
    case 'step.add':
      return `${t(lang, 'kindStep')} ${t(lang, 'stepAdd', { step: change.data.step.title, item: name(change.data.item) })}`
    case 'step.edit':
      return `${t(lang, 'kindStep')} ${t(lang, 'stepEdit', { title: change.data.title })}`
    case 'step.remove':
      return `${t(lang, 'kindStep')} ${t(lang, 'stepRemove', { step: name(change.data.step) })}`
    case 'step.move':
      return `${t(lang, 'kindStep')} ${t(lang, 'stepMove', { step: name(change.data.step), item: name(change.data.item) })}`
    case 'step.assign':
      return change.data.to === ''
        ? `${t(lang, 'kindStep')} ${t(lang, 'stepUnassign', { step: name(change.data.step) })}`
        : `${t(lang, 'kindStep')} ${t(lang, 'stepAssign', { step: name(change.data.step), to: change.data.to })}`
    case 'step.status': {
      const status = t(lang, change.data.status === 'done' ? 'stepDone' : change.data.status === 'doing' ? 'stepDoing' : 'stepTodo')
      return `${t(lang, 'kindStep')} ${t(lang, 'stepStatus', { step: name(change.data.step), status })}`
    }
    case 'card.open':
      return `${t(lang, 'kindCard')} ${t(lang, 'cardOpen', { question: change.data.card.question })}`
    case 'card.resolve':
      return `${t(lang, 'kindCard')} ${t(lang, 'cardResolve', { question: name(change.data.card), outcome: change.data.outcome })}`
    case 'edit.keep':
      return `${t(lang, 'kindEdit')} ${t(lang, 'editKeep', { summary: change.data.summary })}`
    case 'edit.drop':
      return `${t(lang, 'kindEdit')} ${t(lang, 'editDrop', { summary: change.data.summary })}`
  }
}

function sourceOf(entry: Entry, plan: Plan, lang: Lang): string {
  const basis = entry.basis
  switch (basis.type) {
    case 'card':
      return basis.chat !== undefined && basis.chat !== ''
        ? t(lang, 'sourceChat', { chat: basis.chat })
        : t(lang, 'sourceCard', { question: nameOf(plan, basis.card, lang) })
    case 'thoth':
      return t(lang, 'sourceThoth')
    case 'direct-edit':
      return t(lang, 'sourceEdit')
    default:
      return ''
  }
}

/** One log entry as the pane shows it: time, kind and what changed, where it came from; then the reason. */
export function historyLines(entry: Entry, plan: Plan, lang: Lang): string[] {
  const lines = [`${stamp(entry.at)} ${changeLine(entry, plan, lang)}${sourceOf(entry, plan, lang)}`]
  if (entry.why !== '') lines.push(t(lang, 'reason', { why: entry.why }))
  return lines
}
