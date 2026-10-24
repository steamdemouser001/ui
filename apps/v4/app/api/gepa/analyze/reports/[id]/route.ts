import {
  deleteAnalysisReport,
  readAnalysisReport,
} from "@/lib/gepa/analysis-store"
import { errorMessage, fail, ok } from "@/lib/gepa/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

function isReportId(value: string): boolean {
  return UUID_PATTERN.test(value)
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  if (!isReportId(id)) return fail("报告 ID 不合法", 400)
  try {
    const report = await readAnalysisReport(id)
    if (!report) return fail("报告不存在", 404)
    return ok({ report })
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  if (!isReportId(id)) return fail("报告 ID 不合法", 400)
  try {
    await deleteAnalysisReport(id)
    return ok({ deleted: true })
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}
