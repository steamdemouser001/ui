import { errorMessage, fail, ok, readJsonBody } from "@/lib/gepa/http"
import { logLlmCall } from "@/lib/gepa/metrics"
import {
  callProvider,
  parseModelsInput,
  parseProviderGeneration,
  parseProviderKind,
} from "@/lib/gepa/providers"
import { getProvider } from "@/lib/gepa/storage"
import type { LlmProvider } from "@/lib/gepa/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const TEST_MESSAGES = [{ role: "user" as const, content: "请只回复：OK" }]

export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as Record<string, unknown>
    let provider: LlmProvider

    if (typeof body.providerId === "string" && body.providerId) {
      const stored = await getProvider(body.providerId)
      if (!stored) return fail("供应商不存在", 404)
      provider = stored
      if (typeof body.apiKey === "string" && body.apiKey.trim()) {
        provider = { ...provider, apiKey: body.apiKey.trim() }
      }
    } else {
      const baseUrl =
        typeof body.baseUrl === "string" ? body.baseUrl.trim() : ""
      const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : ""
      if (!baseUrl) return fail("请填写 Base URL")
      if (!apiKey) return fail("请填写 API Key")
      const now = new Date().toISOString()
      provider = {
        id: "connection-test",
        name:
          typeof body.name === "string" && body.name.trim()
            ? body.name.trim()
            : "连接测试",
        kind: parseProviderKind(body.kind),
        baseUrl,
        apiKey,
        models: parseModelsInput(body.models),
        defaultModel: "",
        generation: parseProviderGeneration(body.generation),
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }
    }

    const requestedModel =
      typeof body.model === "string" ? body.model.trim() : ""
    const model =
      requestedModel || provider.defaultModel || provider.models[0] || ""
    if (!model) return fail("请选择或填写要测试的模型")

    const startedAt = Date.now()
    try {
      const result = await callProvider(provider, {
        model,
        messages: TEST_MESSAGES,
      })
      await logLlmCall({
        providerId: provider.id,
        providerName: provider.name,
        model,
        agentId: "llm-test",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cacheTokens: result.cacheTokens,
        durationMs: result.durationMs,
        success: true,
      }).catch(() => undefined)
      return ok({
        providerId: provider.id,
        providerName: provider.name,
        model,
        text: result.text,
        durationMs: result.durationMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      })
    } catch (error) {
      const message = errorMessage(error)
      await logLlmCall({
        providerId: provider.id,
        providerName: provider.name,
        model,
        agentId: "llm-test",
        inputTokens: Math.ceil(
          TEST_MESSAGES.map((item) => item.content).join("\n").length / 4
        ),
        outputTokens: 0,
        cacheTokens: 0,
        durationMs: Date.now() - startedAt,
        success: false,
        error: message,
      }).catch(() => undefined)
      return fail(message, 502)
    }
  } catch (error) {
    return fail(errorMessage(error), 400)
  }
}
