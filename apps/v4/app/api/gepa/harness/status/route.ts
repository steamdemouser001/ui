import { checkClaudeCode } from "@/lib/gepa/harness"
import { errorMessage, fail, ok } from "@/lib/gepa/http"
import { readSettings } from "@/lib/gepa/storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const settings = await readSettings()
    const status = await checkClaudeCode(settings.harness)
    return ok({
      config: {
        kind: settings.harness.kind,
        claudePath: settings.harness.claudePath,
        model: settings.harness.model,
        allowedTools: settings.harness.allowedTools,
        maxUsdPerRollout: settings.harness.maxUsdPerRollout,
        maxUsdPerRun: settings.harness.maxUsdPerRun,
        timeoutMs: settings.harness.timeoutMs,
        maxConcurrent: settings.harness.maxConcurrent,
      },
      status,
    })
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}
