// plugins/plan-board/types/index.d.ts
export type StepStatus = 'todo' | 'doing' | 'done'
export type Basis =
  | { type: 'ai' }
  | { type: 'thoth'; task: string }
  | { type: 'card'; card: string; chat?: string }
  | { type: 'direct-edit' }
export type ItemSpec = { id: string; title: string; goal: string }
export type StepSpec = { id: string; title: string }
export type ItemChange =
  | { kind: 'item.add'; data: { item: ItemSpec; before?: string } }
  | { kind: 'item.remove'; data: { item: string } }
  | { kind: 'item.split'; data: { item: string; into: ItemSpec[] } }
  | { kind: 'item.merge'; data: { items: string[]; into: ItemSpec } }
  | { kind: 'item.edit'; data: { item: string; title?: string; goal?: string } }
  | { kind: 'item.reorder'; data: { order: string[] } }
export type StepChange =
  | { kind: 'step.add'; data: { item: string; step: StepSpec; after?: string } }
  | { kind: 'step.edit'; data: { step: string; title: string } }
  | { kind: 'step.remove'; data: { step: string } }
  | { kind: 'step.move'; data: { step: string; item: string; after?: string } }
  | { kind: 'step.assign'; data: { step: string; to: string } }
  | { kind: 'step.status'; data: { step: string; status: StepStatus; result?: string } }
/** Links a document (a path from the repo root) to an item. Not an item-level change: it needs no approval. */
export type LinkChange = { kind: 'item.link'; data: { item: string; doc: string } }
export type CardOption = { label: string; effect: string; recommended?: boolean; reason?: string }
export type CardSpec = {
  id: string; type: 'question' | 'proposal'; item?: string; step?: string
  question: string; why: string; options: CardOption[]; blocking?: boolean; changes?: ItemChange[]
}
export type CardChange =
  | { kind: 'card.open'; data: { card: CardSpec } }
  | { kind: 'card.resolve'; data: { card: string; outcome: string; choice?: string } }
export type EditChange = { kind: 'edit.keep' | 'edit.drop'; data: { lines: string[]; summary: string } }
export type Change = ItemChange | LinkChange | StepChange | CardChange | EditChange
export type Entry = Change & { id: string; at: string; why: string; basis: Basis }

export type Item = { id: string; title: string; goal: string; steps: string[]; docs: string[] }
export type Step = { id: string; item: string; title: string; status: StepStatus; assignee?: string; evidence?: { thoth?: string; result?: string } }
export type Card = CardSpec & { openedAt: string; resolved?: { outcome: string; choice?: string; at: string } }
export type Flagged = { raw: string; hash: string; entry: Entry | null }
/** Where the log was read from: the repo's plan/log.jsonl, or the text this machine keeps in $.store. */
export type Storage = 'repo' | 'local'
export type Plan = {
  storage: Storage
  order: string[]
  items: Record<string, Item>
  steps: Record<string, Step>
  cards: Record<string, Card>
  /** Entries that took effect, oldest first. */
  applied: Entry[]
  /** Entries touching each item, oldest first; a step entry counts for the item the step was in when it applied. */
  itemLog: Record<string, Entry[]>
  /** Last known title of every item and step, and question of every card, including removed ones. */
  names: Record<string, string>
  /** The title an item.edit (with a new title) or a step.edit replaced, by the id of that entry. */
  previousNames: Record<string, string>
  flagged: Flagged[]
  skipped: { entry: Entry; reason: string }[]
}
export type ItemState = 'done' | 'doing' | 'next' | 'later'
export type Pick = { choice?: string; draft?: string; isDismissed?: boolean; at: number }
/** This machine's pane state for one worktree, kept in $.store. */
export type Local = { staged: Record<string, Pick>; sent: Record<string, Pick>; expanded: string[]; view: 'overview' | 'cards' }

declare module 'claude-code' {
  interface PluginState {
    'plan-board': { root: string; plan: Plan; local: Local }
  }
}
