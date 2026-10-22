import { errorMessage, fail, ok, readJsonBody } from "@/lib/gepa/http"
import { createTask, listTaskSummaries } from "@/lib/gepa/task-service"
import type { IterationDefaults } from "@/lib/gepa/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function GET() {
  try {
    return ok({ tasks: await listTaskSummaries() })
  } catch (error) {
    return fail(errorMessage(error), 500)
  }
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await readJsonBody(request)
  } catch (error) {
    return fail(errorMessage(error))
  }
  if (!isRecord(body)) {
    return fail("请求体必须是 JSON 对象")
  }
  if (typeof body.name !== "string") {
    return fail("name 必须是字符串")
  }
  if (body.description !== undefined && typeof body.description !== "string") {
    return fail("description 必须是字符串")
  }
  if (body.prompt !== undefined && typeof body.prompt !== "string") {
    return fail("prompt 必须是字符串")
  }
  if (body.datasetText !== undefined && typeof body.datasetText !== "string") {
    return fail("datasetText 必须是字符串")
  }
  if (body.iteration !== undefined && !isRecord(body.iteration)) {
    return fail("iteration 必须是 JSON 对象")
  }
  if (body.testCommand !== undefined && typeof body.testCommand !== "string") {
    return fail("testCommand 必须是字符串")
  }

  try {
    const task = await createTask({
      name: body.name,
      description:
        typeof body.description === "string" ? body.description : undefined,
      prompt: typeof body.prompt === "string" ? body.prompt : undefined,
      datasetText:
        typeof body.datasetText === "string" ? body.datasetText : undefined,
      iteration: isRecord(body.iteration)
        ? (body.iteration as unknown as Partial<IterationDefaults>)
        : undefined,
      testCommand:
        typeof body.testCommand === "string" ? body.testCommand : undefined,
    })
    return ok({ task }, { status: 201 })
  } catch (error) {
    return fail(errorMessage(error), 400)
  }
}
