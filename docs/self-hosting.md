# Self-Hosting Cockroach Poker

This guide explains how to self-host Cockroach Poker on your own server using the `self_host.py` script.

## Prerequisites

- Python 3
- Node.js (via nvm)
- pnpm package manager
- Caddy web server
- tmux
- Access to `~/Caddyfile` for configuration

## Quick Start

```bash
# Setup and start (first time)
./self_host.py setup

# Or specify a custom URL
./self_host.py setup --url https://mypoker.example.com
```

The default URL is `https://cockroachpoker.pinky.lilf.ir`.

## Commands

### `setup`
First-time setup: stops any running instances, installs dependencies, builds the project, configures Caddy, and starts the server.

```bash
./self_host.py setup [--url URL]
```

### `start`
Start the production server. Automatically stops any running dev or prod instances first.

```bash
./self_host.py start
```

### `stop`
Stop all running instances (both production and development).

```bash
./self_host.py stop
```

### `dev-start`
Start in development mode with hot-reloading. The Caddy configuration is updated to proxy to the Vite dev server. Automatically stops other instances first.

```bash
./self_host.py dev-start
```

### `redeploy`
Redeploy the latest local changes: stops the server, rebuilds, and restarts in production mode.

```bash
./self_host.py redeploy
```

## Architecture

### Components

1. **Backend Server** (tmux session: `cockroachpoker-backend`)
   - Express + Socket.IO server
   - Runs on port 8420
   - Handles game logic and real-time multiplayer

2. **Frontend** (production)
   - Built static files served directly by Caddy from `frontend/dist`
   - No separate frontend server in production

3. **Frontend Dev Server** (tmux session: `cockroachpoker-frontend`, dev mode only)
   - Vite dev server with HMR
   - Runs on port 5173
   - Only active during `dev-start`

### Caddy Configuration

The script manages a block in `~/Caddyfile` between:
```
# BEGIN cockroachpoker self-host
...
# END cockroachpoker self-host
```

**Production mode:**
- Serves static files from `frontend/dist`
- Proxies `/socket.io*` to backend (port 8420)
- SPA fallback routing (`try_files {path} /index.html`)

**Dev mode:**
- Proxies frontend requests to Vite dev server (port 5173)
- Proxies `/socket.io*` to backend (port 8420)

### Data Persistence

Game state is persisted to a local JSON file using **lowdb**:
- Location: `backend/data/gamerooms.json`
- Active game rooms survive server restarts
- Lightweight, no external database required

## Network Requirements

### Proxy Support

The script respects proxy environment variables for npm/pnpm operations:
- `http_proxy`, `https_proxy`, `HTTP_PROXY`, `HTTPS_PROXY`
- `all_proxy`, `ALL_PROXY`
- `npm_config_proxy`, `npm_config_https_proxy`

These are automatically passed to tmux sessions and build commands.

### Port Usage

The script checks that required ports are available before starting:
- **8420**: Backend server
- **5173**: Frontend dev server (dev mode only)

## Intranet Deployment

This setup is designed for intranet deployment with no external dependencies:

- ✅ All assets (fonts, images, sounds) are bundled locally
- ✅ No CDN dependencies
- ✅ No external API calls
- ✅ No Google Fonts or analytics
- ✅ WebSocket protocol (ws/wss) determined dynamically from page URL
- ✅ Clipboard functionality works over HTTPS

## Customization

### Changing the URL

Edit the URL in two ways:

1. **Via command line:**
   ```bash
   ./self_host.py setup --url https://mypoker.example.com
   ```

2. **Manually edit `.self_host_config.json`:**
   ```json
   {
     "url": "https://mypoker.example.com"
   }
   ```
   Then run `./self_host.py redeploy`.

### Node Version

The script uses the Node version available via `nvm`. To change:

```bash
nvm install 20  # or your preferred version
nvm use 20
./self_host.py redeploy
```

## Troubleshooting

### Check running sessions

```bash
tmux ls
```

Look for:
- `cockroachpoker-backend`
- `cockroachpoker-frontend` (dev mode only)

### View logs

```bash
# Backend logs
tmux attach -t cockroachpoker-backend

# Frontend dev logs (dev mode)
tmux attach -t cockroachpoker-frontend
```

Press `Ctrl+B` then `D` to detach without stopping.

### Port already in use

If ports 8420 or 5173 are in use:

```bash
# Find what's using the port
lsof -i :8420
lsof -i :5173

# Stop the conflicting process or use ./self_host.py stop
```

### Caddy not reloading

```bash
# Manually reload Caddy
caddy reload --config ~/Caddyfile
```

### Reset everything

```bash
./self_host.py stop
rm -rf node_modules frontend/node_modules frontend/dist
./self_host.py setup
```

## Development Workflow

1. Make code changes
2. Run `./self_host.py dev-start` for live development with HMR
3. Test your changes at the configured URL
4. When ready, run `./self_host.py redeploy` to build and deploy to production

## Security Notes

- The default configuration uses Caddy's internal TLS certificates
- CORS is configured to allow all origins (`*`) — restrict this for production use
- No authentication is built into the game — consider adding reverse proxy auth if needed
