import { TaskDetail } from "@/components/gepa/tasks/task-detail"

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>
}) {
  const { taskId } = await params

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <TaskDetail taskId={taskId} />
    </div>
  )
}
