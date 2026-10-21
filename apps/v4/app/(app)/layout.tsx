import { GepaHeader } from "@/components/gepa/gepa-header"
import { GepaSidebar } from "@/components/gepa/gepa-sidebar"
import {
  SidebarInset,
  SidebarProvider,
} from "@/registry/new-york-v4/ui/sidebar"

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <GepaSidebar />
      <SidebarInset className="min-w-0">
        <GepaHeader />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
