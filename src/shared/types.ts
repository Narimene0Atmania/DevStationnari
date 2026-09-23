export interface ServerConfig {
  id: string
  name: string
  cwd: string
  command: string
  port?: number
  env?: Record<string, string>
}

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'crashed'

export interface ServerState {
  id: string
  status: ServerStatus
  pid?: number
  /** Port actually in use (may differ from config.port after "use next free port"). */
  activePort?: number
  exitCode?: number | null
}

export interface LogLine {
  serverId: string
  stream: 'stdout' | 'stderr' | 'system'
  text: string
  ts: number
}

export interface PortOwner {
  pid: number
  name: string
}

export interface PortCheck {
  port: number
  free: boolean
  owner?: PortOwner
  suggestedPort?: number
}

export interface StartOptions {
  /** Override the port and inject it as PORT env var. */
  portOverride?: number
}

export type StartResult =
  { ok: true } | { ok: false; conflict: PortCheck } | { ok: false; error: string }

export interface DevStationApi {
  list(): Promise<ServerConfig[]>
  states(): Promise<ServerState[]>
  add(config: Omit<ServerConfig, 'id'>): Promise<ServerConfig>
  update(config: ServerConfig): Promise<ServerConfig>
  remove(id: string): Promise<void>
  start(id: string, opts?: StartOptions): Promise<StartResult>
  stop(id: string): Promise<void>
  restart(id: string): Promise<StartResult>
  getLogs(id: string): Promise<LogLine[]>
  clearLogs(id: string): Promise<void>
  checkPort(port: number): Promise<PortCheck>
  killPort(port: number): Promise<boolean>
  pickFolder(): Promise<string | null>
  openExternal(url: string): Promise<void>
  onLog(cb: (lines: LogLine[]) => void): () => void
  onStatus(cb: (state: ServerState) => void): () => void
}
