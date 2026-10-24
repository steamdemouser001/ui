import { randomUUID } from "node:crypto"
import type { Dirent } from "node:fs"
import { promises as fs } from "node:fs"
import path from "node:path"

import {
  createDefaultAgents,
  createDefaultSettings,
  DEFAULT_ITERATION,
  normalizeHarness,
  normalizeProviderGeneration,
} from "./defaults"
import { assertCleanText } from "./text"
import type {
  AgentConfig,
  AgentId,
  DatasetExample,
  GlobalSettings,
  LlmProvider,
  OrchestratorMessage,
  RunState,
  SkillModule,
  TaskRecord,
} from "./types"

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const ROLLOUT_COPY_SKIP = new Set(["node_modules", ".next", ".turbo"])

export function getDataRoot(): string {
  const configured = process.env.GEPA_DATA_DIR
  return configured
    ? path.resolve(configured)
    : path.join(process.cwd(), ".gepa-data")
}

export function dataPath(...segments: string[]): string {
  const root = getDataRoot()
  const target = path.resolve(root, ...segments)
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`非法的数据路径：${segments.join("/")}`)
  }
  return target
}

export function assertSafeId(value: string, label = "id"): string {
  if (!ID_PATTERN.test(value)) {
    throw new Error(`${label} 不合法：${value}（只允许小写字母、数字和连字符）`)
  }
  return value
}

export function assertSafeRunId(value: string): string {
  if (!RUN_ID_PATTERN.test(value)) {
    throw new Error(`runId 不合法：${value}`)
  }
  return value
}

export function workspacePath(taskId: string): string {
  return dataPath("workspaces", assertSafeId(taskId, "taskId"))
}

/** 用户可见的工作空间文件目录，也是每次 rollout 的基准快照来源。 */
export function filesPath(taskId: string): string {
  return path.join(workspacePath(taskId), "files")
}

function assertSafeSegment(value: string, label: string): string {
  if (!SEGMENT_PATTERN.test(value)) {
    throw new Error(
      `${label} 不合法：${value}（只允许字母、数字、下划线和连字符）`
    )
  }
  return value
}

export function rolloutsPath(taskId: string, runId: string): string {
  return path.join(
    workspacePath(taskId),
    "rollouts",
    assertSafeRunId(runId)
  )
}

export function rolloutPath(
  taskId: string,
  runId: string,
  candidateId: string,
  exampleId: string
): string {
  return path.join(
    rolloutsPath(taskId, runId),
    assertSafeSegment(candidateId, "candidateId"),
    assertSafeSegment(exampleId, "exampleId")
  )
}

/**
 * 为一次 rollout 准备干净目录：把 files/ 的内容复制进去。
 * 父代与子代、不同样本各自独立，避免文件改动互相污染。
 */
export async function prepareRollout(
  taskId: string,
  runId: string,
  candidateId: string,
  exampleId: string
): Promise<string> {
  const target = rolloutPath(taskId, runId, candidateId, exampleId)
  await fs.rm(target, { recursive: true, force: true })
  await ensureDir(target)
  try {
    await fs.cp(filesPath(taskId), target, {
      recursive: true,
      force: true,
      filter: (source) => !ROLLOUT_COPY_SKIP.has(path.basename(source)),
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  return target
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export async function readJson<T>(relative: string, fallback: T): Promise<T> {
  const file = dataPath(relative)
  let raw: string
  try {
    raw = await fs.readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback
    }
    throw error
  }
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`数据文件损坏（JSON 解析失败）：${relative}：${reason}`)
  }
}

export async function writeJson(
  relative: string,
  value: unknown
): Promise<void> {
  const file = dataPath(relative)
  await ensureDir(path.dirname(file))
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8")
    await fs.rename(temp, file)
  } catch (error) {
    await fs.unlink(temp).catch(() => undefined)
    throw error
  }
}

export async function appendJsonl(
  relative: string,
  value: unknown
): Promise<void> {
  const file = dataPath(relative)
  await ensureDir(path.dirname(file))
  await fs.appendFile(file, `${JSON.stringify(value)}\n`, "utf8")
}

export async function readJsonl<T>(
  relative: string,
  limit?: number
): Promise<T[]> {
  const file = dataPath(relative)
  let raw: string
  try {
    raw = await fs.readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }
    throw error
  }
  const items: T[] = []
  const lines = raw.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    try {
      items.push(JSON.parse(line) as T)
    } catch {
      throw new Error(
        `数据文件损坏（第 ${index + 1} 行不是合法 JSON）：${relative}`
      )
    }
  }
  if (limit === undefined) return items
  if (limit <= 0) return []
  return items.slice(-limit)
}

export async function writeJsonl(
  relative: string,
  values: unknown[]
): Promise<void> {
  const file = dataPath(relative)
  await ensureDir(path.dirname(file))
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  const content = values.map((value) => JSON.stringify(value)).join("\n")
  try {
    await fs.writeFile(temp, content ? `${content}\n` : "", "utf8")
    await fs.rename(temp, file)
  } catch (error) {
    await fs.unlink(temp).catch(() => undefined)
    throw error
  }
}

const locks = new Map<string, Promise<void>>()

export async function withLock<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let release: () => void = () => undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => current)
  locks.set(key, tail)
  await previous
  try {
    return await fn()
  } finally {
    release()
    if (locks.get(key) === tail) {
      locks.delete(key)
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function mergeDeep<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : patch) as T
  }
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const current = result[key]
    result[key] =
      isPlainObject(current) && isPlainObject(value)
        ? mergeDeep(current, value)
        : value
  }
  return result as T
}

export async function readSettings(): Promise<GlobalSettings> {
  const stored = await readJson<Partial<GlobalSettings> | null>(
    "config/settings.json",
    null
  )
  const defaults = createDefaultSettings()
  if (!stored) return defaults
  const merged = mergeDeep(defaults, stored)
  return {
    ...merged,
    version: merged.version ?? defaults.version,
    harness: normalizeHarness(merged.harness),
    updatedAt: merged.updatedAt ?? defaults.updatedAt,
  }
}

export async function writeSettings(
  patch: Partial<GlobalSettings>
): Promise<GlobalSettings> {
  return withLock("settings", async () => {
    const current = await readSettings()
    const merged = mergeDeep(current, patch)
    const next: GlobalSettings = {
      ...merged,
      version: current.version,
      harness: normalizeHarness(merged.harness),
      updatedAt: new Date().toISOString(),
    }
    assertCleanText(next, "全局设置")
    await writeJson("config/settings.json", next)
    return next
  })
}

export async function readProviders(): Promise<LlmProvider[]> {
  const stored = await readJson<LlmProvider[]>("config/providers.json", [])
  if (!Array.isArray(stored)) {
    throw new Error("供应商配置损坏：config/providers.json 必须是数组")
  }
  return stored.map((provider) => ({
    ...provider,
    models: Array.isArray(provider.models)
      ? provider.models.filter((model) => typeof model === "string")
      : [],
    apiKey: typeof provider.apiKey === "string" ? provider.apiKey : "",
    generation: normalizeProviderGeneration(provider.generation),
    enabled: provider.enabled !== false,
  }))
}

export async function writeProviders(providers: LlmProvider[]): Promise<void> {
  assertCleanText(providers, "供应商配置")
  await withLock("providers", () =>
    writeJson("config/providers.json", providers)
  )
}

export async function getProvider(id: string): Promise<LlmProvider | null> {
  const providers = await readProviders()
  return providers.find((provider) => provider.id === id) ?? null
}

export async function resolveProvider(
  providerId?: string | null
): Promise<LlmProvider> {
  const [providers, settings] = await Promise.all([
    readProviders(),
    readSettings(),
  ])
  if (providers.length === 0) {
    throw new Error("尚未配置任何 LLM 供应商，请先前往 /gepa/llm 添加供应商")
  }
  if (providerId) {
    const found = providers.find((provider) => provider.id === providerId)
    if (!found) {
      throw new Error(`找不到 LLM 供应商：${providerId}`)
    }
    if (!found.enabled) {
      throw new Error(`LLM 供应商「${found.name}」已停用`)
    }
    return found
  }
  const defaultId = settings.defaultProviderId
  if (defaultId) {
    const found = providers.find((provider) => provider.id === defaultId)
    if (found?.enabled) return found
  }
  const fallback = providers.find((provider) => provider.enabled)
  if (fallback) return fallback
  throw new Error("没有可用的 LLM 供应商，请先在 /gepa/llm 启用或添加供应商")
}

export async function readAgents(): Promise<AgentConfig[]> {
  const stored = await readJson<AgentConfig[]>("config/agents.json", [])
  if (!Array.isArray(stored)) {
    throw new Error("Agent 配置损坏：config/agents.json 必须是数组")
  }
  const byId = new Map(stored.map((agent) => [agent.id, agent]))
  return createDefaultAgents().map((fallback) => {
    const saved = byId.get(fallback.id)
    if (!saved) return fallback
    // 仅合并 Agent 级字段；旧数据中的 temperature/maxTokens 等已废弃字段会被忽略。
    return {
      id: fallback.id,
      name:
        typeof saved.name === "string" && saved.name.trim()
          ? saved.name
          : fallback.name,
      description:
        typeof saved.description === "string"
          ? saved.description
          : fallback.description,
      enabled:
        typeof saved.enabled === "boolean" ? saved.enabled : fallback.enabled,
      providerId:
        typeof saved.providerId === "string" ? saved.providerId : null,
      model: typeof saved.model === "string" ? saved.model : fallback.model,
      prompt:
        typeof saved.prompt === "string" && saved.prompt.trim()
          ? saved.prompt
          : fallback.prompt,
      updatedAt:
        typeof saved.updatedAt === "string"
          ? saved.updatedAt
          : fallback.updatedAt,
    }
  })
}

export async function writeAgents(agents: AgentConfig[]): Promise<void> {
  assertCleanText(agents, "Agent 配置")
  await withLock("agents", () => writeJson("config/agents.json", agents))
}

export async function updateAgent(
  id: AgentId,
  patch: Partial<AgentConfig>
): Promise<AgentConfig> {
  return withLock("agents", async () => {
    const agents = await readAgents()
    const index = agents.findIndex((agent) => agent.id === id)
    if (index === -1) {
      throw new Error(`未知 Agent：${id}`)
    }
    const next: AgentConfig = {
      ...agents[index],
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    }
    agents[index] = next
    await writeJson("config/agents.json", agents)
    return next
  })
}

type TaskMeta = Omit<TaskRecord, "modules" | "dataset"> & {
  modules?: SkillModule[]
  dataset?: DatasetExample[]
}

function taskFile(taskId: string, name: string): string {
  return path.posix.join("workspaces", taskId, name)
}

export async function listTasks(): Promise<TaskRecord[]> {
  const dir = dataPath("workspaces")
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  const tasks = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name))
      .map((entry) => readTask(entry.name).catch(() => null))
  )
  return tasks
    .filter((task): task is TaskRecord => task !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function readTask(id: string): Promise<TaskRecord | null> {
  const taskId = assertSafeId(id, "taskId")
  const meta = await readJson<TaskMeta | null>(
    taskFile(taskId, "task.json"),
    null
  )
  if (!meta) return null
  const modules = await readJson<SkillModule[]>(
    taskFile(taskId, "skill.json"),
    Array.isArray(meta.modules) ? meta.modules : []
  )
  const dataset = await readJsonl<DatasetExample>(
    taskFile(taskId, "dataset.jsonl")
  )
  const createdAt = meta.createdAt ?? new Date(0).toISOString()
  return {
    id: meta.id ?? taskId,
    name: meta.name ?? taskId,
    description: meta.description ?? "",
    status: meta.status ?? "draft",
    modules: Array.isArray(modules) ? modules : [],
    dataset: dataset.length > 0 ? dataset : (meta.dataset ?? []),
    iteration: mergeDeep(DEFAULT_ITERATION, meta.iteration ?? {}),
    createdAt,
    updatedAt: meta.updatedAt ?? createdAt,
    runId: meta.runId ?? null,
    notes: meta.notes ?? "",
    testCommand:
      typeof meta.testCommand === "string" && meta.testCommand.trim()
        ? meta.testCommand.trim()
        : undefined,
  }
}

export async function writeTask(task: TaskRecord): Promise<void> {
  const taskId = assertSafeId(task.id, "taskId")
  assertCleanText(task, `任务「${taskId}」`)
  await withLock(`task:${taskId}`, async () => {
    const { modules, dataset, ...meta } = task
    await ensureDir(path.join(workspacePath(taskId), "runs"))
    await writeJson(taskFile(taskId, "task.json"), meta)
    await writeJson(taskFile(taskId, "skill.json"), modules)
    await writeJsonl(taskFile(taskId, "dataset.jsonl"), dataset)
  })
}

export async function deleteTask(id: string): Promise<void> {
  const taskId = assertSafeId(id, "taskId")
  await withLock(`task:${taskId}`, () =>
    fs.rm(workspacePath(taskId), { recursive: true, force: true })
  )
}

export async function readRun(
  taskId: string,
  runId: string
): Promise<RunState | null> {
  const safeTaskId = assertSafeId(taskId, "taskId")
  const safeRunId = assertSafeRunId(runId)
  return readJson<RunState | null>(
    path.posix.join("workspaces", safeTaskId, "runs", `${safeRunId}.json`),
    null
  )
}

export async function writeRun(run: RunState): Promise<void> {
  const taskId = assertSafeId(run.taskId, "taskId")
  const runId = assertSafeRunId(run.id)
  await withLock(`run:${taskId}:${runId}`, () =>
    writeJson(
      path.posix.join("workspaces", taskId, "runs", `${runId}.json`),
      run
    )
  )
}

export async function listRuns(taskId: string): Promise<RunState[]> {
  const safeTaskId = assertSafeId(taskId, "taskId")
  const dir = dataPath("workspaces", safeTaskId, "runs")
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  const runs = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) =>
        readRun(safeTaskId, entry.name.slice(0, -".json".length)).catch(
          () => null
        )
      )
  )
  return runs
    .filter((run): run is RunState => run !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export async function writeRunArtifact(
  taskId: string,
  runId: string,
  iteration: number,
  value: unknown
): Promise<void> {
  const safeTaskId = assertSafeId(taskId, "taskId")
  const safeRunId = assertSafeRunId(runId)
  const index = Number.isFinite(iteration)
    ? Math.max(0, Math.trunc(iteration))
    : 0
  const relative = path.posix.join(
    "workspaces",
    safeTaskId,
    "runs",
    safeRunId,
    `iteration-${index}.json`
  )
  await withLock(`artifact:${safeTaskId}:${safeRunId}:${index}`, () =>
    writeJson(relative, value)
  )
}

export async function appendOrchestratorMessage(
  taskId: string,
  message: OrchestratorMessage
): Promise<void> {
  const safeTaskId = assertSafeId(taskId, "taskId")
  await withLock(`orchestrator:${safeTaskId}`, () =>
    appendJsonl(taskFile(safeTaskId, "orchestrator.jsonl"), message)
  )
}

export async function readOrchestratorMessages(
  taskId: string,
  limit?: number
): Promise<OrchestratorMessage[]> {
  const safeTaskId = assertSafeId(taskId, "taskId")
  return readJsonl<OrchestratorMessage>(
    taskFile(safeTaskId, "orchestrator.jsonl"),
    limit
  )
}

const GLOBAL_CHAT_FILE = "config/chat.jsonl"

export async function appendGlobalMessage(
  message: OrchestratorMessage
): Promise<void> {
  await withLock("global-chat", () => appendJsonl(GLOBAL_CHAT_FILE, message))
}

export async function readGlobalMessages(
  limit?: number
): Promise<OrchestratorMessage[]> {
  return readJsonl<OrchestratorMessage>(GLOBAL_CHAT_FILE, limit)
}

export async function clearGlobalMessages(): Promise<void> {
  await withLock("global-chat", async () => {
    const file = dataPath(GLOBAL_CHAT_FILE)
    await ensureDir(path.dirname(file))
    await fs.writeFile(file, "", "utf8")
  })
}
