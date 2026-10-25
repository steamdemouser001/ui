import type { RunEvent } from "./types"

type Listener = (event: RunEvent) => void

/**
 * 进程内运行事件总线：引擎在迭代内广播实时进度（rollout 开始、
 * Claude Code 工具调用、审批请求等），SSE 路由订阅后立即转发给前端，
 * 使长迭代不再对用户黑盒。
 */
const listeners = new Set<Listener>()

export function subscribeRunEvents(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitRunEvent(event: RunEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch {
      // 单个监听器异常不影响其他订阅者
    }
  }
}
