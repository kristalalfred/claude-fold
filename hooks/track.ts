import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Call, Status, Tracker } from '../types'
import { advance, merge, settle, untracked } from './runs'
import type { Join, Row } from './runs'

const MAX_ROWS = 4096
const NOTHING_TRACKED: Tracker = { cursor: null, open: null, notes: [] }
const TRACKER = atom(
  { plugin: 'fold', key: 'tracker' } as const,
  NOTHING_TRACKED,
  { shape: 'runs-across-notes' },
)

const LEADERS = { plugin: 'fold', key: 'leaders' } as const
const RUNS = { plugin: 'fold', key: 'runs' } as const
const FOLDED_NOTES = { plugin: 'fold', key: 'foldedNotes' } as const

async function rowsAfter(
  $: EngineInterface,
  cursor: string | null,
  ownCall?: string,
): Promise<{ rows: readonly Row[]; isContinuous: boolean }> {
  if (cursor !== null) {
    const after = await $.session.messages({ after: cursor })

    if (Array.isArray(after)) {
      return { rows: after, isContinuous: true }
    }
  }
  const newest = await $.session.messages({ last: MAX_ROWS })

  if (!Array.isArray(newest)) {
    return { rows: [], isContinuous: true }
  }
  const at = newest.findIndex(row => row.uuid === cursor)

  if (cursor === null || at >= 0) {
    return { rows: newest.slice(at + 1), isContinuous: true }
  }
  const own = newest.findIndex(row =>
    row.toolUses.some(use => use.tool_use_id === ownCall),
  )

  return { rows: own < 0 ? [] : newest.slice(own), isContinuous: false }
}

export async function trackRuns($: EngineInterface, ownCall?: string) {
  const held = await read($, TRACKER)
  const { rows, isContinuous } = await rowsAfter($, held.cursor, ownCall)

  if (rows.length === 0) {
    return
  }
  const cwd = await $.session.cwd()
  let joins: Join[] = []
  let folded: string[] = []

  await update($, TRACKER, current => {
    const isRaced = current.cursor !== held.cursor
    const advanced = advance(
      isContinuous || isRaced ? current : { ...current, open: null, notes: [] },
      untracked(rows, held.cursor, current.cursor),
      cwd,
    )
    joins = advanced.joins
    folded = advanced.folded

    return advanced.tracker
  })
  const added = new Map<string, Call[]>()

  for (const { leader, call } of joins) {
    added.set(leader, [...(added.get(leader) ?? []), call])
  }
  await Promise.all(
    [...added].map(([leader, calls]) =>
      update($, { ...RUNS, id: leader }, run => merge(run ?? [], calls)),
    ),
  )
  await Promise.all([
    ...joins.map(({ leader, call }) =>
      $.state.set({ ...LEADERS, id: call.id }, leader),
    ),
    ...folded.map(id => $.state.set({ ...FOLDED_NOTES, id }, true)),
  ])
}

export async function settleCall(
  $: EngineInterface,
  id: string,
  status: Status,
) {
  const leader = await leaderOf($, id)

  if (leader !== undefined) {
    await update($, { ...RUNS, id: leader }, run => settle(run ?? [], id, status))
  }
}

export async function leaderOf($: EngineInterface, id: string) {
  return read($, { ...LEADERS, id })
}

export async function runOf($: EngineInterface, id: string) {
  return read($, { ...RUNS, id })
}

export async function isNoteFolded($: EngineInterface, id: string) {
  return (await read($, { ...FOLDED_NOTES, id })) === true
}
