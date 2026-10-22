import { errorMessage, fail, ok, readJsonBody } from "@/lib/gepa/http"
import { readSettings, writeSettings } from "@/lib/gepa/storage"
import type { GlobalSettings } from "@/lib/gepa/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    return ok(await readSettings())
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await readJsonBody(request)) as Partial<GlobalSettings>
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return fail("请求体必须是 JSON 对象")
    }
    return ok(await writeSettings(body))
  } catch (error) {
    return fail(errorMessage(error), 400)
  }
}
