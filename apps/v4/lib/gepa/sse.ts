const encoder = new TextEncoder()

export type SseEmitter = (event: string, data: unknown) => void

/**
 * 把异步处理器包装成 SSE 响应。处理器通过 emit 推送事件，
 * 客户端断开或请求被取消时 signal 会中止。
 */
export function sseResponse(
  handler: (emit: SseEmitter, signal: AbortSignal) => Promise<void>,
  requestSignal?: AbortSignal
): Response {
  const abort = new AbortController()
  const onAbort = () => abort.abort()

  if (requestSignal?.aborted) {
    abort.abort()
  } else {
    requestSignal?.addEventListener("abort", onAbort, { once: true })
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false

      const emit: SseEmitter = (event, data) => {
        if (closed || abort.signal.aborted) return
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          )
        } catch {
          closed = true
        }
      }

      try {
        controller.enqueue(encoder.encode(": connected\n\n"))
        await handler(emit, abort.signal)
      } catch (error) {
        if (!abort.signal.aborted) {
          emit("error", {
            message: error instanceof Error ? error.message : String(error),
          })
        }
      } finally {
        closed = true
        requestSignal?.removeEventListener("abort", onAbort)
        try {
          controller.close()
        } catch {
          // 流已关闭
        }
      }
    },
    cancel() {
      abort.abort()
      requestSignal?.removeEventListener("abort", onAbort)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}
