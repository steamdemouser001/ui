import { listAnalysisReports } from "@/lib/gepa/analysis-store"
import { errorMessage, fail, ok } from "@/lib/gepa/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = Number(url.searchParams.get("limit"))
  const limit = Number.isFinite(parsed) ? Math.trunc(parsed) : 30
  try {
    const reports = await listAnalysisReports(limit)
    return ok({ reports })
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}
