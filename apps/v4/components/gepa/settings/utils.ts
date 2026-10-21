export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function omitKey(
  record: Record<string, string>,
  key: string
): Record<string, string> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}
