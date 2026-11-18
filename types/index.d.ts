export type Status = 'running' | 'done' | 'failed'

export type Call = { id: string; tool: string; gist: string; status: Status }

export type Tracker = {
  cursor: string | null
  open: string | null
  notes: string[]
}

declare module 'claude-code' {
  interface PluginState {
    fold: {
      isFolded: boolean
      tracker: Shaped<Tracker>
      leaders: StateFamily<string>
      runs: StateFamily<Call[]>
      foldedNotes: StateFamily<boolean>
    }
  }
}
