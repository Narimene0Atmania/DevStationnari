import { useState } from 'react'
import type { ServerConfig } from '../../../shared/types'

interface Props {
  initial?: ServerConfig
  onSave: (config: Omit<ServerConfig, 'id'>) => void
  onCancel: () => void
}

function envToText(env?: Record<string, string>): string {
  return Object.entries(env ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}

function textToEnv(text: string): Record<string, string> | undefined {
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

export default function ServerForm({ initial, onSave, onCancel }: Props): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? '')
  const [cwd, setCwd] = useState(initial?.cwd ?? '')
  const [command, setCommand] = useState(initial?.command ?? '')
  const [port, setPort] = useState(initial?.port ? String(initial.port) : '')
  const [envText, setEnvText] = useState(envToText(initial?.env))

  const portNum = port.trim() ? Number(port) : undefined
  const portValid =
    portNum === undefined || (Number.isInteger(portNum) && portNum > 0 && portNum < 65536)
  const valid = name.trim() && cwd.trim() && command.trim() && portValid

  const browse = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (dir) {
      setCwd(dir)
      if (!name.trim()) setName(dir.split(/[\\/]/).filter(Boolean).pop() ?? '')
    }
  }

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!valid) return
    onSave({
      name: name.trim(),
      cwd: cwd.trim(),
      command: command.trim(),
      port: portNum,
      env: textToEnv(envText)
    })
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form className="modal" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <h2>{initial ? 'Edit server' : 'Add server'}</h2>

        <label>
          Working directory
          <div className="row">
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="D:\Code\my-app"
            />
            <button type="button" className="btn" onClick={browse}>
              Browse…
            </button>
          </div>
        </label>

        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Frontend" />
        </label>

        <label>
          Command
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="npm run dev"
            className="mono"
          />
        </label>

        <label>
          Port <span className="muted">(optional — used for conflict checks and readiness)</span>
          <input
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="5173"
            inputMode="numeric"
            className={portValid ? '' : 'invalid'}
          />
        </label>

        <label>
          Environment <span className="muted">(KEY=VALUE per line)</span>
          <textarea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            rows={3}
            className="mono"
            placeholder="NODE_ENV=development"
          />
        </label>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valid}>
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
