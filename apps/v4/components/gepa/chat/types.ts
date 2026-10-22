import type {
  ChatSessionMeta,
  IterationDefaults,
  OrchestratorAction,
  RunStatus,
  TaskStatus,
} from "@/lib/gepa/types"

export interface ChatAction extends OrchestratorAction {
  ok?: boolean
  message?: string
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  at: string
  actions?: ChatAction[]
  reasoning?: string
  streaming?: boolean
}

export interface ChatRun {
  id: string
  status: RunStatus
  iteration: number
  budget: number
  budgetUsed: number
  bestScore: number | null
  candidates: number
}

/** 与后端 TaskSummary 对齐；本地定义以避免客户端引入服务端模块。 */
export interface ChatTask {
  id: string
  name: string
  description: string
  status: TaskStatus
  modules: number
  dataset: number
  iteration: IterationDefaults
  run: ChatRun | null
  createdAt: string
  updatedAt: string
}

export interface SessionsResponse {
  sessions: ChatSessionMeta[]
  tasks: ChatTask[]
}

export interface SessionDetailResponse {
  session: ChatSessionMeta
  messages: ChatMessage[]
  tasks: ChatTask[]
}

export interface ChatDonePayload {
  reply: string
  actions: ChatAction[]
  tasks: ChatTask[]
}

export interface SessionRuntime {
  loaded: boolean
  loading: boolean
  error: string | null
  messages: ChatMessage[]
  streaming: boolean
  status: string | null
  streamError: string | null
}

export function emptyRuntime(loaded = false): SessionRuntime {
  return {
    loaded,
    loading: false,
    error: null,
    messages: [],
    streaming: false,
    status: null,
    streamError: null,
  }
}
