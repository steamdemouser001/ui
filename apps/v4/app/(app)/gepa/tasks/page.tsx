import { TaskList } from "@/components/gepa/tasks/task-list"

export default function TasksPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">任务</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          每个任务拥有独立的技能模块、数据集、运行记录与工作空间。创建任务后，可编辑技能提示词与数据集，
          启动 GEPA 迭代，并通过总控助手用自然语言控制运行。
        </p>
      </header>
      <TaskList />
    </div>
  )
}
