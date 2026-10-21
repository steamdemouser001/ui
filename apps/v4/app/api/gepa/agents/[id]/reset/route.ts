import { createDefaultAgents } from "@/lib/gepa/defaults"
import { errorMessage, fail, ok } from "@/lib/gepa/http"
import { readAgents, writeAgents } from "@/lib/gepa/storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const fallback = createDefaultAgents().find((agent) => agent.id === id)
    if (!fallback) return fail(`未知 Agent：${id}`, 404)

    const agents = await readAgents()
    const index = agents.findIndex((agent) => agent.id === id)
    if (index === -1) return fail(`未知 Agent：${id}`, 404)

    // 恢复默认提示词与参数，同时保留原有的更新时间。
    const reset = { ...fallback, updatedAt: agents[index].updatedAt }
    agents[index] = reset
    await writeAgents(agents)
    return ok(reset)
  } catch (error) {
    return fail(errorMessage(error), 400)
  }
}
