import { NextResponse } from "next/server"

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init)
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
