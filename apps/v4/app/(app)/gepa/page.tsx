import { redirect } from "next/navigation"

/** 概览页已移除：默认进入运行监控。 */
export default function GepaIndexPage() {
  redirect("/gepa/monitor")
}
