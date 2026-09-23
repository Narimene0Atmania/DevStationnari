import { useEffect, useState } from 'react'
import type { PortCheck, ServerConfig, StartOptions, StartResult } from '../../shared/types'
import LogViewer from './components/LogViewer'
import PortConflictDialog from './components/PortConflictDialog'
import ServerForm from './components/ServerForm'
import ServerList from './components/ServerList'
import { useServers } from './hooks/useServers'

type FormState = { mode: 'add' } | { mode: 'edit'; server: ServerConfig } | null
type Conflict = { server: ServerConfig; check: PortCheck } | null

function App(): React.JSX.Element {
  const { servers, states, logsFor, logVersion, reload, loadLogs, clearLogs } = useServers()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(null)
  const [conflict, setConflict] = useState<Conflict>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = servers.find((s) => s.id === selectedId) ?? servers[0] ?? null
  const state = selected ? states[selected.id] : undefined
  const status = state?.status ?? 'stopped'
  const isLive = status === 'running' || status === 'starting'
  const activePort = state?.activePort ?? selected?.port

  useEffect(() => {
    if (selected) loadLogs(selected.id)
  }, [selected, loadLogs])

  const handleResult = (server: ServerConfig, res: StartResult): void => {
    if (res.ok) return
    if ('conflict' in res) setConflict({ server, check: res.conflict })
    else setError(res.error)
  }

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const start = (server: ServerConfig, opts?: StartOptions): Promise<void> =>
    run(async () => handleResult(server, await window.api.start(server.id, opts)))

  const save = (data: Omit<ServerConfig, 'id'>): Promise<void> =>
    run(async () => {
      if (form?.mode === 'edit') {
        await window.api.update({ ...data, id: form.server.id })
      } else {
        const created = await window.api.add(data)
        setSelectedId(created.id)
      }
      setForm(null)
      await reload()
    })

  const remove = (server: ServerConfig): void => {
    if (!confirm(`Remove "${server.name}"? It will be stopped if running.`)) return
    run(async () => {
      await window.api.remove(server.id)
      setSelectedId(null)
      await reload()
    })
  }

  const resolveKill = (): Promise<void> =>
    run(async () => {
      if (!conflict) return
      await window.api.killPort(conflict.check.port)
      // Give the OS a moment to release the socket.
      await new Promise((r) => setTimeout(r, 400))
      const { server } = conflict
      setConflict(null)
      const opts =
        conflict.check.port !== server.port ? { portOverride: conflict.check.port } : undefined
      handleResult(server, await window.api.start(server.id, opts))
    })

  const resolveNext = (): Promise<void> => {
    if (!conflict?.check.suggestedPort) return Promise.resolve()
    const { server, check } = conflict
    setConflict(null)
    return start(server, { portOverride: check.suggestedPort })
  }

  return (
    <div className="layout">
      <ServerList
        servers={servers}
        states={states}
        selectedId={selected?.id ?? null}
        onSelect={setSelectedId}
        onAdd={() => setForm({ mode: 'add' })}
      />

      <main className="detail">
        {selected ? (
          <>
            <header className="detail-head">
              <div className="detail-title">
                <h2>
                  {selected.name}
                  <span className={`pill pill-${status}`}>{status}</span>
                </h2>
                <div className="meta">
                  <code>{selected.command}</code>
                  <span className="muted small">{selected.cwd}</span>
                  {activePort ? (
                    <a
                      href="#"
                      className="small"
                      onClick={(e) => {
                        e.preventDefault()
                        window.api.openExternal(`http://localhost:${activePort}`)
                      }}
                    >
                      http://localhost:{activePort}
                    </a>
                  ) : null}
                  {state?.pid && isLive ? (
                    <span className="muted small">PID {state.pid}</span>
                  ) : null}
                </div>
              </div>
              <div className="row">
                {isLive ? (
                  <>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        run(async () =>
                          handleResult(selected, await window.api.restart(selected.id))
                        )
                      }
                    >
                      Restart
                    </button>
                    <button
                      className="btn btn-danger"
                      disabled={busy}
                      onClick={() => run(() => window.api.stop(selected.id))}
                    >
                      Stop
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => start(selected)}
                  >
                    Start
                  </button>
                )}
                <button className="btn" onClick={() => setForm({ mode: 'edit', server: selected })}>
                  Edit
                </button>
                <button className="btn btn-ghost" onClick={() => remove(selected)}>
                  Delete
                </button>
              </div>
            </header>

            {error ? (
              <div className="error" onClick={() => setError(null)}>
                {error}
              </div>
            ) : null}

            <LogViewer
              key={selected.id}
              lines={logsFor(selected.id)}
              version={logVersion}
              onClear={() => clearLogs(selected.id)}
            />
          </>
        ) : (
          <div className="empty">
            <h2>Your local servers, in one place</h2>
            <p className="muted">
              Add a dev server once. Then start it, stop it, and watch its logs from here.
            </p>
            <button className="btn btn-primary" onClick={() => setForm({ mode: 'add' })}>
              + Add your first server
            </button>
          </div>
        )}
      </main>

      {form ? (
        <ServerForm
          initial={form.mode === 'edit' ? form.server : undefined}
          onSave={save}
          onCancel={() => setForm(null)}
        />
      ) : null}

      {conflict ? (
        <PortConflictDialog
          serverName={conflict.server.name}
          conflict={conflict.check}
          busy={busy}
          onKill={resolveKill}
          onUseNext={resolveNext}
          onCancel={() => setConflict(null)}
        />
      ) : null}
    </div>
  )
}

export default App
