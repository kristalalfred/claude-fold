const GIST_KEYS = [
  'description',
  'file_path',
  'notebook_path',
  'pattern',
  'query',
  'url',
  'command',
  'skill',
  'path',
  'subject',
  'prompt',
]

const PATH_KEYS = new Set(['file_path', 'notebook_path', 'path'])
const PATH_TAIL_SEGMENTS = 3
const MCP_NAME = /^mcp__(.+?)__(.+)$/

type Call = { tool: string; input: unknown }

const shortPathOf = (path: string, cwd: string) => {
  if (path.startsWith(`${cwd}/`)) {
    return path.slice(cwd.length + 1)
  }
  const segments = path.split('/').filter(segment => segment !== '')

  return segments.length <= PATH_TAIL_SEGMENTS
    ? path
    : `…/${segments.slice(-PATH_TAIL_SEGMENTS).join('/')}`
}

const firstLineOf = (text: string) =>
  text.trim().split('\n', 1)[0]?.replace(/\s+/g, ' ') ?? ''

export const nameOf = (tool: string) => {
  const mcp = MCP_NAME.exec(tool)

  return mcp === null ? tool : `${mcp[1]}/${mcp[2]}`
}

export const gistOf = (input: unknown, cwd: string) => {
  if (typeof input !== 'object' || input === null) {
    return ''
  }
  const fields = input as Record<string, unknown>
  const key =
    GIST_KEYS.find(known => typeof fields[known] === 'string') ??
    Object.keys(fields).find(other => typeof fields[other] === 'string')

  if (key === undefined) {
    return ''
  }
  const text = firstLineOf(fields[key] as string)

  return PATH_KEYS.has(key) ? shortPathOf(text, cwd) : text
}

const tallyOf = (names: readonly string[]) => {
  const counts = new Map<string, number>()

  for (const name of names) {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  return [...counts]
    .map(([name, count]) => (count === 1 ? name : `${name} ×${count}`))
    .join(', ')
}

export const lineOf = (calls: readonly Call[], cwd: string) => {
  const [only, ...rest] = calls

  return only !== undefined && rest.length === 0
    ? `${nameOf(only.tool)}  ${gistOf(only.input, cwd)}`.trimEnd()
    : tallyOf(calls.map(call => nameOf(call.tool)))
}
