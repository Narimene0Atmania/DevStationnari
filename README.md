# DevStationnari

A lightweight desktop hub to start, stop and watch your local dev servers, whatever the framework.

- One-click start / stop / restart, with status (stopped · starting · running · crashed)
- Live stdout/stderr log viewer per server
- Port conflict detection: see which process holds the port, kill it, or use the next free port
- Kills the whole process tree (`npm run dev` → node → vite), and stops everything on quit

Built with Electron + React + TypeScript (electron-vite). Server definitions live in
`%APPDATA%/devstationnari/servers.json`.

## Development

```bash
npm install
npm run dev        # launch with HMR
npm run typecheck
npm run lint
npm run build:win  # NSIS installer
```
