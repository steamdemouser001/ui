import type {
  IterationDefaults,
  IterationRecord,
  OrchestratorAction,
  OrchestratorMessage,
  PendingApproval,
  RunEvent,
  RunProgress,
  RunState,
  RunStatus,
  TaskRecord,
  TaskStatus,
} from "@/lib/gepa/types"
import type { WorkspaceEntry, WorkspaceSummary } from "@/lib/gepa/workspace"

export interface RunSummary {
  id: string
  status: RunStatus
  iteration: number
  budget: number
  budgetUsed: number
  bestScore: number | null
  candidates: number
  acceptedIterations: number
  startedAt: string
  updatedAt: string
  finishedAt?: string
  error?: string
  totalCostUsd?: number
  harnessKind?: string
  awaitingApproval?: boolean
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

/** 运行历史条目（GET /api/gepa/tasks/[taskId]/runs）。 */
export interface RunsListResponse {
  runs: RunSummary[]
}

/** 单次运行完整状态（GET /api/gepa/tasks/[taskId]/runs/[runId]）。 */
export interface RunDetailResponse {
  run: RunState
}

/** rollout 产物文件列表（GET /api/gepa/tasks/[taskId]/rollout?...）。 */
export interface RolloutFilesResponse {
  entries: WorkspaceEntry[]
}

/** rollout 产物文件内容。 */
export interface RolloutContentResponse {
  path: string
  content: string
}

/** SSE run-event 事件（任务详情页实时直播）。 */
export type RunEventView = RunEvent

export type { RunProgress, PendingApproval, IterationRecord }

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
