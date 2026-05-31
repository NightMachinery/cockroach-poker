# Self-Hosting Implementation Summary

This document summarizes all changes made to enable self-hosting of Cockroach Poker on an intranet.

## Files Created

### 1. `self_host.py`
Main deployment script with commands:
- `setup` - First-time setup and start
- `start` - Start production server
- `stop` - Stop all instances
- `dev-start` - Start development mode with hot-reload
- `redeploy` - Rebuild and restart

Features:
- Manages tmux sessions for backend and frontend
- Updates Caddy configuration automatically
- Handles proxy environment variables
- Checks port availability
- Supports custom URLs via `--url` flag

### 2. `docs/self-hosting.md`
Complete self-hosting documentation including:
- Quick start guide
- Command reference
- Architecture overview
- Troubleshooting guide
- Development workflow

## Database Migration (MongoDB → lowdb)

### Modified Files

**Backend Models:**
- `backend/models/gameroom.model.js` - Replaced Mongoose schema with lowdb-compatible class
- `backend/models/player.model.js` - Converted to plain object schema
- `backend/models/gameaction.model.js` - Converted to plain object schema

**Database Configuration:**
- `backend/config/db.js` - Replaced Mongoose connection with lowdb JSON file storage
  - Data stored in `backend/data/gamerooms.json`
  - No external database required

**Controllers:**
- `backend/controllers/gameroom.controller.js` - Updated to work with lowdb API (removed mongoose-specific code)

**Dependencies:**
- `package.json` - Removed `mongoose`, added `lowdb@7.0.1`

## Frontend Changes - Dynamic URLs

All socket connections now use `window.location.origin` instead of hardcoded URLs.

### Modified Files

**Socket Connection Updates:**
- `frontend/src/pages/HomePage.jsx`
- `frontend/src/pages/HostPage.jsx`
- `frontend/src/pages/JoinPage.jsx`
- `frontend/src/pages/GamePage.jsx`
- `frontend/src/pages/PlayPage.jsx`
- `frontend/src/pages/RejoinHost.jsx`
- `frontend/src/pages/RejoinPlayer.jsx`

Changed from:
```javascript
const socketUrl = window.location.origin.includes('localhost')
  ? 'http://localhost:8420'
  : 'https://cockroach.poker';
const socket = io(socketUrl, { autoConnect: false });
```

To:
```javascript
// Use current origin for socket connection (Socket.IO will use ws/wss automatically)
const socket = io(window.location.origin, { autoConnect: false });
```

**Display URL Updates:**
- `frontend/src/pages/HostPage.jsx` - Changed displayed domain from `cockroach.poker` to `{window.location.host}`
- `frontend/src/pages/GamePage.jsx` - Changed displayed domain from `cockroach.poker` to `{window.location.host}`

**Credits Page:**
- `frontend/src/pages/Credits.jsx` - Removed developer names, GitHub links, donation links, and purchase links. Kept asset credits and technology stack.

**Tests:**
- `frontend/src/tests/GamePage.test.jsx` - Updated test to not check for hardcoded domain

## Backend Changes

### Server Configuration
- `backend/server.js` - Added `BASE_URL` environment variable support

### Environment Variables
- `example.env` - Updated to remove `MONGO_URI`, added `BASE_URL` and documentation

New structure:
```env
PORT=8420
BASE_URL=http://localhost:8420
NODE_ENV=development
```

## Documentation Updates

### README.md
Completely rewritten with:
- Self-hosting quick start
- Tech stack overview
- Development instructions
- Production build guide
- Credits (cleaned up, removed personal info)
- License notice

## Key Features Implemented

### ✅ Intranet-Ready
- No external database dependencies
- All assets bundled locally
- No CDN or external API calls
- Dynamic URL detection

### ✅ WebSocket Protocol Handling
- Socket.IO automatically uses `ws://` or `wss://` based on page protocol
- Works on both HTTP and HTTPS

### ✅ Caddy Integration
- Automatic Caddy configuration management
- Managed blocks with BEGIN/END markers
- Support for both HTTP and HTTPS
- Automatic redirects between protocols
- Static file serving from Caddy (no separate frontend server in production)

### ✅ Development Workflow
- Hot-reload support via `dev-start`
- Separate tmux sessions for backend and frontend
- Easy switching between dev and production modes

### ✅ Proxy Support
- Respects all proxy environment variables
- Passes proxy settings to tmux sessions
- Works with poor network connectivity

### ✅ Port Management
- Checks port availability before starting
- Clear error messages if ports are in use
- Backend: 8420, Frontend dev: 5173

## Configuration

### Default URL
`https://cockroachpoker.pinky.lilf.ir`

Can be customized via:
```bash
./self_host.py setup --url https://custom.example.com
```

### Caddy Block Structure
```
# BEGIN cockroachpoker self-host
https://cockroachpoker.pinky.lilf.ir {
    tls internal
    encode zstd gzip
    
    @backend {
        path /socket.io*
    }
    
    handle @backend {
        reverse_proxy 127.0.0.1:8420
    }
    
    handle {
        root * /path/to/frontend/dist
        try_files {path} /index.html
        file_server
    }
}

http://cockroachpoker.pinky.lilf.ir {
    redir https://cockroachpoker.pinky.lilf.ir{uri} permanent
}
# END cockroachpoker self-host
```

## Next Steps

To deploy:

1. Install dependencies:
   ```bash
   pnpm install
   cd frontend && pnpm install
   ```

2. Run setup:
   ```bash
   ./self_host.py setup
   ```

3. Access at: `https://cockroachpoker.pinky.lilf.ir`

## Notes

- Game state persists to `backend/data/gamerooms.json`
- Active game rooms survive server restarts
- Tmux sessions can be attached for debugging:
  - Backend: `tmux attach -t cockroachpoker-backend`
  - Frontend (dev): `tmux attach -t cockroachpoker-frontend`
