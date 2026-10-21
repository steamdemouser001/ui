"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "cn"

const NAV_ITEMS = [
  { href: "/gepa", label: "概览" },
  { href: "/gepa/llm", label: "LLM" },
  { href: "/gepa/agents", label: "Agents" },
  { href: "/gepa/tasks", label: "任务" },
  { href: "/gepa/monitor", label: "监控" },
  { href: "/gepa/constraints", label: "约束" },
  { href: "/gepa/settings", label: "设置" },
]

export function GepaNav({ className }: { className?: string }) {
  const pathname = usePathname()

  return (
    <nav
      className={cn("flex items-center gap-1 overflow-x-auto", className)}
      aria-label="GEPA 导航"
    >
      {NAV_ITEMS.map((item) => {
        const active =
          item.href === "/gepa"
            ? pathname === "/gepa"
            : pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            data-active={active}
            className={cn(
              "relative flex h-11 shrink-0 items-center px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
              active && "text-foreground"
            )}
          >
            {item.label}
            {active && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
