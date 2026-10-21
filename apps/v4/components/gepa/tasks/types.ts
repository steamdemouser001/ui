import type {
  IterationDefaults,
  OrchestratorAction,
  OrchestratorMessage,
  RunState,
  RunStatus,
  TaskRecord,
  TaskStatus,
} from "@/lib/gepa/types"
import type {
  WorkspaceEntry,
  WorkspaceSummary,
} from "@/lib/gepa/workspace"

export interface RunSummary {
  id: string
  status: RunStatus
  iteration: number
  budget: number
  budgetUsed: number
  bestScore: number | null
  candidates: number
  startedAt: string
  updatedAt: string
  finishedAt?: string
  error?: string
}

export interface TaskSummary {
  id: string
  name: string
  description: string
  status: TaskStatus
  modules: number
  dataset: number
  iteration: IterationDefaults
  run: RunSummary | null
  createdAt: string
  updatedAt: string
}

export interface TaskDetailData {
  task: TaskRecord
  run: RunState | null
  runs: RunSummary[]
  messages: OrchestratorMessage[]
  workspace: WorkspaceSummary
}

/** 动作结果：服务端在动作字段上附加 ok/message。 */
export type ActionResult = OrchestratorAction & {
  ok?: boolean
  message?: string
}

export interface OrchestratorResponse {
  reply: string
  actions: ActionResult[]
  run: RunState | null
}

export interface WorkspaceFilesResponse {
  files: WorkspaceEntry[]
  summary: WorkspaceSummary
}

export interface WorkspaceContentResponse {
  path: string
  content: string
}

export function messageActions(message: OrchestratorMessage): ActionResult[] {
  return Array.isArray(message.actions)
    ? (message.actions as ActionResult[])
    : []
}
