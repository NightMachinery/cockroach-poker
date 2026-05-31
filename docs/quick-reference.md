# Quick Reference - Cockroach Poker Self-Hosting

## Installation & Setup

```bash
cd /home/ubuntu/base/cockroach-poker

# First time setup (installs deps, builds, configures Caddy, starts server)
./self_host.py setup

# Or with custom URL
./self_host.py setup --url https://poker.example.com
```

**Default URL:** `https://cockroachpoker.pinky.lilf.ir`

## Commands

```bash
# Start production server
./self_host.py start

# Stop all instances
./self_host.py stop

# Start development mode (hot-reload)
./self_host.py dev-start

# Redeploy after code changes
./self_host.py redeploy
```

## Tmux Sessions

```bash
# View running sessions
tmux ls

# Attach to backend logs
tmux attach -t cockroachpoker-backend

# Attach to frontend dev logs (dev mode only)
tmux attach -t cockroachpoker-frontend

# Detach: Ctrl+B then D
```

## Ports

- **Backend:** 8420
- **Frontend dev:** 5173 (dev mode only)

## Data Storage

Game rooms persist to: `backend/data/gamerooms.json`

## Caddy

Configuration managed in `~/Caddyfile` between:
```
# BEGIN cockroachpoker self-host
...
# END cockroachpoker self-host
```

Manual reload:
```bash
caddy reload --config ~/Caddyfile
```

## Troubleshooting

### Port in use
```bash
lsof -i :8420
lsof -i :5173
./self_host.py stop
```

### Reset everything
```bash
./self_host.py stop
rm -rf node_modules frontend/node_modules frontend/dist
./self_host.py setup
```

### Check logs
```bash
tmux attach -t cockroachpoker-backend
# or
tmux capture-pane -t cockroachpoker-backend -p
```

## Architecture

**Production:**
- Caddy serves static files from `frontend/dist`
- Caddy proxies `/socket.io*` to backend (port 8420)
- Backend handles game logic and WebSocket connections

**Development:**
- Caddy proxies frontend to Vite dev server (port 5173)
- Caddy proxies `/socket.io*` to backend (port 8420)
- Hot-reload enabled for both frontend and backend

## Key Features

✅ No external database (lowdb JSON file)
✅ All assets bundled locally
✅ Dynamic URL detection (works on any domain)
✅ WebSocket protocol auto-detection (ws/wss)
✅ HTTPS with internal TLS + HTTP redirect
✅ Proxy support for intranet deployment
✅ Development mode with hot-reload

## Configuration File

`.self_host_config.json` stores the deployment URL:
```json
{
  "url": "https://cockroachpoker.pinky.lilf.ir"
}
```

Edit this file and run `./self_host.py redeploy` to change the URL.

## Environment Variables

Create `.env` from `example.env`:
```env
PORT=8420
BASE_URL=https://cockroachpoker.pinky.lilf.ir
NODE_ENV=production
```

The `self_host.py` script sets these automatically.
