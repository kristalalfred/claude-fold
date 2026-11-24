import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { gistOf, nameOf } from '../hooks/gist'
import {
  advance,
  discsOf,
  merge,
  settle,
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
const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }
const NOTHING_TRACKED = { cursor: null, open: null, notes: [] }

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
  role: 'assistant',
  text: '',
  toolUses: ids.map(id => useOf(id)),
})

const noteRow = (uuid: string, text: string): Row => ({
  uuid,
  role: 'assistant',
  text,
  toolUses: [],
})

const promptRow = (uuid: string, text: string): Row => ({
  uuid,
  role: 'user',
  text,
  toolUses: [],
})

const noteOf = (id: string, props: object = {}): Target => ({
  plugin: 'fold',
  surface: 'terminal',
  component: 'AssistantMessage',
  requestId: id,
  props: { text: 'A note', isFirstOfReply: true, ...props },
})

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
  const line = await ui.find({ type: 'Button' })
  const drawn =
    line?.text ??
    (await ui.findAll({ type: 'Text' })).map(found => found.text).join('')
  await ui.unmount()

  return drawn
}

const showsEngineRow = async ($: Engine, target: Target) => {
  const ui = await $.ui.mount(target)
  const row = await ui.find({ type: 'Text', text: ENGINE_ROW })
  await ui.unmount()

  return row !== undefined
}

const pressLine = async ($: Engine, newest: string, leader: string) => {
  const ui = await $.ui.mount({ ...rowOf(newest), viewport: FULLSCREEN })
  await ui.press({ key: leader })
  await ui.unmount()
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

test('calls join one run until the next prompt, across notes', () => {
  const { tracker, joins, folded } = advance(
    NOTHING_TRACKED,
    [
      promptRow('r1', 'Fix the bug'),
      noteRow('r2', 'Reading the code.'),
      callsRow('r3', 'a', 'b'),
      noteRow('r4', ''),
      noteRow('r5', 'Now the tests.'),
      callsRow('r6', 'c'),
      noteRow('r7', 'Fixed.'),
      promptRow('r8', 'Thanks, now the docs'),
      callsRow('r9', 'd'),
      noteRow('r10', 'Done.'),
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
  expect(folded).toEqual([
    { note: 'r2', leader: 'a' },
    { note: 'r4', leader: 'a' },
    { note: 'r5', leader: 'a' },
  ])
  expect(tracker).toEqual({ cursor: 'r10', open: 'd', notes: ['r10'] })
})

test('a note folds once a call follows it in a later read', () => {
  const first = advance(NOTHING_TRACKED, [noteRow('r1', 'Looking.')], CWD)
  const second = advance(first.tracker, [callsRow('r2', 'a')], CWD)

  expect(first.folded).toEqual([])
  expect(second.folded).toEqual([{ note: 'r1', leader: 'a' }])
})

test('a call read back with its outcome is settled', () => {
  const settled = (outcome: object) =>
    advance(
      NOTHING_TRACKED,
      [{ role: 'assistant', text: '', toolUses: [{ ...useOf('a'), ...outcome }] }],
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

test('a stack shows the worst calls in front, as many as fit', () => {
  const calls = [
    callOf('a', 'done'),
    callOf('b', 'failed'),
    callOf('c', 'running'),
    callOf('d', 'done'),
    callOf('e', 'done'),
  ]

  expect(discsOf(calls.slice(0, 1), 4)).toEqual(['done'])
  expect(discsOf(calls, 4)).toEqual(['failed', 'running', 'done', 'done'])
  expect(discsOf([...calls, ...calls, ...calls, ...calls], 4)).toEqual([
    'failed',
    'failed',
    'failed',
    'failed',
  ])
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

test('a run of calls is one line, drawn by its newest call', async ($, on) => {
  const transcript = standInForEngine(on)
  await run($, transcript, promptRow('r1', 'Fix the bug'))
  await run($, transcript, callsRow('r2', 'a', 'b'))
  await run($, transcript, noteRow('r3', 'Now the tests.'))
  await run($, transcript, callsRow('r4', 'c'))
  await run($, transcript, promptRow('r5', 'And the docs'))
  await run($, transcript, callsRow('r6', 'd'))

  expect(await lineOf($, rowOf('a'))).toBe('')
  expect(await lineOf($, rowOf('b'))).toBe('')
  expect(await lineOf($, rowOf('c'))).toBe('3 reads')
  expect(await lineOf($, rowOf('d'))).toBe('Read  src/d.rs')
})

test('a note between calls draws nothing, the closing one stays', async ($, on) => {
  const transcript = standInForEngine(on)
  await run($, transcript, noteRow('r1', 'Reading the code.'))
  await run($, transcript, callsRow('r2', 'a'))
  await run($, transcript, noteRow('r3', 'Fixed.'))

  expect(await drawnBy($, noteOf('r1'))).toBe('')
  expect(await drawnBy($, noteOf('r3'))).toBe(ENGINE_ROW)

  await $.command.run(RUN_FOLD)
  expect(await drawnBy($, noteOf('r1'))).toBe(ENGINE_ROW)
})

test('a summary of working text folds like a note', async ($, on) => {
  const transcript = standInForEngine(on)
  const summary = noteOf('r1', { isSummary: true })
  await run($, transcript, noteRow('r1', ''))
  expect(await drawnBy($, summary)).toBe(ENGINE_ROW)

  await run($, transcript, callsRow('r2', 'a'))
  expect(await drawnBy($, summary)).toBe('')
})

test('pressing a run line opens that run, and again folds it', async ($, on) => {
  const transcript = standInForEngine(on)
  const result: Target = {
    plugin: 'fold',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'b',
    props: { tool_use_id: 'b', tool: 'Read', output: {}, isErrored: false },
  }
  await run($, transcript, noteRow('r1', 'Reading the code.'))
  await run($, transcript, callsRow('r2', 'a', 'b'))
  await run($, transcript, promptRow('r3', 'And the docs'))
  await run($, transcript, callsRow('r4', 'c'))
  const rows = [rowOf('a'), rowOf('b'), result, noteOf('r1')].map(row => ({
    ...row,
    viewport: FULLSCREEN,
  }))
  const shown = () => Promise.all(rows.map(row => showsEngineRow($, row)))

  expect(await shown()).toEqual([false, false, false, false])

  await pressLine($, 'b', 'a')
  expect(await shown()).toEqual([true, true, true, true])
  expect(await lineOf($, rowOf('b'))).toBe('2 reads')
  expect(await showsEngineRow($, rowOf('c'))).toBe(false)
  expect(await showsEngineRow($, rowOf('b'))).toBe(false)

  await pressLine($, 'b', 'a')
  expect(await shown()).toEqual([false, false, false, false])
})

test('pressing the gutter beside any open row folds the run', async ($, on) => {
  const transcript = standInForEngine(on)
  await run($, transcript, noteRow('r1', 'Reading the code.'))
  await run($, transcript, callsRow('r2', 'a', 'b'))
  const note = { ...noteOf('r1'), viewport: FULLSCREEN }
  const pressGutter = async (target: Target, key: string) => {
    const ui = await $.ui.mount(target)
    await ui.press({ key })
    await ui.unmount()
  }

  await pressLine($, 'b', 'a')
  expect(await showsEngineRow($, note)).toBe(true)

  await pressGutter(note, 'a:r1')
  expect(await showsEngineRow($, note)).toBe(false)

  await pressLine($, 'b', 'a')
  await pressGutter({ ...rowOf('a'), viewport: FULLSCREEN }, 'a:a')
  expect(await showsEngineRow($, note)).toBe(false)
})

test('a run line is a button only where clicks arrive', async ($, on) => {
  const transcript = standInForEngine(on)
  await run($, transcript, callsRow('r1', 'a', 'b'))
  const hasButton = async (target: Target) => {
    const ui = await $.ui.mount(target)
    const button = await ui.find({ type: 'Button' })
    await ui.unmount()

    return button !== undefined
  }

  expect(await hasButton({ ...rowOf('b'), viewport: FULLSCREEN })).toBe(true)
  expect(await hasButton(rowOf('b'))).toBe(false)
  expect(await lineOf($, rowOf('b'))).toBe('2 reads')
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

const DONE = [78, 186, 101]
const FAILED = [255, 107, 128]

const done = (discs: number) => Array.from({ length: discs }, () => 'done' as const)

const colorsOf = ({ pixels }: { pixels: Uint8Array }) => {
  const opaque = new Map<string, number>()

  for (let at = 0; at < pixels.length; at += 4) {
    if (pixels[at + 3] === 255) {
      const color = pixels.slice(at, at + 3).join()
      opaque.set(color, (opaque.get(color) ?? 0) + 1)
    }
  }

  return opaque
}

test('a stack shows more of itself with every disc', () => {
  const inks = [1, 2, 3, 4].map(
    discs => pixelsOf(done(discs)).pixels.filter((value, at) => at % 4 === 3 && value > 0).length,
  )

  expect([1, 2, 3, 4].map(discs => stackOf(done(discs)).columns)).toEqual([
    2, 2, 3, 3,
  ])
  expect(inks).toEqual([...inks].sort((less, more) => less - more))
  expect(new Set(inks).size).toBe(4)
})

test('each disc takes the color of its own call, the front one opaque', () => {
  const mixed = pixelsOf(['failed', 'done', 'done'])
  const { pixels, width } = mixed
  const behind = (25 * width + 4) * 4

  expect([...colorsOf(mixed).keys()]).toEqual([FAILED.join()])
  expect(colorsOf(mixed).get(FAILED.join())).toBeGreaterThan(400)
  expect([...pixels.slice(behind, behind + 3)]).toEqual(DONE)
  expect(pixels[behind + 3]).toBeLessThan(255)
  expect([...colorsOf(pixelsOf(done(3))).keys()]).toEqual([DONE.join()])
})

test('pixels are packed as padded base64', () => {
  const { rgba } = stackOf(done(1))

  expect(rgba).toHaveLength((pixelsOf(done(1)).pixels.length / 3) * 4)
  expect(rgba.endsWith('=')).toBe(false)
  expect(rgba.startsWith('AAAAAAAAAAAA')).toBe(true)
})

test('each call adds a disc to the stack, up to four', async ($, on) => {
  const transcript = standInForEngine(on)
  const { columns: _, ...four } = stackOf(done(4))

  await run($, transcript, callsRow('r1', 'a'))
  expect(await stackDrawnBy($, rowOf('a'))).toMatchObject({
    rgba: stackOf(done(1)).rgba,
  })
  await run($, transcript, callsRow('r2', 'b', 'c'))
  expect(await stackDrawnBy($, rowOf('c'))).toMatchObject({
    rgba: stackOf(done(3)).rgba,
  })
  await run($, transcript, callsRow('r3', 'd', 'e', 'f'))
  expect(await stackDrawnBy($, rowOf('f'))).toEqual(four)
})

test('a failed call is the red disc in front of its run', async ($, on) => {
  const transcript = standInForEngine(on, { failing: ['b'] })
  await run($, transcript, callsRow('r1', 'a', 'b', 'c'))

  expect(await stackDrawnBy($, rowOf('c'))).toMatchObject({
    rgba: stackOf(['failed', 'done', 'done']).rgba,
  })
  expect(await lineOf($, rowOf('c'))).toBe('3 reads · 1 failed')
})

test('a call nothing tracked draws its own line once it settled', async ($, on) => {
  standInForEngine(on)

  expect(await lineOf($, rowOf('z'))).toBe('Read  src/z.rs')
  expect(await lineOf($, rowOf('z', { isRunning: true }))).toBe('')
})

test('a group of calls draws the run its newest call ends', async ($, on) => {
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

  expect(await lineOf($, groupOf('a', 'b'))).toBe('')
  expect(await lineOf($, groupOf('b', 'c'))).toBe('3 reads')
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
