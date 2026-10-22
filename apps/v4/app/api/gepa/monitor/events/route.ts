import { getMonitorSnapshot } from "@/lib/gepa/monitor"
import { delay, sseResponse } from "@/lib/gepa/sse"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ACTIVE_INTERVAL_MS = 2000
const IDLE_INTERVAL_MS = 5000

export async function GET(request: Request) {
  return sseResponse(async (emit, signal) => {
    let lastSerialized = ""
    while (!signal.aborted) {
      const snapshot = await getMonitorSnapshot()
      const serialized = JSON.stringify(snapshot)
      if (serialized !== lastSerialized) {
        lastSerialized = serialized
        emit("snapshot", snapshot)
      }
      const active = snapshot.totals.running > 0
      await delay(active ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS, signal)
    }
  }, request.signal)
}
