export type SettingsSection = "iteration" | "monitor"

export type SettingsAction = SettingsSection | "import" | "reset"

export interface IterationDraft {
  budget: string
  minibatchSize: string
  paretoSize: string
  maxIterations: string
  moduleSelection: "round-robin" | "random"
  mergeEnabled: boolean
}

export interface MonitorDraft {
  inputCostPerMillion: string
  outputCostPerMillion: string
  retentionDays: string
}

export type SettingsDraft = IterationDraft & MonitorDraft
