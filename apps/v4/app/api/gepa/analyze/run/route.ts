import { runAnalysis } from "@/lib/gepa/analyze-service"
import { normalizeIncludeOptions } from "@/lib/gepa/claude-inspect"
import { errorMessage, fail, ok, readJsonBody } from "@/lib/gepa/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

/** 运行会话分析师 Agent，生成并保存一份分析报告。 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await readJsonBody(request)
  } catch (error) {
    return fail(errorMessage(error))
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("请求体必须是 JSON 对象")
  }
  const record = body as Record<string, unknown>
  const project = typeof record.project === "string" ? record.project : ""
  const sessionId = typeof record.sessionId === "string" ? record.sessionId : ""
  if (!project || !sessionId) {
    return fail("project 与 sessionId 不能为空")
  }

  try {
    const report = await runAnalysis(
      project,
      sessionId,
      normalizeIncludeOptions(record.include)
    )
    return ok({ report })
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}
