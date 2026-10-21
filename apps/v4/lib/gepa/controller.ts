import { randomUUID } from "node:crypto"

import { describeConstraints } from "./constraints"
import { runAgentJson } from "./llm"
import {
  executeTaskAction,
  type OrchestratorActionResult,
} from "./orchestrator"
import {
  appendGlobalMessage,
  clearGlobalMessages,
  listRuns,
  readGlobalMessages,
  readRun,
  readSettings,
  readTask,
} from "./storage"
import {
  createTask,
  deleteTask,
  listTaskSummaries,
  updateTask,
  type TaskSummary,
} from "./task-service"
import type {
  OrchestratorAction,
  OrchestratorMessage,
  RunState,
  TaskRecord,
} from "./types"

const MAX_ACTIONS = 10
const MAX_MESSAGE_LENGTH = 4000
const HISTORY_LIMIT = 12
const HISTORY_CONTENT_LIMIT = 600

export interface ControllerReply {
  reply: string
  actions: OrchestratorActionResult[]
  tasks: TaskSummary[]
}

interface ControllerPayload {
  reply?: unknown
  actions?: unknown
}

function nowIso(): string {
  return new Date().toISOString()
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function formatTasks(tasks: TaskSummary[]): string {
  if (tasks.length === 0) return "（暂无任务）"
  return tasks
    .map((task) => {
      const run = task.run
        ? `运行：${task.run.status}/第${task.run.iteration}轮/预算 ${task.run.budgetUsed}/${task.run.budget}/最佳分 ${
            task.run.bestScore !== null ? task.run.bestScore.toFixed(3) : "暂无"
          }`
        : "运行：无运行"
      return `${task.id}｜${task.name}｜${task.status}｜数据集 ${task.dataset} 条｜模块 ${task.modules} 个｜${run}`
    })
    .join("\n")
}

function formatHistory(messages: OrchestratorMessage[]): string {
  const recent = messages.slice(-HISTORY_LIMIT)
  if (recent.length === 0) return "（无历史消息）"
  const roleLabels: Record<OrchestratorMessage["role"], string> = {
    user: "用户",
    assistant: "助手",
    system: "系统",
  }
  return recent
    .map((message) => {
      const actions =
        Array.isArray(message.actions) && message.actions.length > 0
          ? `（操作：${message.actions
              .map((action) => {
                const target =
                  typeof action.taskId === "string" && action.taskId
                    ? `@${action.taskId}`
                    : ""
                const failed =
                  "ok" in action && action.ok === false ? "（失败）" : ""
                return `${action.type}${target}${failed}`
              })
              .join("、")}）`
          : ""
      return `${roleLabels[message.role] ?? message.role}：${truncate(
        message.content,
        HISTORY_CONTENT_LIMIT
      )}${actions}`
    })
    .join("\n")
}

async function latestRunOf(task: TaskRecord): Promise<RunState | null> {
  if (task.runId) {
    const run = await readRun(task.id, task.runId).catch(() => null)
    if (run) return run
  }
  const runs = await listRuns(task.id).catch(() => [] as RunState[])
  return runs[0] ?? null
}

async function executeControllerAction(
  raw: OrchestratorAction
): Promise<OrchestratorActionResult> {
  const type = typeof raw.type === "string" ? raw.type : ""
  const action = { ...raw, type: type as OrchestratorAction["type"] }
  const taskId = typeof raw.taskId === "string" ? raw.taskId.trim() : ""

  try {
    switch (type) {
      case "createTask": {
        const name = typeof raw.name === "string" ? raw.name.trim() : ""
        if (!name) {
          throw new Error("createTask 缺少任务名称 name")
        }
        const task = await createTask({
          name,
          description:
            typeof raw.description === "string" ? raw.description : undefined,
          prompt: typeof raw.prompt === "string" ? raw.prompt : undefined,
          datasetText:
            typeof raw.datasetText === "string" ? raw.datasetText : undefined,
        })
        return {
          ...action,
          taskId: task.id,
          ok: true,
          message: `已创建任务「${task.name}」（${task.id}）`,
        }
      }
      case "deleteTask": {
        if (!taskId) {
          throw new Error("deleteTask 缺少 taskId")
        }
        await deleteTask(taskId)
        return { ...action, ok: true, message: `已删除任务 ${taskId}` }
      }
      case "updateTask": {
        if (!taskId) {
          throw new Error("updateTask 缺少 taskId")
        }
        const patch: { name?: string; description?: string } = {}
        if (typeof raw.name === "string") patch.name = raw.name
        if (typeof raw.description === "string") {
          patch.description = raw.description
        }
        if (patch.name === undefined && patch.description === undefined) {
          throw new Error("updateTask 缺少 name 或 description")
        }
        const task = await updateTask(taskId, patch)
        return {
          ...action,
          ok: true,
          message: `已更新任务「${task.name}」（${task.id}）`,
        }
      }
      default: {
        if (!taskId) {
          throw new Error(`${type || "该操作"}缺少 taskId`)
        }
        const task = await readTask(taskId)
        if (!task) {
          throw new Error(`任务不存在：${taskId}`)
        }
        const run = await latestRunOf(task)
        const outcome = await executeTaskAction(taskId, action, { task, run })
        // 合并原动作字段（如 taskId），便于前端与历史记录展示。
        return { ...action, ...outcome }
      }
    }
  } catch (error) {
    return { ...action, ok: false, message: errorText(error) }
  }
}

/**
 * 与全局调度器对话：注入全部任务摘要、约束与全局历史，解析 LLM 返回的
 * 跨任务动作并顺序执行。单个动作失败不会影响其他动作。
 */
export async function chatWithController(
  message: string
): Promise<ControllerReply> {
  const trimmed = typeof message === "string" ? message.trim() : ""
  if (!trimmed) {
    throw new Error("消息不能为空")
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`消息过长（上限 ${MAX_MESSAGE_LENGTH} 字符）`)
  }

  const [settings, tasks, history] = await Promise.all([
    readSettings(),
    listTaskSummaries(),
    readGlobalMessages(HISTORY_LIMIT),
  ])

  const userMessage: OrchestratorMessage = {
    id: randomUUID(),
    role: "user",
    content: trimmed,
    at: nowIso(),
  }
  await appendGlobalMessage(userMessage)

  const variables: Record<string, string> = {
    tasks: formatTasks(tasks),
    constraints: describeConstraints(settings.constraints),
    history: formatHistory(history),
    message: trimmed,
  }

  let payload: ControllerPayload
  try {
    const response = await runAgentJson<ControllerPayload>(
      "controller",
      variables
    )
    payload = isRecord(response.data) ? response.data : {}
  } catch (error) {
    await appendGlobalMessage({
      id: randomUUID(),
      role: "assistant",
      content: `全局调度调用失败：${errorText(error)}`,
      at: nowIso(),
    }).catch(() => undefined)
    throw error
  }

  const requested = Array.isArray(payload.actions)
    ? payload.actions.filter(isRecord).slice(0, MAX_ACTIONS)
    : []

  const actions: OrchestratorActionResult[] = []
  for (const raw of requested) {
    actions.push(
      await executeControllerAction(raw as unknown as OrchestratorAction)
    )
  }

  const reply =
    typeof payload.reply === "string" && payload.reply.trim()
      ? payload.reply.trim()
      : "（无回复）"

  const assistantMessage: OrchestratorMessage = {
    id: randomUUID(),
    role: "assistant",
    content: reply,
    at: nowIso(),
  }
  if (actions.length > 0) {
    assistantMessage.actions = actions
  }
  await appendGlobalMessage(assistantMessage)

  return {
    reply,
    actions,
    tasks: await listTaskSummaries(),
  }
}

export async function clearGlobalChat(): Promise<void> {
  await clearGlobalMessages()
}
