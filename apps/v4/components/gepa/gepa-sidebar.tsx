"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ActivityIcon,
  BotIcon,
  ListTodoIcon,
  MessageSquareIcon,
  ScanSearchIcon,
  ServerIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/registry/new-york-v4/ui/sidebar"

const NAV_GROUPS = [
  {
    label: "工作台",
    items: [
      { href: "/gepa/monitor", label: "监控", icon: ActivityIcon },
      { href: "/gepa/chat", label: "对话", icon: MessageSquareIcon },
      { href: "/gepa/tasks", label: "任务", icon: ListTodoIcon },
      { href: "/gepa/analyze", label: "会话分析", icon: ScanSearchIcon },
    ],
  },
  {
    label: "配置",
    items: [
      { href: "/gepa/llm", label: "LLM 供应商", icon: ServerIcon },
      { href: "/gepa/agents", label: "Agents", icon: BotIcon },
      { href: "/gepa/constraints", label: "约束", icon: ShieldCheckIcon },
      { href: "/gepa/settings", label: "设置", icon: Settings2Icon },
    ],
  },
]

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function GepaSidebar() {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()

  const closeMobileNav = () => {
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="GEPA 控制台">
              <Link href="/gepa" onClick={closeMobileNav}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <SparklesIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">GEPA</span>
                  <span className="truncate text-xs text-muted-foreground">
                    技能迭代控制台
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive(pathname, item.href)}
                        tooltip={item.label}
                      >
                        <Link href={item.href} onClick={closeMobileNav}>
                          <Icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 rounded-md border border-sidebar-border px-2.5 py-2 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:p-0">
          <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
          <span className="truncate group-data-[collapsible=icon]:hidden">
            本地工作空间
          </span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
