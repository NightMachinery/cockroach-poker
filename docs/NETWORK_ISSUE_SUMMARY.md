# Proxy Handling in self_host.py

## How proxies are used

`self_host.py` runs `pnpm`, `node`, and the dev server through the user's
login shell (`/bin/zsh`). Proxy environment variables present when you invoke
the script (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `npm_config_proxy`, …)
are propagated to every command it launches.

## Why `env=` alone was not enough (the bug that was fixed)

Passing the proxy via `subprocess`'s `env=` is necessary but **not sufficient**
on this machine. `~/.zshenv` sources `~/.privateShell`, which unconditionally
re-`export`s the proxy vars to a fixed port. Because `.zshenv` runs on *every*
zsh invocation — including the non-interactive `zsh -c` the script spawns — it
**overwrote** whatever was passed via `env=`. The symptom: setting a different
proxy port had no effect; pnpm always used the port baked into `~/.privateShell`.

### The fix

The script now **re-exports the caller's proxy vars inline, after shell
startup has run**:

```
cd <dir> && nvm-load && nvm use 24 && export http_proxy=... https_proxy=... ; pnpm install ...
```

Because the inline `export`s execute after `.zshenv`/`.privateShell` are
sourced, the caller's values win. This is implemented in `node_cmd()` /
`proxy_export_prefix()` in `self_host.py`.

The same env is also passed to tmux sessions via the hardened `-e "VAR=value"`
syntax **and** re-exported inline inside the session command, for the same
reason.

## Using a specific proxy

Set the proxy vars in your shell before running the script; they are picked up
automatically:

```bash
export ALL_PROXY=http://127.0.0.1:19087 all_proxy=http://127.0.0.1:19087 \
  http_proxy=http://127.0.0.1:19087 https_proxy=http://127.0.0.1:19087 \
  HTTP_PROXY=http://127.0.0.1:19087 HTTPS_PROXY=http://127.0.0.1:19087 \
  npm_config_proxy=http://127.0.0.1:19087 npm_config_https_proxy=http://127.0.0.1:19087 \
  NO_PROXY=127.0.0.1,localhost,::1 no_proxy=127.0.0.1,localhost,::1

./self_host.py setup
```

The proxy is **not** hardcoded anywhere in the script — it only forwards what
is present in the environment.

## Verifying

```bash
# Confirm the proxy the script will actually use after the full shell pipeline:
http_proxy=http://127.0.0.1:19087 \
  zsh -c 'nvm-load && nvm use 24 >/dev/null; export http_proxy=http://127.0.0.1:19087; echo $http_proxy'
# -> http://127.0.0.1:19087
```

## If installs still fail

A correct proxy that itself can't reach the registry will still fail. In that
case:

1. Confirm the proxy is reachable: `curl -x "$http_proxy" -I https://registry.npmjs.org/`
2. Retry — the script already retries 3× with backoff.
3. See `docs/troubleshooting-network.md` for offline / npm-fallback options.
