import { errorMessage, fail, ok } from "@/lib/gepa/http"
import {
  maskProvider,
  parseModelsInput,
  parseProviderKind,
} from "@/lib/gepa/providers"
import {
  readProviders,
  readSettings,
  writeProviders,
  writeSettings,
} from "@/lib/gepa/storage"
import type { LlmProvider } from "@/lib/gepa/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const body = (await request.json()) as Record<string, unknown>
    const providers = await readProviders()
    const index = providers.findIndex((provider) => provider.id === id)
    if (index === -1) return fail("供应商不存在", 404)

    const next: LlmProvider = { ...providers[index] }
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : ""
      if (!name) return fail("供应商名称不能为空")
      next.name = name
    }
    if (body.kind !== undefined) {
      next.kind = parseProviderKind(body.kind)
    }
    if (body.baseUrl !== undefined) {
      const baseUrl =
        typeof body.baseUrl === "string" ? body.baseUrl.trim() : ""
      if (!baseUrl) return fail("Base URL 不能为空")
      next.baseUrl = baseUrl
    }
    if (body.models !== undefined) {
      const models = parseModelsInput(body.models)
      if (models.length === 0) return fail("请至少填写一个模型")
      next.models = models
      if (!models.includes(next.defaultModel)) {
        next.defaultModel = models[0]
      }
    }
    if (body.defaultModel !== undefined) {
      const defaultModel =
        typeof body.defaultModel === "string" ? body.defaultModel.trim() : ""
      if (!defaultModel) return fail("默认模型不能为空")
      if (!next.models.includes(defaultModel)) {
        return fail("默认模型必须包含在模型列表中")
      }
      next.defaultModel = defaultModel
    }
    if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      next.apiKey = body.apiKey.trim()
    }
    if (body.clearApiKey === true) {
      next.apiKey = ""
    }
    if (typeof body.enabled === "boolean") {
      next.enabled = body.enabled
    }
    next.updatedAt = new Date().toISOString()

    providers[index] = next
    await writeProviders(providers)

    if (body.isDefault === true) {
      await writeSettings({ defaultProviderId: next.id })
    } else if (body.isDefault === false) {
      const settings = await readSettings()
      if (settings.defaultProviderId === next.id) {
        await writeSettings({ defaultProviderId: null })
      }
    }

    return ok(maskProvider(next))
  } catch (error) {
    return fail(errorMessage(error), 400)
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const providers = await readProviders()
    if (!providers.some((provider) => provider.id === id)) {
      return fail("供应商不存在", 404)
    }
    await writeProviders(providers.filter((provider) => provider.id !== id))
    const settings = await readSettings()
    if (settings.defaultProviderId === id) {
      await writeSettings({ defaultProviderId: null })
    }
    return ok({ id })
  } catch (error) {
    return fail(errorMessage(error), 400)
  }
}
