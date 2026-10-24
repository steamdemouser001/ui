import { readSessionTranscript } from "@/lib/gepa/claude-inspect"
import { errorMessage, fail, ok } from "@/lib/gepa/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseMax(value: string | null): number {
  if (value === null || value.trim() === "") return 400
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 400
  return Math.max(50, Math.min(2_000, Math.trunc(parsed)))
}

/** 返回会话的对话转录，供前端按 Claude Code 终端风格回放。 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const project = url.searchParams.get("project")
  const sessionId = url.searchParams.get("sessionId")
  if (!project || !sessionId) {
    return fail("project 与 sessionId 不能为空")
  }
  try {
    const transcript = await readSessionTranscript(
      project,
      sessionId,
      parseMax(url.searchParams.get("max"))
    )
    return ok(transcript)
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}
