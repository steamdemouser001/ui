import { errorMessage, fail, ok } from "@/lib/gepa/http"
import { maskProvider } from "@/lib/gepa/providers"
import { readAgents, readProviders, readSettings } from "@/lib/gepa/storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const [agents, providers, settings] = await Promise.all([
      readAgents(),
      readProviders(),
      readSettings(),
    ])
    return ok({
      agents,
      providers: providers.map(maskProvider),
      defaultProviderId: settings.defaultProviderId,
    })
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}
