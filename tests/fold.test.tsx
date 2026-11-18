import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { gistOf, lineOf, nameOf } from '../hooks/gist'

const CWD = '/work/project'
const ENGINE_ROW = 'engine row'

const CALL = {
  tool_use_id: 'call-1',
  tool: 'Read',
  input: { file_path: `${CWD}/src/main.rs` },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
}

const TOOL_USE = {
  plugin: 'fold',
  surface: 'terminal',
  component: 'ToolUse',
  requestId: 'call-1',
} as const

const TOOL_RESULT = {
  plugin: 'fold',
  surface: 'terminal',
  component: 'ToolResult',
  requestId: 'call-1',
  props: { tool_use_id: 'call-1', tool: 'Read', output: {}, isErrored: false },
} as const

const RUN_FOLD = {
  command: 'fold',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

const standInForEngine = (on: Parameters<TestBody>[1], stored?: boolean) => {
  on('command.register', () => ({ value: { command: 'fold' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: CWD }))
  on('store.get', () => ({ value: stored }))
  on('store.set', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{ENGINE_ROW}</Text>
  })
}

const textsOf = async (
  $: Parameters<TestBody>[0],
  target: Parameters<Parameters<TestBody>[0]['ui']['mount']>[0],
) => {
  const ui = await $.ui.mount(target)
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  await ui.unmount()

  return texts
}

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

test('one call reads as its gist, several as a tally', () => {
  expect(lineOf([CALL], CWD)).toBe('Read  src/main.rs')
  expect(lineOf([{ tool: 'TaskList', input: {} }], CWD)).toBe('TaskList')
  expect(
    lineOf([CALL, CALL, { tool: 'Grep', input: { pattern: 'x' } }], CWD),
  ).toBe('Read ×2, Grep')
})

test('a tool call is one line and its result nothing', async ($, on) => {
  standInForEngine(on)

  expect(await textsOf($, { ...TOOL_USE, props: CALL })).toEqual([
    '▸ ',
    'Read  src/main.rs',
  ])
  expect(await textsOf($, TOOL_RESULT)).toEqual([])
})

test('a group of calls is one line', async ($, on) => {
  standInForEngine(on)
  const group = {
    plugin: 'fold',
    surface: 'terminal',
    component: 'ToolGroup',
    requestId: 'group-1',
    props: { calls: [CALL, CALL], isActive: false, isExpanded: false },
  } as const

  expect(await textsOf($, group)).toEqual(['▸ ', 'Read ×2'])
})

test('a failed call marks its line', async ($, on) => {
  standInForEngine(on)
  const failed = { ...CALL, isErrored: true }
  const markOf = async (
    target: Parameters<Parameters<TestBody>[0]['ui']['mount']>[0],
  ) => {
    const ui = await $.ui.mount(target)
    const mark = await ui.find({ type: 'Text', text: '▸ ' })
    await ui.unmount()

    return mark?.props.color
  }

  expect(await markOf({ ...TOOL_USE, props: CALL })).toBeUndefined()
  expect(await markOf({ ...TOOL_USE, props: failed })).toBe('error')
  expect(
    await markOf({
      plugin: 'fold',
      surface: 'terminal',
      component: 'ToolGroup',
      requestId: 'group-1',
      props: { calls: [CALL, failed], isActive: false, isExpanded: false },
    }),
  ).toBe('error')
})

test('the expanded transcript keeps the full rows', async ($, on) => {
  standInForEngine(on)

  expect(
    await textsOf($, { ...TOOL_USE, props: { ...CALL, isExpanded: true } }),
  ).toEqual([ENGINE_ROW])
  expect(
    await textsOf($, {
      ...TOOL_RESULT,
      props: { ...TOOL_RESULT.props, isExpanded: true },
    }),
  ).toEqual([ENGINE_ROW])
})

test('the command switches between folded and full rows', async ($, on) => {
  standInForEngine(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })

  await $.command.run(RUN_FOLD)
  expect(await textsOf($, { ...TOOL_USE, props: CALL })).toEqual([ENGINE_ROW])
  expect(await textsOf($, TOOL_RESULT)).toEqual([ENGINE_ROW])

  await $.command.run(RUN_FOLD)
  expect(await textsOf($, { ...TOOL_USE, props: CALL })).toEqual([
    '▸ ',
    'Read  src/main.rs',
  ])
})

test('a session starts in the mode last chosen', async ($, on) => {
  standInForEngine(on, false)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })

  expect(await textsOf($, { ...TOOL_USE, props: CALL })).toEqual([ENGINE_ROW])
})
