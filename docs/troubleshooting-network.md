# Troubleshooting Network Issues During Setup

If you encounter network errors during `./self_host.py setup`, follow these steps:

## Problem: pnpm install fails with ECONNRESET errors

This is common with poor network connectivity or proxy issues.

## Solution 1: Retry with patience

The script now automatically retries 3 times. Simply run:

```bash
./self_host.py setup
```

If it fails, wait a few minutes and try again. Network conditions may improve.

## Solution 2: Manual installation with retries

If the automatic retry doesn't work, install dependencies manually:

```bash
# Backend dependencies
pnpm install --no-frozen-lockfile

# If it fails, wait and retry:
pnpm install --no-frozen-lockfile

# Frontend dependencies
cd frontend
pnpm install --no-frozen-lockfile

# If it fails, wait and retry:
pnpm install --no-frozen-lockfile
```

Once dependencies are installed, continue with:

```bash
cd ..
./self_host.py setup
```

The script will detect existing `node_modules` and skip installation.

## Solution 3: Use npm instead of pnpm

If pnpm continues to fail, you can use npm (slower but sometimes more reliable):

```bash
# Backend
npm install

# Frontend
cd frontend
npm install
cd ..

# Then continue with setup
./self_host.py setup
```

## Solution 4: Install dependencies offline

If you have another machine with better connectivity:

1. On the machine with good connectivity:
   ```bash
   cd /path/to/cockroach-poker
   pnpm install
   cd frontend && pnpm install
   tar czf node_modules.tar.gz ../node_modules node_modules
   ```

2. Transfer `node_modules.tar.gz` to the target server

3. On the target server:
   ```bash
   cd /home/ubuntu/base/cockroach-poker
   tar xzf node_modules.tar.gz
   ./self_host.py setup
   ```

## Solution 5: Check proxy settings

Verify your proxy is working:

```bash
# Check current proxy settings
env | grep -i proxy

# Test proxy connectivity
curl -x http://127.0.0.1:9087 https://registry.npmjs.org/

# If proxy is on a different port, update it:
export http_proxy=http://127.0.0.1:YOUR_PORT
export https_proxy=http://127.0.0.1:YOUR_PORT
export all_proxy=http://127.0.0.1:YOUR_PORT

# Then retry
./self_host.py setup
```

## Solution 6: Skip dependency installation

If you already have dependencies installed from a previous attempt:

```bash
# Skip to build and start
./self_host.py stop  # Stop any running instances
cd frontend && pnpm run build  # Build frontend
cd ..
./self_host.py start  # Start production server
```

## Checking Installation Status

```bash
# Check if backend dependencies are installed
ls node_modules/ | wc -l
# Should show a number > 0

# Check if frontend dependencies are installed
ls frontend/node_modules/ | wc -l
# Should show a number > 0

# Check specific critical packages
ls node_modules/lowdb
ls node_modules/express
ls node_modules/socket.io
ls frontend/node_modules/react
ls frontend/node_modules/vite
```

## Common Error Messages

### "ECONNRESET"
Network connection was reset. Retry after a few minutes.

### "Client network socket disconnected before secure TLS connection"
TLS handshake failed. Check proxy settings or retry.

### "request to https://registry.npmjs.org/... failed"
Cannot reach npm registry. Check internet/proxy connectivity.

## Prevention

For future deployments, consider:

1. **Pre-download dependencies** on a machine with good connectivity
2. **Use a local npm registry mirror** (Verdaccio, Nexus)
3. **Increase pnpm timeout**: `pnpm install --network-timeout 300000`

## Still Having Issues?

If none of these solutions work:

1. Check if the proxy is running: `curl http://127.0.0.1:9087`
2. Try a different proxy port if available
3. Check firewall rules
4. Verify DNS resolution: `nslookup registry.npmjs.org`
5. Try at a different time (network may be congested)

## After Dependencies Are Installed

Once you have `node_modules/` in both root and `frontend/`, you can proceed:

```bash
./self_host.py setup
```

The script will detect existing dependencies and skip the installation step.
