/** Render an env map as KEY=VALUE lines for the form textarea. */
export function envToText(env?: Record<string, string>): string {
  return Object.entries(env ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}

/** Parse KEY=VALUE lines. Blank lines and # comments are skipped; returns undefined if empty. */
export function textToEnv(text: string): Record<string, string> | undefined {
  const env: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return Object.keys(env).length ? env : undefined
}
