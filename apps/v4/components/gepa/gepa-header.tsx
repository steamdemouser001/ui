"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRightIcon } from "lucide-react"

import { ModeSwitcher } from "@/components/mode-switcher"
import { Separator } from "@/registry/new-york-v4/ui/separator"
import { SidebarTrigger } from "@/registry/new-york-v4/ui/sidebar"

const PAGE_TITLES: Record<string, string> = {
  "/gepa": "概览",
  "/gepa/tasks": "任务",
  "/gepa/monitor": "监控",
  "/gepa/llm": "LLM 供应商",
  "/gepa/agents": "Agents",
  "/gepa/constraints": "全局约束",
  "/gepa/settings": "设置",
}

function getPageTitle(pathname: string) {
  if (pathname.startsWith("/gepa/tasks/")) {
    return "任务详情"
  }

  const match = Object.keys(PAGE_TITLES)
    .sort((a, b) => b.length - a.length)
    .find((href) => pathname === href || pathname.startsWith(`${href}/`))

  return match ? PAGE_TITLES[match] : ""
}

export function GepaHeader() {
  const pathname = usePathname()
  const isGepa = pathname === "/gepa" || pathname.startsWith("/gepa/")
  const title = getPageTitle(pathname)

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur md:px-6">
      <SidebarTrigger className="-ml-1.5" />
      <Separator orientation="vertical" className="h-4!" />
      {isGepa ? (
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link
            href="/gepa"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            GEPA
          </Link>
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
          <span className="truncate font-medium">{title}</span>
        </div>
      ) : (
        <span className="text-sm font-medium">GEPA 控制台</span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <ModeSwitcher />
      </div>
    </header>
  )
}
