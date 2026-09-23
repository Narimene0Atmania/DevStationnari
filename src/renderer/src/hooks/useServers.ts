import { useCallback, useEffect, useRef, useState } from 'react'
import type { LogLine, ServerConfig, ServerState } from '../../../shared/types'

const MAX_LOG_LINES = 2000

export function useServers(): {
  servers: ServerConfig[]
  states: Record<string, ServerState>
  logsFor: (id: string) => LogLine[]
  logVersion: number
  reload: () => Promise<void>
  loadLogs: (id: string) => Promise<void>
  clearLogs: (id: string) => Promise<void>
} {
  const [servers, setServers] = useState<ServerConfig[]>([])
  const [states, setStates] = useState<Record<string, ServerState>>({})
  const logs = useRef(new Map<string, LogLine[]>())
  const [logVersion, setLogVersion] = useState(0)

  const reload = useCallback(
    () =>
      Promise.all([window.api.list(), window.api.states()]).then(([list, st]) => {
        setServers(list)
        setStates(Object.fromEntries(st.map((s) => [s.id, s])))
      }),
    []
  )

  useEffect(() => {
    reload()
    const offStatus = window.api.onStatus((s) => setStates((prev) => ({ ...prev, [s.id]: s })))
    const offLog = window.api.onLog((batch) => {
      for (const line of batch) {
        const buf = logs.current.get(line.serverId)
        // Only buffer servers whose history was already fetched; others load on selection.
        if (!buf) continue
        buf.push(line)
        if (buf.length > MAX_LOG_LINES) buf.splice(0, buf.length - MAX_LOG_LINES)
      }
      setLogVersion((v) => v + 1)
    })
    return () => {
      offStatus()
      offLog()
    }
  }, [reload])

  const loadLogs = useCallback(async (id: string) => {
    if (logs.current.has(id)) return
    logs.current.set(id, [])
    const history = await window.api.getLogs(id)
    // Lines that streamed in while fetching are already in history.
    logs.current.set(id, history.slice(-MAX_LOG_LINES))
    setLogVersion((v) => v + 1)
  }, [])

  const clearLogs = useCallback(async (id: string) => {
    await window.api.clearLogs(id)
    logs.current.set(id, [])
    setLogVersion((v) => v + 1)
  }, [])

  const logsFor = useCallback((id: string) => logs.current.get(id) ?? [], [])

  return { servers, states, logsFor, logVersion, reload, loadLogs, clearLogs }
}
