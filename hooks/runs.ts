import type { Call, Status, Tracker } from '../types'
import { gistOf, nameOf } from './gist'

type Use = {
  tool_use_id: string
  tool: string
  input: unknown
  text?: string
  result?: unknown
  isError?: true
}

export type Row = {
  uuid?: string
  role: 'user' | 'assistant'
  text: string
  toolUses: readonly Use[]
}

export type Join = { leader: string; call: Call }

type Kind = readonly [one: string, many: string]

const READ: Kind = ['read', 'reads']
const EDIT: Kind = ['edit', 'edits']
const COMMAND: Kind = ['command', 'commands']
const SEARCH: Kind = ['search', 'searches']
const FETCH: Kind = ['fetch', 'fetches']
const AGENT: Kind = ['agent', 'agents']
const OTHER: Kind = ['other', 'other']
const ANY: Kind = ['tool call', 'tool calls']

const KINDS: Record<string, Kind> = {
  Read: READ,
  Edit: EDIT,
  MultiEdit: EDIT,
  NotebookEdit: EDIT,
  Write: EDIT,
  Bash: COMMAND,
  PowerShell: COMMAND,
  Glob: SEARCH,
  Grep: SEARCH,
  ToolSearch: SEARCH,
  WebSearch: SEARCH,
  WebFetch: FETCH,
  Agent: AGENT,
}

const WORST_FIRST: readonly Status[] = ['failed', 'running', 'done']

const statusOf = (use: Use): Status => {
  if (use.isError === true) {
    return 'failed'
  }

  return use.text === undefined && use.result === undefined ? 'running' : 'done'
}

export const advance = (
  tracker: Tracker,
  rows: readonly Row[],
  cwd: string,
): { tracker: Tracker; joins: Join[]; folded: string[] } => {
  const joins: Join[] = []
  const folded: string[] = []
  let { cursor, open, notes } = tracker

  for (const row of rows) {
    if (row.text.trim() !== '') {
      if (row.role === 'user') {
        open = null
        notes = []
      } else if (row.uuid !== undefined) {
        notes = [...notes, row.uuid]
      }
    }

    if (row.toolUses.length > 0) {
      folded.push(...notes)
      notes = []
    }

    for (const use of row.toolUses) {
      open ??= use.tool_use_id
      joins.push({
        leader: open,
        call: {
          id: use.tool_use_id,
          tool: use.tool,
          gist: gistOf(use.input, cwd),
          status: statusOf(use),
        },
      })
    }
    cursor = row.uuid ?? cursor
  }

  return { tracker: { cursor, open, notes }, joins, folded }
}

export const untracked = (
  rows: readonly Row[],
  readFrom: string | null,
  trackedTo: string | null,
) => {
  if (trackedTo === readFrom) {
    return rows
  }
  const at = rows.findIndex(row => row.uuid === trackedTo)

  return at < 0 ? [] : rows.slice(at + 1)
}

export const merge = (calls: readonly Call[], added: readonly Call[]) => {
  const merged = [...calls]

  for (const call of added) {
    const at = merged.findIndex(known => known.id === call.id)
    const known = merged[at]

    if (known === undefined) {
      merged.push(call)
    } else if (known.status === 'running') {
      merged[at] = call
    }
  }

  return merged
}

export const settle = (calls: readonly Call[], id: string, status: Status) =>
  calls.map(call => (call.id === id ? { ...call, status } : call))

export const discsOf = (calls: readonly Call[], limit: number) =>
  WORST_FIRST.flatMap(status =>
    calls.filter(call => call.status === status).map(() => status),
  ).slice(0, limit)

export const summaryOf = (calls: readonly Call[]) => {
  const [only, ...rest] = calls

  if (only !== undefined && rest.length === 0) {
    return `${nameOf(only.tool)}  ${only.gist}`.trimEnd()
  }
  const counts = new Map<Kind, number>()

  for (const call of calls) {
    const kind = KINDS[call.tool] ?? OTHER
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  const others = counts.get(OTHER)

  if (others !== undefined) {
    counts.delete(OTHER)
    counts.set(counts.size === 0 ? ANY : OTHER, others)
  }

  return [...counts]
    .map(([[one, many], count]) => `${count} ${count === 1 ? one : many}`)
    .join(' · ')
}
