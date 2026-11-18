export type Status = 'running' | 'done' | 'failed'

export type Call = { id: string; tool: string; gist: string; status: Status }

export type Tracker = { cursor: string | null; open: string | null }

declare module 'claude-code' {
  interface PluginState {
    fold: {
      isFolded: boolean
      tracker: Tracker
      leaders: StateFamily<string>
      runs: StateFamily<Call[]>
    }
  }
}
