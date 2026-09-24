# DevStationnari

A lightweight desktop hub to start, stop and watch your local dev servers, whatever the framework.

![Two servers running with live logs](docs/screenshots/running.png)

- One-click start / stop / restart, with status (stopped · starting · running · crashed)
- Live stdout/stderr log viewer per server
- Port conflict detection: see which process holds the port, kill it, or use the next free port
- Kills the whole process tree (`npm run dev` → node → vite), and stops everything on quit
- Lives in the system tray: closing the window keeps servers running, and the tray menu can start, stop and open them

Built with Electron + React + TypeScript (electron-vite). Server definitions live in
`%APPDATA%/devstationnari/servers.json`.

## Screenshots

| Add a server                                          | Port already in use                                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ![Add server dialog](docs/screenshots/add-server.png) | ![Port conflict dialog showing the owning process](docs/screenshots/port-conflict.png) |

## How it works

- **Main process** (`src/main`) owns every child process. `serverManager.ts` spawns the
  command through the shell, streams its output into a bounded log buffer, and polls the
  configured port until something accepts a connection before it reports `running`.
- **Process-tree kill.** A dev command like `npm run dev` usually spawns a chain of
  children. On Windows the manager uses `taskkill /T /F`; on macOS and Linux each server
  runs in its own process group so one signal reaches the whole tree, with a SIGKILL
  fallback if SIGTERM is ignored.
- **Port checks** (`ports.ts`) bind the port on both IPv4 and IPv6, then ask `netstat` or
  `lsof` who is listening. That is how the conflict dialog can name the owning process.
- **Preload bridge** (`src/preload`) exposes a small typed API over IPC. The renderer runs
  sandboxed with context isolation and no Node access.
- **Renderer** (`src/renderer`) is a plain React app that subscribes to status and log
  events and never touches the OS directly.

The "Use port N" option sets the `PORT` environment variable. It only helps if the command
reads it (Laravel, Next.js, Express and most Node servers do; Vite does not, so pass
`--port` in the command instead).

## Development

```bash
npm install
npm run dev        # launch with HMR
npm run typecheck
npm run lint
npm run build:win  # NSIS installer
```

CI runs typecheck, lint, formatting and the build on every push.
