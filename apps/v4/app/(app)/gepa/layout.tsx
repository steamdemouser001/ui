export default function GepaLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-6 md:px-8 md:py-8">
      {children}
    </div>
  )
}
