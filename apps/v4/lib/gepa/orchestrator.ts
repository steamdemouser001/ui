import { randomUUID } from "node:crypto"

import { describeConstraints } from "./constraints"
import { runAgentJson } from "./llm"
import {
  getRunStatus,
  pauseRun,
  resumeRun,
  startRun,
  stepRun,
  stopRun,
} from "./run-manager"
import {
  appendOrchestratorMessage,
  listRuns,
  readOrchestratorMessages,
  readRun,
  readSettings,
  readTask,
  writeRun,
  writeTask,
} from "./storage"
import { sanitizeIteration } from "./task-service"
import type {
  OrchestratorAction,
  OrchestratorMessage,
  RunLogEntry,
  RunState,
  TaskRecord,
} from "./types"

const MAX_ACTIONS = 10
const MAX_MESSAGE_LENGTH = 4000
const HISTORY_LIMIT = 12
const LOG_LIMIT = 10

/** 动作执行结果：在原动作字段上附带 ok 与说明。 */
export interface OrchestratorActionResult extends OrchestratorAction {
  ok: boolean
  message: string
}

export interface OrchestratorReply {
  reply: string
  actions: OrchestratorActionResult[]
  run: RunState | null
}

interface OrchestratorPayload {
  reply?: unknown
  actions?: unknown
}

/** 单任务动作执行上下文；controller 复用同一执行器。 */
export interface ActionContext {
  task: TaskRecord
  run: RunState | null
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

function result(
  type: string,
  ok: boolean,
  message: string
): OrchestratorActionResult {
  return { type: type as OrchestratorAction["type"], ok, message }
}

async function latestRunOf(task: TaskRecord): Promise<RunState | null> {
  if (task.runId) {
    const run = await readRun(task.id, task.runId)
    if (run) return run
  }
  const runs = await listRuns(task.id).catch(() => [] as RunState[])
  return runs[0] ?? null
}

function formatTask(task: TaskRecord): string {
  const lines = [
    `名称：${task.name}`,
    `ID：${task.id}`,
    `状态：${task.status}`,
    `描述：${task.description || "（无）"}`,
    `数据集：${task.dataset.length} 条示例`,
    `迭代参数：预算 ${task.iteration.budget}，minibatch ${task.iteration.minibatchSize}，帕累托样本 ${task.iteration.paretoSize}，最大轮数 ${task.iteration.maxIterations}，模块选择 ${
      task.iteration.moduleSelection === "random" ? "随机" : "轮询"
    }`,
    "模块：",
    ...(task.modules.length > 0
      ? task.modules.map(
          (module) =>
            `- ${module.id}｜${module.name}（提示词 ${module.prompt.length} 字）`
        )
      : ["（无）"]),
  ]
  if (task.notes.trim()) {
    lines.push(`备注：${truncate(task.notes, 300)}`)
  }
  return lines.join("\n")
}

function formatRun(run: RunState | null): string {
  if (!run) return "尚无运行记录。"
  const best =
    run.candidates.find((candidate) => candidate.id === run.bestCandidateId) ??
    null
  const bestScore =
    typeof best?.averageScore === "number" && Number.isFinite(best.averageScore)
      ? best.averageScore.toFixed(3)
      : null
  const logs = run.logs
    .slice(-LOG_LIMIT)
    .map(
      (entry) =>
        `[${entry.at}] ${entry.level}${entry.iteration !== undefined ? `（第 ${entry.iteration} 轮）` : ""} ${truncate(entry.message, 200)}`
    )

  return [
    `运行：${run.id}`,
    `状态：${run.status}`,
    `迭代：第 ${run.iteration} 轮`,
    `预算：已用 ${run.budgetUsed} / ${run.budget}`,
    `候选：${run.candidates.length} 个`,
    `最佳候选：${
      best && bestScore !== null ? `${best.id}（平均分 ${bestScore}）` : "暂无"
    }`,
    `帕累托前沿：${
      run.paretoFrontier.length > 0 ? run.paretoFrontier.join("、") : "暂无"
    }`,
    run.error ? `错误：${run.error}` : "",
    "最近日志：",
    ...(logs.length > 0 ? logs : ["（无）"]),
  ]
    .filter(Boolean)
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
          ? `（操作：${message.actions.map((action) => action.type).join("、")}）`
          : ""
      return `${roleLabels[message.role] ?? message.role}：${truncate(
        message.content,
        600
      )}${actions}`
    })
    .join("\n")
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}必须是数字`)
  }
  return value
}

/** 执行单任务动作；供单任务总控与全局调度器共用。 */
export async function executeTaskAction(
  taskId: string,
  action: OrchestratorAction,
  context: ActionContext
): Promise<OrchestratorActionResult> {
  const type = typeof action.type === "string" ? action.type : ""
  try {
    switch (type) {
      case "start": {
        const run = await startRun(taskId)
        context.run = run
        return result(
          type,
          true,
          run.status === "running"
            ? `已开始运行（${run.id}）`
            : `运行已在进行中（${run.id}）`
        )
      }
      case "resume": {
        const run = await resumeRun(taskId)
        context.run = run
        return result(type, true, `已继续运行（${run.id}）`)
      }
      case "pause": {
        const run = await pauseRun(taskId)
        context.run = run
        return result(
          type,
          true,
          `已请求暂停（${run.id}），将在当前轮次结束后生效`
        )
      }
      case "stop": {
        const run = await stopRun(taskId)
        context.run = run
        return result(type, true, `已请求停止（${run.id}）`)
      }
      case "step": {
        const run = await stepRun(taskId)
        context.run = run
        return result(type, true, `已执行单步迭代（${run.id}）`)
      }
      case "setBudget": {
        if (action.budget === undefined) {
          throw new Error("setBudget 缺少 budget 参数")
        }
        const iteration = sanitizeIteration(context.task.iteration, {
          budget: requireNumber(action.budget, "预算"),
        })
        context.task.iteration = iteration
        context.task.updatedAt = nowIso()
        await writeTask(context.task)
        if (context.run && context.run.status !== "running") {
          context.run.budget = iteration.budget
          context.run.updatedAt = nowIso()
          await writeRun(context.run)
        }
        return result(type, true, `预算已设置为 ${iteration.budget}`)
      }
      case "setMinibatch": {
        if (action.minibatchSize === undefined) {
          throw new Error("setMinibatch 缺少 minibatchSize 参数")
        }
        const iteration = sanitizeIteration(context.task.iteration, {
          minibatchSize: requireNumber(action.minibatchSize, "minibatch 大小"),
        })
        context.task.iteration = iteration
        context.task.updatedAt = nowIso()
        await writeTask(context.task)
        return result(
          type,
          true,
          `minibatch 大小已设置为 ${iteration.minibatchSize}`
        )
      }
      case "setIterationLimit": {
        if (action.maxIterations === undefined) {
          throw new Error("setIterationLimit 缺少 maxIterations 参数")
        }
        const iteration = sanitizeIteration(context.task.iteration, {
          maxIterations: requireNumber(action.maxIterations, "最大迭代轮数"),
        })
        context.task.iteration = iteration
        context.task.updatedAt = nowIso()
        await writeTask(context.task)
        return result(
          type,
          true,
          `最大迭代轮数已设置为 ${iteration.maxIterations}`
        )
      }
      case "updateModulePrompt": {
        const moduleId =
          typeof action.moduleId === "string" ? action.moduleId.trim() : ""
        if (!moduleId) {
          throw new Error("updateModulePrompt 缺少 moduleId")
        }
        const prompt =
          typeof action.prompt === "string" ? action.prompt.trim() : ""
        if (!prompt) {
          throw new Error("新的模块提示词不能为空")
        }
        const index = context.task.modules.findIndex(
          (module) => module.id === moduleId
        )
        if (index === -1) {
          throw new Error(`找不到模块：${moduleId}`)
        }
        context.task.modules = context.task.modules.map((module) =>
          module.id === moduleId ? { ...module, prompt } : module
        )
        context.task.updatedAt = nowIso()
        await writeTask(context.task)

        // 候选为空时下一轮会用任务模块重建种子候选；已存在且未评分的种子候选需要同步。
        const seed = context.run?.candidates.find(
          (candidate) =>
            candidate.parentId === null &&
            Object.keys(candidate.scores ?? {}).length === 0
        )
        if (context.run && seed && Array.isArray(seed.modules)) {
          seed.modules = seed.modules.map((module) =>
            module.id === moduleId ? { ...module, prompt } : module
          )
          context.run.updatedAt = nowIso()
          await writeRun(context.run)
        }
        return result(type, true, `模块「${moduleId}」的提示词已更新`)
      }
      case "note": {
        const note = typeof action.note === "string" ? action.note.trim() : ""
        if (!note) {
          throw new Error("note 内容不能为空")
        }
        if (context.run) {
          const entry: RunLogEntry = {
            id: randomUUID(),
            at: nowIso(),
            level: "info",
            message: `总控备注：${note}`,
          }
          context.run.logs.push(entry)
          if (context.run.logs.length > 1000) {
            context.run.logs.splice(0, context.run.logs.length - 1000)
          }
          context.run.updatedAt = nowIso()
          await writeRun(context.run)
        } else {
          context.task.notes = context.task.notes
            ? `${context.task.notes}\n${note}`
            : note
          context.task.updatedAt = nowIso()
          await writeTask(context.task)
        }
        return result(type, true, "备注已记录")
      }
      default:
        return result(type, false, `不支持的操作类型：${type || "空"}`)
    }
  } catch (error) {
    return result(type, false, errorText(error))
  }
}

/**
 * 与任务总控对话：注入任务/运行/约束/历史，解析 LLM 返回的动作并顺序执行。
 * 单个动作失败不会影响其他动作。
 */
export async function chatWithOrchestrator(
  taskId: string,
  message: string
): Promise<OrchestratorReply> {
  const trimmed = typeof message === "string" ? message.trim() : ""
  if (!trimmed) {
    throw new Error("消息不能为空")
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`消息过长（上限 ${MAX_MESSAGE_LENGTH} 字符）`)
  }

  const task = await readTask(taskId)
  if (!task) {
    throw new Error(`任务不存在：${taskId}`)
  }

  const [settings, run, history] = await Promise.all([
    readSettings(),
    latestRunOf(task),
    readOrchestratorMessages(taskId, HISTORY_LIMIT),
  ])

  const userMessage: OrchestratorMessage = {
    id: randomUUID(),
    role: "user",
    content: trimmed,
    at: nowIso(),
  }
  await appendOrchestratorMessage(taskId, userMessage)

  const variables: Record<string, string> = {
    task: formatTask(task),
    run: formatRun(run),
    constraints: describeConstraints(settings.constraints),
    history: formatHistory(history),
    message: trimmed,
  }

  let payload: OrchestratorPayload
  try {
    const response = await runAgentJson<OrchestratorPayload>(
      "orchestrator",
      variables,
      { taskId, runId: run?.id }
    )
    payload = isRecord(response.data) ? response.data : {}
  } catch (error) {
    await appendOrchestratorMessage(taskId, {
      id: randomUUID(),
      role: "assistant",
      content: `总控调用失败：${errorText(error)}`,
      at: nowIso(),
    }).catch(() => undefined)
    throw error
  }

  const requested = Array.isArray(payload.actions)
    ? payload.actions.filter(isRecord).slice(0, MAX_ACTIONS)
    : []

  const context: ActionContext = { task, run }
  const actions: OrchestratorActionResult[] = []
  for (const raw of requested) {
    const action = raw as unknown as OrchestratorAction
    actions.push(await executeTaskAction(taskId, action, context))

    // 每个动作后刷新上下文，保证后续动作基于最新状态执行。
    const freshTask = await readTask(taskId).catch(() => null)
    if (freshTask) context.task = freshTask
    const freshRun = await getRunStatus(taskId).catch(() => null)
    if (freshRun) context.run = freshRun
  }

  const reply =
    typeof payload.reply === "string" && payload.reply.trim()
      ? payload.reply.trim()
      : actions.length > 0
        ? "已按你的要求执行操作。"
        : "我已收到你的消息。"

  const assistantMessage: OrchestratorMessage = {
    id: randomUUID(),
    role: "assistant",
    content: reply,
    at: nowIso(),
  }
  if (actions.length > 0) {
    assistantMessage.actions = actions
  }
  await appendOrchestratorMessage(taskId, assistantMessage)

  const finalRun = await getRunStatus(taskId).catch(() => null)
  return { reply, actions, run: finalRun ?? context.run }
}
