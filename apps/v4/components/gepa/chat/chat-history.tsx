"use client"

import * as React from "react"
import { cn } from "cn"
import {
  AlertCircleIcon,
  EraserIcon,
  HistoryIcon,
  Loader2Icon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"

import type { ChatSessionMeta } from "@/lib/gepa/types"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/registry/new-york-v4/ui/alert-dialog"
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/registry/new-york-v4/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/registry/new-york-v4/ui/dropdown-menu"
import { Input } from "@/registry/new-york-v4/ui/input"
import { Label } from "@/registry/new-york-v4/ui/label"
import { ScrollArea } from "@/registry/new-york-v4/ui/scroll-area"
import { Skeleton } from "@/registry/new-york-v4/ui/skeleton"

function relativeTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

interface ChatHistoryProps {
  sessions: ChatSessionMeta[]
  activeId: string | null
  openIds: string[]
  loading: boolean
  error: string | null
  onOpen: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => Promise<boolean>
  onClear: (id: string) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
  onRetry: () => void
  className?: string
}

export function ChatHistory({
  sessions,
  activeId,
  openIds,
  loading,
  error,
  onOpen,
  onNew,
  onRename,
  onClear,
  onDelete,
  onRetry,
  className,
}: ChatHistoryProps) {
  const [query, setQuery] = React.useState("")
  const [renameTarget, setRenameTarget] =
    React.useState<ChatSessionMeta | null>(null)
  const [renameTitle, setRenameTitle] = React.useState("")
  const [clearTarget, setClearTarget] = React.useState<ChatSessionMeta | null>(
    null
  )
  const [deleteTarget, setDeleteTarget] =
    React.useState<ChatSessionMeta | null>(null)
  const [busy, setBusy] = React.useState(false)

  const filtered = React.useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return sessions
    return sessions.filter((session) => {
      return (
        session.title.toLowerCase().includes(keyword) ||
        session.preview.toLowerCase().includes(keyword)
      )
    })
  }, [query, sessions])

  function openRename(session: ChatSessionMeta) {
    setRenameTarget(session)
    setRenameTitle(session.title)
  }

  async function submitRename() {
    if (!renameTarget || !renameTitle.trim()) return
    setBusy(true)
    try {
      const ok = await onRename(renameTarget.id, renameTitle.trim())
      if (ok) setRenameTarget(null)
    } finally {
      setBusy(false)
    }
  }

  async function submitClear() {
    if (!clearTarget) return
    setBusy(true)
    try {
      const ok = await onClear(clearTarget.id)
      if (ok) setClearTarget(null)
    } finally {
      setBusy(false)
    }
  }

  async function submitDelete() {
    if (!deleteTarget) return
    setBusy(true)
    try {
      const ok = await onDelete(deleteTarget.id)
      if (ok) setDeleteTarget(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <HistoryIcon className="size-4" />
          历史记录
        </div>
        <Button size="xs" onClick={onNew}>
          <PlusIcon />
          新对话
        </Button>
      </div>

      <div className="px-2 pt-2">
        <div className="relative">
          <SearchIcon className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索会话"
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2 py-2">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
            <AlertCircleIcon className="size-5 text-destructive" />
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button variant="outline" size="xs" onClick={onRetry}>
              <RefreshCwIcon />
              重试
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-2 py-10 text-center">
            <MessageSquareIcon className="size-6 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              {sessions.length === 0
                ? "还没有对话，点击「新对话」开始"
                : "没有匹配的会话"}
            </p>
          </div>
        ) : (
          <div className="space-y-1 pr-1">
            {filtered.map((session) => {
              const active = session.id === activeId
              const open = openIds.includes(session.id)
              return (
                <div
                  key={session.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(session.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      onOpen(session.id)
                    }
                  }}
                  className={cn(
                    "group relative cursor-pointer overflow-hidden rounded-lg border px-2.5 py-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
                    active
                      ? "border-primary/40 bg-primary/5"
                      : "border-transparent hover:bg-muted/60"
                  )}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    {open && (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-emerald-500"
                        title="已在标签页中打开"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {session.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {relativeTime(session.updatedAt)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {session.preview || "暂无消息"}
                  </p>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{session.messageCount} 条消息</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="opacity-100 transition-opacity data-[state=open]:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <MoreHorizontalIcon />
                          <span className="sr-only">会话操作</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => openRename(session)}>
                          <PencilIcon />
                          重命名
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setClearTarget(session)}
                        >
                          <EraserIcon />
                          清空消息
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleteTarget(session)}
                        >
                          <Trash2Icon />
                          删除会话
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </ScrollArea>

      <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">
        共 {sessions.length} 个会话 · 可多标签同时打开
      </div>

      <Dialog
        open={Boolean(renameTarget)}
        onOpenChange={(open) => {
          if (!open && !busy) setRenameTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
            <DialogDescription>
              名称会显示在历史记录与标签页中。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="chat-session-title">名称</Label>
            <Input
              id="chat-session-title"
              value={renameTitle}
              maxLength={60}
              autoFocus
              onChange={(event) => setRenameTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void submitRename()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRenameTarget(null)}
            >
              取消
            </Button>
            <Button
              disabled={busy || !renameTitle.trim()}
              onClick={() => void submitRename()}
            >
              {busy && <Loader2Icon className="animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(clearTarget)}
        onOpenChange={(open) => {
          if (!open && !busy) setClearTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清空会话消息</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{clearTarget?.title}」中的全部消息，会话本身会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void submitClear()
              }}
            >
              {busy && <Loader2Icon className="animate-spin" />}
              清空
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除会话</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除「{deleteTarget?.title}
              」吗？该会话的全部消息会被永久删除，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void submitDelete()
              }}
            >
              {busy && <Loader2Icon className="animate-spin" />}
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
