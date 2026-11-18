import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { gistOf, nameOf } from '../hooks/gist'
import {
  advance,
  merge,
  settle,
  statusOfRun,
  summaryOf,
  untracked,
} from '../hooks/runs'
import type { Row } from '../hooks/runs'
import { pixelsOf, stackOf } from '../hooks/stack'
import type { Call } from '../types'

type Engine = Parameters<TestBody>[0]
type Target = Parameters<Engine['ui']['mount']>[0]

const CWD = '/work/project'
const ENGINE_ROW = 'engine row'
const NOTHING_TRACKED = { cursor: null, open: null }

const RUN_FOLD = {
  command: 'fold',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

const useOf = (id: string, tool = 'Read') => ({
  tool_use_id: id,
  tool,
  input: { file_path: `${CWD}/src/${id}.rs` },
})

const callsRow = (uuid: string, ...ids: string[]): Row => ({
  uuid,
  text: '',
  toolUses: ids.map(id => useOf(id)),
})

const textRow = (uuid: string, text: string): Row => ({ uuid, text, toolUses: [] })

const callOf = (id: string, status: Call['status'], tool = 'Read'): Call => ({
  id,
  tool,
  gist: `src/${id}.rs`,
  status,
})

const rowOf = (id: string, props: object = {}): Target => ({
  plugin: 'fold',
  surface: 'terminal',
  component: 'ToolUse',
  requestId: id,
  props: {
    ...useOf(id),
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
    ...props,
  },
})

const standInForEngine = (
  on: Parameters<TestBody>[1],
  { stored, failing = [] }: { stored?: boolean; failing?: string[] } = {},
) => {
  const transcript: Row[] = []

  on('command.register', () => ({ value: { command: 'fold' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.messages', (_, e) => ({
    value: transcript.slice(
      transcript.findIndex(row => row.uuid === e.after) + 1,
    ) as never,
  }))
  on('store.get', () => ({ value: stored }))
  on('store.set', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', (_, e) =>
    failing.includes(e.tool_use_id)
      ? { result: {}, isError: true as const }
      : { result: {} },
  )
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{ENGINE_ROW}</Text>
  })

  return transcript
}

const run = async ($: Engine, transcript: Row[], row: Row) => {
  transcript.push(row)

  for (const use of row.toolUses) {
    await $.tool.call({ tool: 'Read', file_path: '', tool_use_id: use.tool_use_id })
  }
}

const drawnBy = async ($: Engine, target: Target) => {
  const ui = await $.ui.mount(target)
  const drawn = (await ui.findAll({ type: 'Text' }))
    .map(found => found.text)
    .join('')
  await ui.unmount()

  return drawn
}

const lineOf = async ($: Engine, target: Target) =>
  (await drawnBy($, target)).trim()

test('a tool is named without its mcp prefix', () => {
  expect(nameOf('Bash')).toBe('Bash')
  expect(nameOf('mcp__slack__send_message')).toBe('slack/send_message')
})

test('a gist is the most telling field, on one line', () => {
  expect(
    gistOf({ command: 'git status\n  --short', description: 'Show status' }, CWD),
  ).toBe('Show status')
  expect(gistOf({ command: 'git status\n  --short' }, CWD)).toBe('git status')
  expect(gistOf({ timeout: 5, anything: 'a   b' }, CWD)).toBe('a b')
  expect(gistOf({ timeout: 5 }, CWD)).toBe('')
  expect(gistOf(undefined, CWD)).toBe('')
})

test('a path is shown from the working directory, or by its tail', () => {
  expect(gistOf({ file_path: `${CWD}/src/main.rs` }, CWD)).toBe('src/main.rs')
  expect(gistOf({ file_path: '/etc/a/b/c/hosts' }, CWD)).toBe('…/b/c/hosts')
  expect(gistOf({ file_path: '/etc/hosts' }, CWD)).toBe('/etc/hosts')
})

test('calls join one run until text comes between them', () => {
  const { tracker, joins } = advance(
    NOTHING_TRACKED,
    [
      textRow('r1', 'Fix the bug'),
      callsRow('r2', 'a', 'b'),
      textRow('r3', ''),
      callsRow('r4', 'c'),
      textRow('r5', 'Now the tests.'),
      callsRow('r6', 'd'),
    ],
    CWD,
  )

  expect(joins.map(join => [join.call.id, join.leader])).toEqual([
    ['a', 'a'],
    ['b', 'a'],
    ['c', 'a'],
    ['d', 'd'],
  ])
  expect(joins[0]?.call).toEqual(callOf('a', 'running'))
  expect(tracker).toEqual({ cursor: 'r6', open: 'd' })
})

test('a call read back with its outcome is settled', () => {
  const settled = (outcome: object) =>
    advance(
      NOTHING_TRACKED,
      [{ text: '', toolUses: [{ ...useOf('a'), ...outcome }] }],
      CWD,
    ).joins[0]?.call.status

  expect(settled({ text: 'ok' })).toBe('done')
  expect(settled({ text: 'no', isError: true })).toBe('failed')
})

test('a later read continues the open run', () => {
  const first = advance(NOTHING_TRACKED, [callsRow('r1', 'a')], CWD)
  const second = advance(first.tracker, [callsRow('r2', 'b')], CWD)

  expect(second.joins[0]?.leader).toBe('a')
})

test('rows another read already tracked are left out', () => {
  const rows = [callsRow('r1', 'a'), callsRow('r2', 'b'), callsRow('r3', 'c')]

  expect(untracked(rows, 'r0', 'r0')).toEqual(rows)
  expect(untracked(rows, 'r0', 'r2')).toEqual(rows.slice(2))
  expect(untracked(rows, 'r0', 'r9')).toEqual([])
})

test('a run keeps what it knows of a call', () => {
  const known = [callOf('a', 'done'), callOf('b', 'running')]

  expect(
    merge(known, [callOf('a', 'running'), callOf('b', 'failed'), callOf('c', 'running')]),
  ).toEqual([callOf('a', 'done'), callOf('b', 'failed'), callOf('c', 'running')])
  expect(settle(known, 'b', 'done')).toEqual([callOf('a', 'done'), callOf('b', 'done')])
})

test('a run is as far along as its worst call', () => {
  expect(statusOfRun([callOf('a', 'done'), callOf('b', 'done')])).toBe('done')
  expect(statusOfRun([callOf('a', 'done'), callOf('b', 'running')])).toBe('running')
  expect(statusOfRun([callOf('a', 'failed'), callOf('b', 'running')])).toBe('failed')
})

test('one call reads as its gist, several as a tally', () => {
  expect(summaryOf([callOf('a', 'done')])).toBe('Read  src/a.rs')
  expect(summaryOf([{ ...callOf('a', 'done', 'TaskList'), gist: '' }])).toBe('TaskList')
  expect(
    summaryOf([
      callOf('a', 'done'),
      callOf('b', 'done', 'Bash'),
      callOf('c', 'done'),
      callOf('d', 'done', 'Write'),
      callOf('e', 'done', 'Grep'),
      callOf('f', 'done', 'TaskList'),
    ]),
  ).toBe('2 reads · 1 command · 1 edit · 1 search · 1 other')
  expect(
    summaryOf([callOf('a', 'done', 'TaskList'), callOf('b', 'done', 'Skill')]),
  ).toBe('2 tool calls')
})

test('a run of calls is one line, drawn by its first call', async ($, on) => {
  const transcript = standInForEngine(on)
  await run($, transcript, textRow('r1', 'Fix the bug'))
  await run($, transcript, callsRow('r2', 'a', 'b'))
  await run($, transcript, callsRow('r3', 'c'))
  await run($, transcript, textRow('r4', 'Now the tests.'))
  await run($, transcript, callsRow('r5', 'd'))

  expect(await lineOf($, rowOf('a'))).toBe('3 reads')
  expect(await lineOf($, rowOf('b'))).toBe('')
  expect(await lineOf($, rowOf('c'))).toBe('')
  expect(await lineOf($, rowOf('d'))).toBe('Read  src/d.rs')
})

test('a result draws nothing', async ($, on) => {
  standInForEngine(on)

  expect(
    await drawnBy($, {
      plugin: 'fold',
      surface: 'terminal',
      component: 'ToolResult',
      requestId: 'a',
      props: { tool_use_id: 'a', tool: 'Read', output: {}, isErrored: false },
    }),
  ).toBe('')
})

const stackDrawnBy = async ($: Engine, target: Target) => {
  const ui = await $.ui.mount(target)
  const image = await ui.find({ type: 'Image' })
  await ui.unmount()

  return image?.props.source
}

const inkOf = (discs: number) =>
  pixelsOf(discs, 'done').pixels.filter(
    (value, at) => at % 4 === 3 && value > 0,
  ).length

test('a stack shows more of itself with every disc', () => {
  const inks = [1, 2, 3, 4].map(inkOf)

  expect([1, 2, 3, 4].map(discs => stackOf(discs, 'done').columns)).toEqual([
    1, 2, 2, 2,
  ])
  expect(inks).toEqual([...inks].sort((less, more) => less - more))
  expect(new Set(inks).size).toBe(4)
})

test('the front disc is opaque and takes the color of its status', () => {
  const { pixels, width, height } = pixelsOf(3, 'failed')
  const front = ((height / 2) * width + width - 12) * 4

  expect([...pixels.slice(front, front + 4)]).toEqual([255, 107, 128, 255])
  expect(stackOf(3, 'failed').rgba).not.toBe(stackOf(3, 'done').rgba)
})

test('pixels are packed as padded base64', () => {
  const { rgba } = stackOf(1, 'done')

  expect(rgba).toHaveLength(Math.ceil((24 * 48 * 4) / 3) * 4)
  expect(rgba.startsWith('TrplAE66ZQBO')).toBe(true)
})

test('each call adds a disc to the stack, up to four', async ($, on) => {
  const transcript = standInForEngine(on)
  const { columns: _, ...four } = stackOf(4, 'done')

  await run($, transcript, callsRow('r1', 'a'))
  expect(await stackDrawnBy($, rowOf('a'))).toMatchObject({
    rgba: stackOf(1, 'done').rgba,
  })
  await run($, transcript, callsRow('r2', 'b', 'c'))
  expect(await stackDrawnBy($, rowOf('a'))).toMatchObject({
    rgba: stackOf(3, 'done').rgba,
  })
  await run($, transcript, callsRow('r3', 'd', 'e', 'f'))
  expect(await stackDrawnBy($, rowOf('a'))).toEqual(four)
})

test('a failed call marks its run', async ($, on) => {
  const transcript = standInForEngine(on, { failing: ['b'] })
  await run($, transcript, callsRow('r1', 'a', 'b'))

  expect(await stackDrawnBy($, rowOf('a'))).toMatchObject({
    rgba: stackOf(2, 'failed').rgba,
  })
  expect(await lineOf($, rowOf('a'))).toBe('2 reads · 1 failed')
})

test('a call nothing tracked draws its own line once it settled', async ($, on) => {
  standInForEngine(on)

  expect(await lineOf($, rowOf('z'))).toBe('Read  src/z.rs')
  expect(await lineOf($, rowOf('z', { isRunning: true }))).toBe('')
})

test('a group of calls draws the run its first call leads', async ($, on) => {
  const transcript = standInForEngine(on)
  const groupOf = (...ids: string[]): Target => ({
    plugin: 'fold',
    surface: 'terminal',
    component: 'ToolGroup',
    requestId: `group-${ids.join('')}`,
    props: {
      calls: ids.map(id => ({
        ...useOf(id),
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
      })),
      isActive: false,
      isExpanded: false,
    },
  })
  await run($, transcript, callsRow('r1', 'a', 'b', 'c'))

  expect(await lineOf($, groupOf('a', 'b'))).toBe('3 reads')
  expect(await lineOf($, groupOf('b', 'c'))).toBe('')
  expect(await lineOf($, groupOf('y', 'z'))).toBe('2 reads')
})

test('the expanded transcript keeps the full rows', async ($, on) => {
  standInForEngine(on)

  expect(await drawnBy($, rowOf('a', { isExpanded: true }))).toBe(ENGINE_ROW)
})

test('the command switches between folded and full rows', async ($, on) => {
  standInForEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })

  await $.command.run(RUN_FOLD)
  expect(await drawnBy($, rowOf('a'))).toBe(ENGINE_ROW)

  await $.command.run(RUN_FOLD)
  expect(await lineOf($, rowOf('a'))).toBe('Read  src/a.rs')
})

test('a session starts in the mode last chosen', async ($, on) => {
  standInForEngine(on, { stored: false })
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })

  expect(await drawnBy($, rowOf('a'))).toBe(ENGINE_ROW)
})
