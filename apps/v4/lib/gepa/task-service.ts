import { randomUUID } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"

import { isRunActive } from "./run-manager"
import {
  ensureDir,
  listRuns,
  listTasks,
  readOrchestratorMessages,
  readSettings,
  readTask,
  deleteTask as removeTask,
  workspacePath,
  writeTask,
} from "./storage"
import type {
  DatasetExample,
  IterationDefaults,
  OrchestratorMessage,
  RunState,
  RunStatus,
  SkillModule,
  TaskRecord,
  TaskStatus,
} from "./types"
import { workspaceSummary, type WorkspaceSummary } from "./workspace"

export const MAX_DATASET_EXAMPLES = 500
export const MAX_SKILL_MODULES = 20

export const ITERATION_LIMITS = {
  budget: { min: 1, max: 10000 },
  minibatchSize: { min: 1, max: 50 },
  paretoSize: { min: 0, max: 500 },
  maxIterations: { min: 1, max: 200 },
} as const

const DEFAULT_MODULE_PROMPT =
  "你是一个专业的任务助手。请仔细阅读任务输入，给出准确、完整、可直接使用的回答。"

const MODULE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const EXAMPLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export interface CreateTaskInput {
  name: string
  description?: string
  prompt?: string
  datasetText?: string
  iteration?: Partial<IterationDefaults>
}

export interface UpdateTaskInput {
  name?: string
  description?: string
  modules?: SkillModule[]
  dataset?: DatasetExample[]
  iteration?: Partial<IterationDefaults>
  notes?: string
}

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

export interface TaskDetail {
  task: TaskRecord
  run: RunState | null
  runs: RunSummary[]
  messages: OrchestratorMessage[]
  workspace: WorkspaceSummary
}

const EMPTY_WORKSPACE: WorkspaceSummary = {
  files: 0,
  directories: 0,
  totalBytes: 0,
  updatedAt: null,
}

/** 任务名称转 slug：小写、非字母数字转连字符、截断 40、空则 task。 */
export function slugifyTaskName(name: string): string {
  const slug = (typeof name === "string" ? name : "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "")
  return slug || "task"
}

function nowIso(): string {
  return new Date().toISOString()
}

function assertInt(
  value: unknown,
  range: { min: number; max: number },
  label: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < range.min ||
    value > range.max
  ) {
    throw new Error(`${label}必须是 ${range.min} 到 ${range.max} 之间的整数`)
  }
  return value
}

/** 校验并合并迭代参数，未提供的字段保留原值。 */
export function sanitizeIteration(
  base: IterationDefaults,
  patch?: Partial<IterationDefaults> | null
): IterationDefaults {
  const next: IterationDefaults = { ...base }
  if (!patch) return next

  if (patch.budget !== undefined) {
    next.budget = assertInt(patch.budget, ITERATION_LIMITS.budget, "预算")
  }
  if (patch.minibatchSize !== undefined) {
    next.minibatchSize = assertInt(
      patch.minibatchSize,
      ITERATION_LIMITS.minibatchSize,
      "minibatch 大小"
    )
  }
  if (patch.paretoSize !== undefined) {
    next.paretoSize = assertInt(
      patch.paretoSize,
      ITERATION_LIMITS.paretoSize,
      "帕累托样本数"
    )
  }
  if (patch.maxIterations !== undefined) {
    next.maxIterations = assertInt(
      patch.maxIterations,
      ITERATION_LIMITS.maxIterations,
      "最大迭代轮数"
    )
  }
  if (patch.moduleSelection !== undefined) {
    if (
      patch.moduleSelection !== "round-robin" &&
      patch.moduleSelection !== "random"
    ) {
      throw new Error("模块选择策略必须是 round-robin 或 random")
    }
    next.moduleSelection = patch.moduleSelection
  }
  if (patch.mergeEnabled !== undefined) {
    if (typeof patch.mergeEnabled !== "boolean") {
      throw new Error("mergeEnabled 必须是布尔值")
    }
    next.mergeEnabled = patch.mergeEnabled
  }
  return next
}

interface ParsedExample {
  input: string
  expected?: string
  metadata?: Record<string, unknown>
}

function parseExampleValue(value: unknown, index: number): ParsedExample {
  if (typeof value === "string") {
    const input = value.trim()
    if (!input) {
      throw new Error(`第 ${index + 1} 条示例的输入不能为空`)
    }
    return { input }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `第 ${index + 1} 条示例格式不正确：应为文本或包含 input 字段的对象`
    )
  }
  const record = value as Record<string, unknown>
  const input = typeof record.input === "string" ? record.input.trim() : ""
  if (!input) {
    throw new Error(`第 ${index + 1} 条示例缺少 input 字段或内容为空`)
  }
  const example: ParsedExample = { input }
  if (typeof record.expected === "string" && record.expected.trim()) {
    example.expected = record.expected.trim()
  }
  if (
    record.metadata &&
    typeof record.metadata === "object" &&
    !Array.isArray(record.metadata)
  ) {
    example.metadata = record.metadata as Record<string, unknown>
  }
  return example
}

/**
 * 解析数据集文本，支持：
 * - JSON 数组：`[{"input":"..."}]` 或 `["文本", ...]`
 * - JSONL：每行一个 JSON 对象
 * - 纯文本：每行一条示例
 * 生成的示例 id 为 `example-1...`，最多 500 条。
 */
export function parseDatasetText(text: string): DatasetExample[] {
  const raw = typeof text === "string" ? text.trim() : ""
  if (!raw) return []

  let values: unknown[]
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) {
        throw new Error("not an array")
      }
      values = parsed
    } catch {
      throw new Error("数据集不是合法的 JSON 数组，请检查括号与引号")
    }
  } else {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (lines.length === 0) return []

    if (lines[0].startsWith("{")) {
      values = lines.map((line, index) => {
        try {
          const parsed = JSON.parse(line) as unknown
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
          ) {
            throw new Error("not an object")
          }
          return parsed
        } catch {
          throw new Error(`第 ${index + 1} 行不是合法的 JSON 对象`)
        }
      })
    } else {
      values = lines
    }
  }

  if (values.length > MAX_DATASET_EXAMPLES) {
    throw new Error(
      `数据集最多支持 ${MAX_DATASET_EXAMPLES} 条示例（当前 ${values.length} 条）`
    )
  }

  return values.map((value, index) => {
    const parsed = parseExampleValue(value, index)
    const example: DatasetExample = {
      id: `example-${index + 1}`,
      input: parsed.input,
    }
    if (parsed.expected !== undefined) example.expected = parsed.expected
    if (parsed.metadata !== undefined) example.metadata = parsed.metadata
    return example
  })
}

function normalizeModules(input: unknown): SkillModule[] {
  if (!Array.isArray(input)) {
    throw new Error("modules 必须是数组")
  }
  if (input.length === 0) {
    throw new Error("任务至少需要 1 个技能模块")
  }
  if (input.length > MAX_SKILL_MODULES) {
    throw new Error(`技能模块最多 ${MAX_SKILL_MODULES} 个`)
  }

  const seen = new Set<string>()
  return input.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`第 ${index + 1} 个模块格式不正确`)
    }
    const record = item as Record<string, unknown>
    const id = typeof record.id === "string" ? record.id.trim() : ""
    if (!id) {
      throw new Error(`第 ${index + 1} 个模块缺少 id`)
    }
    if (!MODULE_ID_PATTERN.test(id)) {
      throw new Error(
        `模块 id 不合法：${id}（只允许字母、数字、下划线和连字符）`
      )
    }
    if (seen.has(id)) {
      throw new Error(`模块 id 重复：${id}`)
    }
    seen.add(id)

    const prompt = typeof record.prompt === "string" ? record.prompt.trim() : ""
    if (!prompt) {
      throw new Error(`模块「${id}」的提示词不能为空`)
    }
    return {
      id,
      name:
        typeof record.name === "string" && record.name.trim()
          ? record.name.trim()
          : `模块 ${index + 1}`,
      description:
        typeof record.description === "string" ? record.description.trim() : "",
      prompt,
    }
  })
}

function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
  const fallback = `${base}-${randomUUID().slice(0, 6)}`
  used.add(fallback)
  return fallback
}

function normalizeDataset(input: unknown): DatasetExample[] {
  if (!Array.isArray(input)) {
    throw new Error("dataset 必须是数组")
  }
  if (input.length > MAX_DATASET_EXAMPLES) {
    throw new Error(
      `数据集最多支持 ${MAX_DATASET_EXAMPLES} 条示例（当前 ${input.length} 条）`
    )
  }

  const used = new Set<string>()
  return input.map((item, index) => {
    const parsed = parseExampleValue(item, index)
    const providedId =
      typeof item === "object" &&
      item !== null &&
      !Array.isArray(item) &&
      typeof (item as Record<string, unknown>).id === "string"
        ? ((item as Record<string, unknown>).id as string).trim()
        : ""
    const baseId =
      providedId && EXAMPLE_ID_PATTERN.test(providedId)
        ? providedId
        : `example-${index + 1}`
    const example: DatasetExample = {
      id: uniqueId(baseId, used),
      input: parsed.input,
    }
    if (parsed.expected !== undefined) example.expected = parsed.expected
    if (parsed.metadata !== undefined) example.metadata = parsed.metadata
    return example
  })
}

function isTaskComplete(task: TaskRecord): boolean {
  return (
    task.modules.length > 0 &&
    task.modules.every((module) => module.prompt.trim().length > 0) &&
    task.dataset.length > 0
  )
}

/** 根据内容完整性推导状态；运行中/暂停中的任务保持原状态。 */
function deriveStatus(task: TaskRecord): TaskStatus {
  if (task.status === "running" || task.status === "paused") {
    return task.status
  }
  return isTaskComplete(task) ? "ready" : "draft"
}

function buildReadme(task: TaskRecord): string {
  return [
    `# ${task.name}`,
    "",
    task.description || "（暂无描述）",
    "",
    "## 工作空间结构",
    "",
    "- `task.json`：任务元数据",
    "- `skill.json`：技能模块",
    "- `dataset.jsonl`：数据集（每行一个 JSON 示例）",
    "- `orchestrator.jsonl`：总控对话记录",
    "- `runs/<runId>.json`：运行状态",
    "- `runs/<runId>/iteration-<n>.json`：每轮迭代产物",
    "- `artifacts/`：预留产物目录",
    "",
    "该目录由 GEPA 控制台自动维护，可直接编辑文本文件；写入会经过全局工具约束校验。",
    "",
  ].join("\n")
}

async function writeReadme(task: TaskRecord): Promise<void> {
  const file = path.join(workspacePath(task.id), "README.md")
  await fs.writeFile(file, buildReadme(task), "utf8")
}

async function ensureOrchestratorFile(taskId: string): Promise<void> {
  const file = path.join(workspacePath(taskId), "orchestrator.jsonl")
  await fs.appendFile(file, "", "utf8")
}

/** 创建任务及其独立工作空间。 */
export async function createTask(input: CreateTaskInput): Promise<TaskRecord> {
  const name = typeof input.name === "string" ? input.name.trim() : ""
  if (!name) {
    throw new Error("任务名称不能为空")
  }
  if (name.length > 80) {
    throw new Error("任务名称不能超过 80 个字符")
  }

  const settings = await readSettings()
  const iteration = sanitizeIteration(settings.iteration, input.iteration)
  const dataset = parseDatasetText(input.datasetText ?? "")
  const prompt =
    typeof input.prompt === "string" && input.prompt.trim()
      ? input.prompt.trim()
      : DEFAULT_MODULE_PROMPT

  const slug = slugifyTaskName(name)
  let id = ""
  // 极小概率的 id 碰撞会覆盖已有任务，这里主动避让。
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${slug}-${randomUUID().replace(/-/g, "").slice(0, 6)}`
    if (!(await readTask(candidate))) {
      id = candidate
      break
    }
  }
  if (!id) {
    throw new Error("无法生成唯一任务 id，请稍后重试")
  }
  const now = nowIso()
  const task: TaskRecord = {
    id,
    name,
    description:
      typeof input.description === "string" ? input.description.trim() : "",
    status: dataset.length > 0 ? "ready" : "draft",
    modules: [
      {
        id: "module-1",
        name: "主技能",
        description: "核心技能提示词",
        prompt,
      },
    ],
    dataset,
    iteration,
    createdAt: now,
    updatedAt: now,
    runId: null,
    notes: "",
  }

  const dir = workspacePath(id)
  await ensureDir(dir)
  await ensureDir(path.join(dir, "runs"))
  await ensureDir(path.join(dir, "artifacts"))
  await writeTask(task)
  await writeReadme(task)
  await ensureOrchestratorFile(id)
  return task
}

/** 更新任务；模块至少 1 个、id 唯一、提示词非空；数据集可空。 */
export async function updateTask(
  taskId: string,
  patch: UpdateTaskInput
): Promise<TaskRecord> {
  const task = await readTask(taskId)
  if (!task) {
    throw new Error(`任务不存在：${taskId}`)
  }

  if (patch.name !== undefined) {
    const name = typeof patch.name === "string" ? patch.name.trim() : ""
    if (!name) {
      throw new Error("任务名称不能为空")
    }
    if (name.length > 80) {
      throw new Error("任务名称不能超过 80 个字符")
    }
    task.name = name
  }
  if (patch.description !== undefined) {
    task.description =
      typeof patch.description === "string" ? patch.description.trim() : ""
  }
  if (patch.modules !== undefined) {
    task.modules = normalizeModules(patch.modules)
  }
  if (patch.dataset !== undefined) {
    task.dataset = normalizeDataset(patch.dataset)
  }
  if (patch.iteration !== undefined) {
    task.iteration = sanitizeIteration(task.iteration, patch.iteration)
  }
  if (patch.notes !== undefined) {
    task.notes = typeof patch.notes === "string" ? patch.notes : ""
  }

  task.status = deriveStatus(task)
  task.updatedAt = nowIso()
  await writeTask(task)
  await writeReadme(task)
  return task
}

/** 删除任务工作空间；运行中的任务必须先停止。 */
export async function deleteTask(taskId: string): Promise<void> {
  const task = await readTask(taskId)
  if (!task) {
    throw new Error(`任务不存在：${taskId}`)
  }
  if (isRunActive(taskId)) {
    throw new Error("任务正在运行，请先停止运行再删除")
  }
  await removeTask(taskId)
}

function bestScoreOf(run: RunState | null): number | null {
  if (!run || !run.bestCandidateId || !Array.isArray(run.candidates)) {
    return null
  }
  const best = run.candidates.find(
    (candidate) => candidate.id === run.bestCandidateId
  )
  return typeof best?.averageScore === "number" &&
    Number.isFinite(best.averageScore)
    ? best.averageScore
    : null
}

function summarizeRun(run: RunState | null): RunSummary | null {
  if (!run) return null
  const summary: RunSummary = {
    id: run.id,
    status: run.status,
    iteration: Number.isFinite(run.iteration) ? run.iteration : 0,
    budget: Number.isFinite(run.budget) ? run.budget : 0,
    budgetUsed: Number.isFinite(run.budgetUsed) ? run.budgetUsed : 0,
    bestScore: bestScoreOf(run),
    candidates: Array.isArray(run.candidates) ? run.candidates.length : 0,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
  }
  if (run.finishedAt) summary.finishedAt = run.finishedAt
  if (run.error) summary.error = run.error
  return summary
}

/** 任务最新一次运行（按开始时间倒序），读取失败时视为无运行。 */
export async function latestRunOf(taskId: string): Promise<RunState | null> {
  try {
    const runs = await listRuns(taskId)
    return runs[0] ?? null
  } catch {
    return null
  }
}

function toSummary(task: TaskRecord, run: RunState | null): TaskSummary {
  return {
    id: task.id,
    name: task.name || task.id,
    description: task.description,
    status: task.status,
    modules: task.modules.length,
    dataset: task.dataset.length,
    iteration: task.iteration,
    run: summarizeRun(run),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

/** 任务列表摘要（含最新运行）。 */
export async function listTaskSummaries(): Promise<TaskSummary[]> {
  const tasks = await listTasks()
  const entries = await Promise.all(
    tasks.map(async (task) => {
      const run = await latestRunOf(task.id)
      return toSummary(task, run)
    })
  )
  return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** 任务详情：任务、最新运行、最近 10 次运行、最近 50 条消息与工作空间摘要。 */
export async function getTaskDetail(
  taskId: string
): Promise<TaskDetail | null> {
  const task = await readTask(taskId)
  if (!task) return null

  const [runs, messages, workspace] = await Promise.all([
    listRuns(taskId).catch(() => [] as RunState[]),
    readOrchestratorMessages(taskId, 50).catch(
      () => [] as OrchestratorMessage[]
    ),
    workspaceSummary(taskId).catch(() => EMPTY_WORKSPACE),
  ])

  return {
    task,
    run: runs[0] ?? null,
    runs: runs
      .slice(0, 10)
      .map(summarizeRun)
      .filter((run): run is RunSummary => run !== null),
    messages,
    workspace,
  }
}
