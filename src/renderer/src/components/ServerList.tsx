import type { ServerConfig, ServerState } from '../../../shared/types'
import logo from '../assets/logo.png'

interface Props {
  servers: ServerConfig[]
  states: Record<string, ServerState>
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
}

export default function ServerList({
  servers,
  states,
  selectedId,
  onSelect,
  onAdd
}: Props): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <img src={logo} alt="" className="brand-logo" />
          <h1>DevStationnari</h1>
        </div>
        <button className="btn btn-primary btn-sm" onClick={onAdd}>
          + Add
        </button>
      </div>
      {servers.length === 0 ? (
        <p className="muted sidebar-empty">No servers yet. Add one to get started.</p>
      ) : (
        <ul className="server-list">
          {servers.map((s) => {
            const st = states[s.id]
            const status = st?.status ?? 'stopped'
            const port = st?.activePort ?? s.port
            return (
              <li key={s.id}>
                <button
                  className={`server-item ${s.id === selectedId ? 'active' : ''}`}
                  onClick={() => onSelect(s.id)}
                >
                  <span className={`dot dot-${status}`} title={status} />
                  <span className="server-name">{s.name}</span>
                  {port ? <span className="server-port">:{port}</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
