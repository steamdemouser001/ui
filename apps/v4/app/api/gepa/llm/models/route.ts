import { errorMessage, fail, ok } from "@/lib/gepa/http"
import { listProviderModels, parseProviderKind } from "@/lib/gepa/providers"
import { getProvider } from "@/lib/gepa/storage"
import type { LlmProvider } from "@/lib/gepa/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    let provider: Pick<LlmProvider, "kind" | "baseUrl" | "apiKey">

    if (typeof body.providerId === "string" && body.providerId) {
      const stored = await getProvider(body.providerId)
      if (!stored) return fail("供应商不存在", 404)
      provider = stored
      if (typeof body.kind === "string") {
        provider = { ...provider, kind: parseProviderKind(body.kind) }
      }
      if (typeof body.baseUrl === "string" && body.baseUrl.trim()) {
        provider = { ...provider, baseUrl: body.baseUrl.trim() }
      }
      if (typeof body.apiKey === "string" && body.apiKey.trim()) {
        provider = { ...provider, apiKey: body.apiKey.trim() }
      }
    } else {
      const baseUrl =
        typeof body.baseUrl === "string" ? body.baseUrl.trim() : ""
      const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : ""
      if (!baseUrl) return fail("请填写 Base URL")
      if (!apiKey) return fail("请填写 API Key")
      provider = {
        kind: parseProviderKind(body.kind),
        baseUrl,
        apiKey,
      }
    }

    try {
      const models = await listProviderModels(provider)
      return ok({ models })
    } catch (error) {
      return fail(errorMessage(error), 502)
    }
  } catch (error) {
    return fail(errorMessage(error), 400)
  }
}
