import { PORT_PLACEHOLDER, type PortCheck } from '../../../shared/types'

interface Props {
  serverName: string
  command: string
  conflict: PortCheck
  busy: boolean
  onKill: () => void
  onUseNext: () => void
  onCancel: () => void
}

export default function PortConflictDialog({
  serverName,
  command,
  conflict,
  busy,
  onKill,
  onUseNext,
  onCancel
}: Props): React.JSX.Element {
  const { port, owner, suggestedPort } = conflict
  return (
    <div className="modal-backdrop" onMouseDown={busy ? undefined : onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Port {port} is in use</h2>
        <p>
          <strong>{serverName}</strong> wants port <code>{port}</code>, but it is already taken
          {owner ? (
            <>
              {' '}
              by <code>{owner.name}</code> (PID {owner.pid}).
            </>
          ) : (
            '.'
          )}
        </p>
        {suggestedPort ? (
          <p className="muted small">
            {command.includes(PORT_PLACEHOLDER) ? (
              <>
                “Use port {suggestedPort}” fills in <code>{PORT_PLACEHOLDER}</code> in your command.
              </>
            ) : (
              <>
                “Use port {suggestedPort}” sets the <code>PORT</code> environment variable. Tools
                like Vite, Angular and Laravel ignore it and need a flag: edit the command to use{' '}
                <code>{PORT_PLACEHOLDER}</code>, e.g.{' '}
                <code>npm run dev -- --port {PORT_PLACEHOLDER}</code>.
              </>
            )}
          </p>
        ) : null}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          {suggestedPort ? (
            <button className="btn" onClick={onUseNext} disabled={busy}>
              Use port {suggestedPort}
            </button>
          ) : null}
          <button className="btn btn-danger" onClick={onKill} disabled={busy}>
            {busy ? 'Working…' : 'Kill it & start'}
          </button>
        </div>
      </div>
    </div>
  )
}
