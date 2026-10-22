import { GlobalChat } from "@/components/gepa/chat/global-chat"

export default function ChatPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header className="shrink-0 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">全局对话</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          与拥有全局控制权限的调度器交流。支持历史会话、多标签并行对话，回复流式输出并实时显示。
        </p>
      </header>
      <GlobalChat />
    </div>
  )
}
