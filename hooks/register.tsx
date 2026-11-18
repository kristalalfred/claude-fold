import { atom, read, update } from 'claude-code'
import type { Elements, Register } from 'claude-code'

import type { Call, Status } from '../types'
import { gistOf } from './gist'
import { discsOf, summaryOf } from './runs'
import { stackOf } from './stack'
import {
  isRunExpanded,
  leaderOf,
  runOf,
  runOfNote,
  settleCall,
  toggleRun,
  trackRuns,
} from './track'

const COMMAND = 'fold'
const STORE_KEY = 'isFolded'
const DISC_LIMIT = 4
const STACK_ALT = '⏺'
const isFolded = atom({ plugin: 'fold', key: 'isFolded' } as const, true)

type Drawn = {
  tool_use_id?: string
  tool: string
  input: unknown
  isRunning: boolean
  isErrored: boolean
  isInterrupted: boolean
}

const statusOf = (drawn: Drawn): Status => {
  if (drawn.isErrored || drawn.isInterrupted) {
    return 'failed'
  }

  return drawn.isRunning ? 'running' : 'done'
}

const callOf = (drawn: Drawn, cwd: string): Call => ({
  id: drawn.tool_use_id ?? '',
  tool: drawn.tool,
  gist: gistOf(drawn.input, cwd),
  status: statusOf(drawn),
})

const drawRun = (
  { Box, Text, Image, Button }: Elements['terminal'],
  calls: readonly Call[],
  toggle?: { key: string; onPress: () => void },
) => {
  const isLive = calls.some(call => call.status === 'running')
  const failed = calls.filter(call => call.status === 'failed').length
  const { columns, ...source } = stackOf(discsOf(calls, DISC_LIMIT))
  const failures = calls.length > 1 && failed > 0 && (
    <Text color="error"> · {failed} failed</Text>
  )

  return (
    <Box marginTop={1}>
      <Image source={source} columns={columns} rows={1} alt={STACK_ALT} />
      <Text> </Text>
      {toggle === undefined ? (
        <Text dimColor={!isLive} wrap="truncate-end">
          {summaryOf(calls)}
        </Text>
      ) : (
        <Button {...toggle} plain dimColor={!isLive}>
          {summaryOf(calls)}
          {failures}
        </Button>
      )}
      {toggle === undefined && failures}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Fold or unfold tool calls and working notes in the transcript',
    })
    const stored = await $.store.get(STORE_KEY)

    if (typeof stored === 'boolean') {
      await update($, isFolded, () => stored)
    }
    await trackRuns($)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const folds = !(await read($, isFolded))
    await update($, isFolded, () => folds)
    await $.store.set(STORE_KEY, folds)
    $.ui.toast(folds ? 'Tool calls folded' : 'Tool calls unfolded')

    return {}
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }
    const tracked = trackRuns($, e.tool_use_id).catch(() => undefined)
    let status: Status = 'failed'

    try {
      const ran = await next(e)
      status = ran.deny === undefined && ran.isError !== true ? 'done' : 'failed'

      return ran
    } finally {
      await tracked
      await settleCall($, e.tool_use_id, status).catch(() => undefined)
    }
  })

  on(
    'ui.render',
    { component: 'ToolUse', surface: 'terminal' },
    async ($, e, next) => {
      if (e.props.isExpanded || !(await read($, isFolded))) {
        return next(e)
      }
      const table = $.ui.resolve(e)
      const id = e.props.tool_use_id
      const leader = await leaderOf($, id)

      if (leader === undefined) {
        return e.props.isRunning ? (
          <table.Box />
        ) : (
          drawRun(table, [callOf(e.props, await $.session.cwd())])
        )
      }
      const isOpen = await isRunExpanded($, leader)
      const run = leader === id ? await runOf($, id) : undefined

      return (
        <table.Box flexDirection="column">
          {run !== undefined &&
            drawRun(table, run, {
              key: leader,
              onPress: () => void toggleRun($, leader),
            })}
          {isOpen && (await next(e))}
        </table.Box>
      )
    },
  )

  on(
    'ui.render',
    { component: 'AssistantMessage', surface: 'terminal' },
    async ($, e, next) => {
      const leader = (await read($, isFolded))
        ? await runOfNote($, e.requestId)
        : undefined

      if (leader === undefined || (await isRunExpanded($, leader))) {
        return next(e)
      }
      const { Box } = $.ui.resolve(e)

      return <Box />
    },
  )

  on(
    'ui.render',
    { component: 'ToolResult', surface: 'terminal' },
    async ($, e, next) => {
      if (e.props.isExpanded || !(await read($, isFolded))) {
        return next(e)
      }
      const leader = await leaderOf($, e.props.tool_use_id)

      if (leader !== undefined && (await isRunExpanded($, leader))) {
        return next(e)
      }
      const { Box } = $.ui.resolve(e)

      return <Box />
    },
  )

  on(
    'ui.render',
    { component: 'ToolGroup', surface: 'terminal' },
    async ($, e, next) => {
      const isDetailView =
        e.props.isExpanded && e.viewport?.isFullscreen !== true

      if (isDetailView || !(await read($, isFolded))) {
        return next(e)
      }
      const table = $.ui.resolve(e)
      const ids = e.props.calls.map(call => call.tool_use_id ?? '')
      const leaders = await Promise.all(ids.map(id => leaderOf($, id)))
      const leader = leaders.find(known => known !== undefined)

      if (leader === undefined) {
        const cwd = await $.session.cwd()

        return e.props.isActive ? (
          <table.Box />
        ) : (
          drawRun(
            table,
            e.props.calls.map(call => callOf(call, cwd)),
          )
        )
      }
      const isOpen = await isRunExpanded($, leader)
      const run = ids.includes(leader) ? await runOf($, leader) : undefined

      return (
        <table.Box flexDirection="column">
          {run !== undefined &&
            drawRun(table, run, {
              key: leader,
              onPress: () => void toggleRun($, leader),
            })}
          {isOpen && (await next(e))}
        </table.Box>
      )
    },
  )
}
