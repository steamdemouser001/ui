import { GlobalChat } from "@/components/gepa/chat/global-chat"

export default function ChatPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">全局对话</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          与拥有全局控制权限的调度器交流，创建、启动、暂停或管理任意 GEPA 任务。
        </p>
      </header>
      <GlobalChat />
    </div>
  )
}
