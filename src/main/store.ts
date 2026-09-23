import { app } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import type { ServerConfig } from '../shared/types'

const file = (): string => path.join(app.getPath('userData'), 'servers.json')

let cache: ServerConfig[] | null = null

function load(): ServerConfig[] {
  if (cache) return cache
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8'))
    cache = Array.isArray(data) ? data : []
  } catch {
    cache = []
  }
  return cache
}

function save(): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  const tmp = file() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(load(), null, 2))
  fs.renameSync(tmp, file())
}

export const store = {
  list(): ServerConfig[] {
    return load()
  },
  get(id: string): ServerConfig | undefined {
    return load().find((s) => s.id === id)
  },
  add(config: Omit<ServerConfig, 'id'>): ServerConfig {
    const created = { ...config, id: randomUUID() }
    load().push(created)
    save()
    return created
  },
  update(config: ServerConfig): ServerConfig {
    const list = load()
    const i = list.findIndex((s) => s.id === config.id)
    if (i === -1) throw new Error(`Unknown server ${config.id}`)
    list[i] = config
    save()
    return config
  },
  remove(id: string): void {
    cache = load().filter((s) => s.id !== id)
    save()
  }
}
