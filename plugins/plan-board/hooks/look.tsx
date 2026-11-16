import type { Elements } from './pane.tsx'

/** The theme keys the pane draws with, by what they mean (design section 4). No other colour is ever written: no hex, no colour names. */
export const TONE = {
  /** In progress: the in-progress and recommended pills, the chosen tab, the bar's solid cells, ●. */
  doing: 'suggestion',
  /** Waiting for the user: the first card's line and header, ⚑, what waits for the user, a direct edit. */
  waiting: 'warning',
  /** Done or staged: ✓, the done pill, a staged card's line, a pick, nothing waiting. */
  done: 'success',
  /** Neutral: the other cards' lines, a detail's bar. */
  neutral: 'inactive',
  /** Sent: a sent card's line. */
  sent: 'subtle',
} as const

export type Tone = (typeof TONE)[keyof typeof TONE]

/** How many cells the progress bar takes in a pane `columns` wide: 8 from 60, 4 from 40, none below (the number alone). */
export function barCells(columns: number): number {
  if (columns >= 60) return 8
  if (columns >= 40) return 4
  return 0
}

/** How many of `cells` are solid for `done` of `total`, rounded; at least one once a step is done, at least one empty until all are. */
export function solidCells(done: number, total: number, cells: number): number {
  if (cells <= 0 || total <= 0 || done <= 0) return 0
  if (done >= total) return cells
  return Math.min(cells - 1, Math.max(1, Math.round((done / total) * cells)))
}

/** The cells a pill of `words` takes: the words and a space on each side. */
export const pillWidth = (words: number): number => words + 2

/**
 * A pill: the words, a space on each side, drawn `inverse` in the tone, so the fill is the tone and the words the pane's own background.
 * Never bold, never a backgroundColor. It is a Text, so it can sit in a Button; in a row, put it in a Box that does not shrink.
 * Fallback (R1 fails): return `<Text color={tone}>{words}</Text>` here, coloured words with no fill, and change pillWidth to the words alone.
 */
export function pill(elements: Elements, words: string, tone: Tone) {
  const { Text } = elements
  return (
    <Text inverse color={tone}>
      {` ${words} `}
    </Text>
  )
}

/**
 * The progress bar: a dim `[`, the solid cells `█` in the tone, blanks for the rest, a dim `]`; null when there is no room (`cells` 0).
 * The rest is blank, not `░`, which light themes hardly show; the brackets show how much is left.
 * Fallback (R4 fails): return null here; the number drawn beside the bar stays.
 */
export function bar(elements: Elements, done: number, total: number, cells: number, tone: Tone) {
  if (cells <= 0) return null
  const { Text } = elements
  const solid = solidCells(done, total, cells)
  return (
    <Text>
      <Text dimColor>[</Text>
      {solid > 0 && <Text color={tone}>{'█'.repeat(solid)}</Text>}
      {solid < cells && ' '.repeat(cells - solid)}
      <Text dimColor>]</Text>
    </Text>
  )
}

/**
 * A 1-cell column filled with the tone and as tall as what sits beside it: a card's line and a detail's bar.
 * The only Box with a backgroundColor; a one-sided border is refused by the engine, so this stands in for one.
 */
export function stripe(elements: Elements, key: string, tone: Tone) {
  const { Box } = elements
  return <Box key={key} width={1} flexShrink={0} backgroundColor={tone} />
}
