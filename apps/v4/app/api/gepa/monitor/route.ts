import { errorMessage, fail, ok } from "@/lib/gepa/http"
import { getMonitorSnapshot } from "@/lib/gepa/monitor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    return ok(await getMonitorSnapshot())
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}
