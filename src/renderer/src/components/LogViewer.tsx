import { useLayoutEffect, useRef, useState } from 'react'
import type { LogLine } from '../../../shared/types'

interface Props {
  lines: LogLine[]
  version: number
  onClear: () => void
}

export default function LogViewer({ lines, version, onClear }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && follow) el.scrollTop = el.scrollHeight
  }, [version, follow, lines])

  const onScroll = (): void => {
    const el = ref.current
    if (!el) return
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
  }

  return (
    <section className="logs">
      <div className="logs-head">
        <span className="muted small">
          {lines.length} line{lines.length === 1 ? '' : 's'}
        </span>
        <div className="row">
          {!follow ? (
            <button className="btn btn-sm" onClick={() => setFollow(true)}>
              ↓ Follow
            </button>
          ) : null}
          <button className="btn btn-sm" onClick={onClear}>
            Clear
          </button>
        </div>
      </div>
      <div className="logs-body mono" ref={ref} onScroll={onScroll}>
        {lines.length === 0 ? (
          <div className="muted">No output yet.</div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={`log-line log-${l.stream}`}>
              {l.text || ' '}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
