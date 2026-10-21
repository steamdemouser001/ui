import { randomUUID } from "node:crypto"

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

export async function GET() {
  try {
    const [providers, settings] = await Promise.all([
      readProviders(),
      readSettings(),
    ])
    return ok({
      providers: providers.map(maskProvider),
      defaultProviderId: settings.defaultProviderId,
    })
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    const name = typeof body.name === "string" ? body.name.trim() : ""
    const baseUrl =
      typeof body.baseUrl === "string" ? body.baseUrl.trim() : ""
    const models = parseModelsInput(body.models)
    if (!name) return fail("请填写供应商名称")
    if (!baseUrl) return fail("请填写 Base URL")
    if (models.length === 0) return fail("请至少填写一个模型")

    const now = new Date().toISOString()
    const requestedDefault =
      typeof body.defaultModel === "string" ? body.defaultModel.trim() : ""
    const provider: LlmProvider = {
      id: `provider-${randomUUID().slice(0, 8)}`,
      name,
      kind: parseProviderKind(body.kind),
      baseUrl,
      apiKey: typeof body.apiKey === "string" ? body.apiKey.trim() : "",
      models,
      defaultModel: models.includes(requestedDefault)
        ? requestedDefault
        : models[0],
      enabled: body.enabled !== false,
      createdAt: now,
      updatedAt: now,
    }

    const providers = await readProviders()
    providers.push(provider)
    await writeProviders(providers)
    if (body.isDefault === true) {
      await writeSettings({ defaultProviderId: provider.id })
    }
    return ok(maskProvider(provider), { status: 201 })
  } catch (error) {
    return fail(errorMessage(error), 400)
  }
}
