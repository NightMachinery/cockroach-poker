#!/usr/bin/env python3
"""
Self-hosting script for Cockroach Poker
Manages deployment, development, and production modes with Caddy integration.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import socket
from pathlib import Path
from typing import Optional, Dict, Any

# Configuration
PROJECT_NAME = "cockroachpoker"
BACKEND_PORT = 8420
FRONTEND_DEV_PORT = 5173
BACKEND_TMUX_SESSION = f"{PROJECT_NAME}-backend"
FRONTEND_TMUX_SESSION = f"{PROJECT_NAME}-frontend"
CONFIG_FILE = ".self_host_config.json"
DEFAULT_URL = "https://cockroachpoker.pinky.lilf.ir"
CADDY_CONFIG = Path.home() / "Caddyfile"
CADDY_BEGIN_MARKER = f"# BEGIN {PROJECT_NAME} self-host"
CADDY_END_MARKER = f"# END {PROJECT_NAME} self-host"

# Get project root (where this script lives)
PROJECT_ROOT = Path(__file__).parent.resolve()


def run_cmd(cmd: str, cwd: Optional[Path] = None, check: bool = True,
            capture_output: bool = False, env: Optional[Dict[str, str]] = None) -> subprocess.CompletedProcess:
    """Run a shell command."""
    actual_cwd = cwd or PROJECT_ROOT
    actual_env = os.environ.copy()
    if env:
        actual_env.update(env)

    print(f"→ {cmd}")
    result = subprocess.run(
        cmd,
        shell=True,
        cwd=actual_cwd,
        check=check,
        capture_output=capture_output,
        text=True,
        env=actual_env,
        executable="/bin/zsh"
    )
    return result


def is_port_in_use(port: int) -> bool:
    """Check if a port is already in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0


def check_ports(dev_mode: bool = False):
    """Check if required ports are available."""
    ports_to_check = [BACKEND_PORT]
    if dev_mode:
        ports_to_check.append(FRONTEND_DEV_PORT)

    in_use = [p for p in ports_to_check if is_port_in_use(p)]
    if in_use:
        print(f"⚠️  Ports already in use: {', '.join(map(str, in_use))}")
        print("Run './self_host.py stop' first, or check for other processes:")
        for port in in_use:
            print(f"  lsof -i :{port}")
        sys.exit(1)


def load_config() -> Dict[str, Any]:
    """Load configuration from file."""
    config_path = PROJECT_ROOT / CONFIG_FILE
    if config_path.exists():
        with open(config_path) as f:
            return json.load(f)
    return {"url": DEFAULT_URL}


def save_config(config: Dict[str, Any]):
    """Save configuration to file."""
    config_path = PROJECT_ROOT / CONFIG_FILE
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2)
    print(f"✓ Config saved to {CONFIG_FILE}")


def get_proxy_env() -> Dict[str, str]:
    """Get proxy environment variables if they exist."""
    proxy_vars = [
        'http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY',
        'all_proxy', 'ALL_PROXY', 'no_proxy', 'NO_PROXY',
        'npm_config_proxy', 'npm_config_https_proxy'
    ]
    return {k: v for k, v in os.environ.items() if k in proxy_vars}


def tmux_kill_session(session_name: str):
    """Kill a tmux session if it exists."""
    result = run_cmd(
        f"tmux kill-session -t {session_name}",
        check=False,
        capture_output=True
    )
    if result.returncode == 0:
        print(f"✓ Stopped tmux session: {session_name}")


def tmux_new_session(session_name: str, command: str, env: Optional[Dict[str, str]] = None):
    """Create a new detached tmux session with a command."""
    # Kill existing session first
    tmux_kill_session(session_name)

    # Build env args for tmux
    env_args = ""
    if env:
        env_args = " ".join([f'-e "{k}={v}"' for k, v in env.items()])

    # Create new session
    tmux_cmd = f"tmux new -d -s {session_name} {env_args} '{command}'"
    run_cmd(tmux_cmd)
    print(f"✓ Started tmux session: {session_name}")


def stop_all():
    """Stop all running instances."""
    print("Stopping all instances...")
    tmux_kill_session(BACKEND_TMUX_SESSION)
    tmux_kill_session(FRONTEND_TMUX_SESSION)
    print("✓ All instances stopped")


def parse_url(url: str) -> tuple[str, str, bool]:
    """Parse URL into (domain, protocol, is_https)."""
    url = url.rstrip('/')
    if url.startswith('https://'):
        return url[8:], 'https', True
    elif url.startswith('http://'):
        return url[7:], 'http', False
    else:
        # Default to https
        return url, 'https', True


def generate_caddy_config(url: str, dev_mode: bool = False) -> str:
    """Generate Caddy configuration block."""
    domain, protocol, is_https = parse_url(url)

    config_lines = [CADDY_BEGIN_MARKER]

    if is_https:
        # HTTPS primary block
        config_lines.extend([
            f"https://{domain} {{",
            "\ttls internal",
            "\tencode zstd gzip",
            "",
            "\t@backend {{",
            "\t\tpath /socket.io*",
            "\t}}",
            "",
            "\thandle @backend {{",
            f"\t\treverse_proxy 127.0.0.1:{BACKEND_PORT}",
            "\t}}",
            "",
        ])

        if dev_mode:
            # In dev mode, proxy everything else to Vite
            config_lines.extend([
                "\thandle {",
                f"\t\treverse_proxy 127.0.0.1:{FRONTEND_DEV_PORT}",
                "\t}",
            ])
        else:
            # In prod mode, serve static files
            config_lines.extend([
                "\thandle {",
                f"\t\troot * {PROJECT_ROOT}/frontend/dist",
                "\t\ttry_files {{path}} /index.html",
                "\t\tfile_server",
                "\t}",
            ])

        config_lines.extend([
            "}",
            "",
            f"http://{domain} {{",
            f"\tredir https://{domain}{{uri}} permanent",
            "}",
        ])
    else:
        # HTTP primary block
        config_lines.extend([
            f"http://{domain} {{",
            "\tencode zstd gzip",
            "",
            "\t@backend {{",
            "\t\tpath /socket.io*",
            "\t}}",
            "",
            "\thandle @backend {{",
            f"\t\treverse_proxy 127.0.0.1:{BACKEND_PORT}",
            "\t}}",
            "",
        ])

        if dev_mode:
            config_lines.extend([
                "\thandle {",
                f"\t\treverse_proxy 127.0.0.1:{FRONTEND_DEV_PORT}",
                "\t}",
            ])
        else:
            config_lines.extend([
                "\thandle {",
                f"\t\troot * {PROJECT_ROOT}/frontend/dist",
                "\t\ttry_files {{path}} /index.html",
                "\t\tfile_server",
                "\t}",
            ])

        config_lines.extend([
            "}",
            "",
            f"https://{domain} {{",
            "\ttls internal",
            f"\tredir http://{domain}{{uri}} permanent",
            "}",
        ])

    config_lines.append(CADDY_END_MARKER)
    return "\n".join(config_lines)


def update_caddy_config(url: str, dev_mode: bool = False):
    """Update Caddy configuration with the new block."""
    if not CADDY_CONFIG.exists():
        print(f"⚠️  Caddy config not found at {CADDY_CONFIG}")
        print("Creating new Caddyfile...")
        CADDY_CONFIG.write_text("")

    # Read existing config
    content = CADDY_CONFIG.read_text()

    # Remove old managed block if it exists
    pattern = re.compile(
        rf'^{re.escape(CADDY_BEGIN_MARKER)}.*?^{re.escape(CADDY_END_MARKER)}',
        re.MULTILINE | re.DOTALL
    )
    content = pattern.sub('', content).strip()

    # Add new block
    new_block = generate_caddy_config(url, dev_mode)
    content = content + "\n\n\n" + new_block + "\n"

    # Write back
    CADDY_CONFIG.write_text(content)
    print(f"✓ Updated {CADDY_CONFIG}")

    # Reload Caddy
    result = run_cmd("caddy reload --config ~/Caddyfile", check=False, capture_output=True)
    if result.returncode == 0:
        print("✓ Caddy reloaded")
    else:
        print(f"⚠️  Caddy reload failed: {result.stderr}")
        print("You may need to run: caddy reload --config ~/Caddyfile")


def install_dependencies():
    """Install project dependencies."""
    print("Installing dependencies...")
    print("⚠️  This may take a while with poor network connectivity...")

    proxy_env = get_proxy_env()

    # Root dependencies (backend)
    print("\n→ Installing backend dependencies...")
    print("   (pnpm will retry on network errors, please be patient)")

    max_retries = 3
    for attempt in range(max_retries):
        result = run_cmd("pnpm install --no-frozen-lockfile", env=proxy_env, check=False)
        if result.returncode == 0:
            break
        if attempt < max_retries - 1:
            print(f"   ⚠️  Install failed, retrying ({attempt + 2}/{max_retries})...")
            import time
            time.sleep(5)
        else:
            print("\n❌ Backend dependency installation failed after multiple retries.")
            print("This is likely due to network connectivity issues.")
            print("\nYou can:")
            print("  1. Try running './self_host.py setup' again")
            print("  2. Manually run: pnpm install")
            print("  3. Check your proxy settings")
            sys.exit(1)

    # Frontend dependencies
    print("\n→ Installing frontend dependencies...")
    print("   (pnpm will retry on network errors, please be patient)")

    for attempt in range(max_retries):
        result = run_cmd("pnpm install --no-frozen-lockfile", cwd=PROJECT_ROOT / "frontend", env=proxy_env, check=False)
        if result.returncode == 0:
            break
        if attempt < max_retries - 1:
            print(f"   ⚠️  Install failed, retrying ({attempt + 2}/{max_retries})...")
            import time
            time.sleep(5)
        else:
            print("\n❌ Frontend dependency installation failed after multiple retries.")
            print("This is likely due to network connectivity issues.")
            print("\nYou can:")
            print("  1. Try running './self_host.py setup' again")
            print("  2. Manually run: cd frontend && pnpm install")
            print("  3. Check your proxy settings")
            sys.exit(1)

    print("✓ Dependencies installed")


def build_frontend():
    """Build the frontend for production."""
    print("Building frontend...")
    run_cmd("pnpm run build", cwd=PROJECT_ROOT / "frontend")
    print("✓ Frontend built")


def start_backend(url: str):
    """Start the backend server."""
    print("Starting backend server...")

    # Prepare environment
    env = get_proxy_env()
    env.update({
        'NODE_ENV': 'production',
        'PORT': str(BACKEND_PORT),
        'BASE_URL': url,
    })

    # Build env string for tmux
    env_str = " ".join([f'{k}="{v}"' for k, v in env.items()])

    # Start command with nvm
    cmd = f"cd {PROJECT_ROOT} && nvm-load && nvm use && {env_str} node backend/server.js"

    tmux_new_session(BACKEND_TMUX_SESSION, cmd, env)
    print(f"✓ Backend running on port {BACKEND_PORT}")


def start_frontend_dev():
    """Start the frontend dev server."""
    print("Starting frontend dev server...")

    env = get_proxy_env()

    # Start command with nvm
    cmd = f"cd {PROJECT_ROOT}/frontend && nvm-load && nvm use && pnpm run dev"

    tmux_new_session(FRONTEND_TMUX_SESSION, cmd, env)
    print(f"✓ Frontend dev server running on port {FRONTEND_DEV_PORT}")


def cmd_setup(args):
    """Setup command: install, build, configure, and start."""
    url = args.url or DEFAULT_URL

    print(f"Setting up Cockroach Poker at {url}...")
    print()

    # Save config
    config = {"url": url}
    save_config(config)

    # Stop any running instances
    stop_all()

    # Check ports
    check_ports(dev_mode=False)

    # Install dependencies
    install_dependencies()

    # Build frontend
    build_frontend()

    # Update Caddy config (production mode)
    update_caddy_config(url, dev_mode=False)

    # Start backend
    start_backend(url)

    print()
    print("=" * 60)
    print(f"✓ Setup complete! Cockroach Poker is running at:")
    print(f"  {url}")
    print()
    print("Tmux sessions:")
    print(f"  Backend:  tmux attach -t {BACKEND_TMUX_SESSION}")
    print()
    print("To stop: ./self_host.py stop")
    print("=" * 60)


def cmd_start(args):
    """Start command: start production server."""
    config = load_config()
    url = config.get("url", DEFAULT_URL)

    print(f"Starting Cockroach Poker at {url}...")

    # Stop any running instances
    stop_all()

    # Check ports
    check_ports(dev_mode=False)

    # Update Caddy config (production mode)
    update_caddy_config(url, dev_mode=False)

    # Start backend
    start_backend(url)

    print()
    print("=" * 60)
    print(f"✓ Cockroach Poker is running at:")
    print(f"  {url}")
    print()
    print("Tmux sessions:")
    print(f"  Backend:  tmux attach -t {BACKEND_TMUX_SESSION}")
    print("=" * 60)


def cmd_stop(args):
    """Stop command: stop all instances."""
    stop_all()


def cmd_dev_start(args):
    """Dev-start command: start in development mode with hot-reload."""
    config = load_config()
    url = config.get("url", DEFAULT_URL)

    print(f"Starting Cockroach Poker in DEV mode at {url}...")

    # Stop any running instances
    stop_all()

    # Check ports
    check_ports(dev_mode=True)

    # Update Caddy config (dev mode)
    update_caddy_config(url, dev_mode=True)

    # Start backend
    start_backend(url)

    # Start frontend dev server
    start_frontend_dev()

    print()
    print("=" * 60)
    print(f"✓ Cockroach Poker DEV mode running at:")
    print(f"  {url}")
    print()
    print("Tmux sessions:")
    print(f"  Backend:   tmux attach -t {BACKEND_TMUX_SESSION}")
    print(f"  Frontend:  tmux attach -t {FRONTEND_TMUX_SESSION}")
    print()
    print("Hot-reload enabled. Edit files and see changes live!")
    print("To deploy to production: ./self_host.py redeploy")
    print("=" * 60)


def cmd_redeploy(args):
    """Redeploy command: rebuild and restart."""
    config = load_config()
    url = config.get("url", DEFAULT_URL)

    print(f"Redeploying Cockroach Poker at {url}...")

    # Stop
    stop_all()

    # Check ports
    check_ports(dev_mode=False)

    # Build
    build_frontend()

    # Update Caddy (production mode)
    update_caddy_config(url, dev_mode=False)

    # Start
    start_backend(url)

    print()
    print("=" * 60)
    print(f"✓ Redeployment complete! Running at:")
    print(f"  {url}")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(
        description="Self-hosting management for Cockroach Poker"
    )
    subparsers = parser.add_subparsers(dest='command', help='Command to run')

    # setup
    setup_parser = subparsers.add_parser('setup', help='First-time setup')
    setup_parser.add_argument('--url', help=f'Deployment URL (default: {DEFAULT_URL})')
    setup_parser.set_defaults(func=cmd_setup)

    # start
    start_parser = subparsers.add_parser('start', help='Start production server')
    start_parser.set_defaults(func=cmd_start)

    # stop
    stop_parser = subparsers.add_parser('stop', help='Stop all instances')
    stop_parser.set_defaults(func=cmd_stop)

    # dev-start
    dev_parser = subparsers.add_parser('dev-start', help='Start in development mode')
    dev_parser.set_defaults(func=cmd_dev_start)

    # redeploy
    redeploy_parser = subparsers.add_parser('redeploy', help='Redeploy latest changes')
    redeploy_parser.set_defaults(func=cmd_redeploy)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    args.func(args)


if __name__ == '__main__':
    main()
