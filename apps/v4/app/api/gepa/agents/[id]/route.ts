import { AGENT_ORDER } from "@/lib/gepa/defaults"
import { errorMessage, fail, ok } from "@/lib/gepa/http"
import { readProviders, updateAgent } from "@/lib/gepa/storage"
import type { AgentConfig, AgentId } from "@/lib/gepa/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isAgentId(value: string): value is AgentId {
  return (AGENT_ORDER as string[]).includes(value)
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    if (!isAgentId(id)) return fail(`未知 Agent：${id}`, 404)

    const body = (await request.json()) as Record<string, unknown>
    const patch: Partial<AgentConfig> = {}

    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : ""
      if (!name) return fail("Agent 名称不能为空")
      patch.name = name
    }
    if (body.description !== undefined) {
      patch.description =
        typeof body.description === "string" ? body.description.trim() : ""
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        return fail("enabled 必须是布尔值")
      }
      patch.enabled = body.enabled
    }
    if (body.providerId !== undefined) {
      if (body.providerId === null || body.providerId === "") {
        patch.providerId = null
      } else if (typeof body.providerId === "string") {
        const providers = await readProviders()
        if (!providers.some((provider) => provider.id === body.providerId)) {
          return fail(`供应商不存在：${body.providerId}`)
        }
        patch.providerId = body.providerId
      } else {
        return fail("providerId 必须是字符串或 null")
      }
    }
    if (body.model !== undefined) {
      if (typeof body.model !== "string") {
        return fail("model 必须是字符串")
      }
      patch.model = body.model.trim()
    }
    if (body.temperature !== undefined) {
      const temperature = Number(body.temperature)
      if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
        return fail("temperature 必须在 0 到 2 之间")
      }
      patch.temperature = temperature
    }
    if (body.maxTokens !== undefined) {
      const maxTokens = Number(body.maxTokens)
      if (
        !Number.isInteger(maxTokens) ||
        maxTokens < 256 ||
        maxTokens > 32768
      ) {
        return fail("maxTokens 必须是 256 到 32768 之间的整数")
      }
      patch.maxTokens = maxTokens
    }
    if (body.prompt !== undefined) {
      if (typeof body.prompt !== "string" || !body.prompt.trim()) {
        return fail("提示词不能为空")
      }
      patch.prompt = body.prompt
    }

    if (Object.keys(patch).length === 0) {
      return fail("没有需要更新的字段")
    }

    const agent = await updateAgent(id, patch)
    return ok(agent)
  } catch (error) {
    return fail(errorMessage(error), 400)
  }
}
