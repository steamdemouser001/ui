export type SettingsSection = "iteration" | "monitor" | "harness"

export type SettingsAction = SettingsSection | "import" | "reset"

export interface IterationDraft {
  budget: string
  minibatchSize: string
  paretoSize: string
  maxIterations: string
  moduleSelection: "round-robin" | "random"
  mergeEnabled: boolean
  humanApproval: boolean
}

export interface MonitorDraft {
  inputCostPerMillion: string
  outputCostPerMillion: string
  cacheCostPerMillion: string
  retentionDays: string
}

export interface HarnessDraft {
  kind: "llm" | "claude-code"
  claudePath: string
  model: string
  allowedTools: string
  maxUsdPerRollout: string
  maxUsdPerRun: string
  timeoutMs: string
  maxConcurrent: string
}

export type SettingsDraft = IterationDraft & MonitorDraft & HarnessDraft
