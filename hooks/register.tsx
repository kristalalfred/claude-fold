import { atom, read, update } from 'claude-code'
import type { ElementTable, Register } from 'claude-code'

import { lineOf } from './gist'

const COMMAND = 'fold'
const STORE_KEY = 'isFolded'
const isFolded = atom({ plugin: 'fold', key: 'isFolded' } as const, true)

type Row = { text: string; isLive: boolean; isFailed: boolean }

const drawRow = ({ Box, Text }: ElementTable, row: Row) => (
  <Box paddingLeft={2}>
    <Text color={row.isFailed ? 'error' : undefined} dimColor={!row.isFailed}>
      {'▸ '}
    </Text>
    <Text dimColor={!row.isLive} wrap="truncate-end">
      {row.text}
    </Text>
  </Box>
)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Fold or unfold tool calls in the transcript',
    })
    const stored = await $.store.get(STORE_KEY)

    if (typeof stored === 'boolean') {
      await update($, isFolded, () => stored)
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const folds = !(await read($, isFolded))
    await update($, isFolded, () => folds)
    await $.store.set(STORE_KEY, folds)
    $.ui.toast(folds ? 'Tool calls folded' : 'Tool calls unfolded')

    return {}
  })

  on(
    'ui.render',
    { component: 'ToolUse', surface: 'terminal' },
    async ($, e, next) => {
      if (e.props.isExpanded || !(await read($, isFolded))) {
        return next(e)
      }

      return drawRow($.ui.resolve(e), {
        text: lineOf([e.props], await $.session.cwd()),
        isLive: e.props.isRunning,
        isFailed: e.props.isErrored || e.props.isInterrupted,
      })
    },
  )

  on(
    'ui.render',
    { component: 'ToolResult', surface: 'terminal' },
    async ($, e, next) => {
      if (e.props.isExpanded || !(await read($, isFolded))) {
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
      if (
        e.props.isExpanded ||
        e.props.isCallsOnly === false ||
        !(await read($, isFolded))
      ) {
        return next(e)
      }

      return drawRow($.ui.resolve(e), {
        text: lineOf(e.props.calls, await $.session.cwd()),
        isLive: e.props.isActive,
        isFailed: false,
      })
    },
  )
}
