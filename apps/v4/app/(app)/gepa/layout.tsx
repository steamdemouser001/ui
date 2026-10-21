import { GepaNav } from "@/components/gepa/gepa-nav"

export default function GepaLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b bg-background">
        <div className="container-wrapper px-6">
          <GepaNav />
        </div>
      </div>
      <div className="container-wrapper flex-1 px-6 py-8">{children}</div>
    </div>
  )
}
