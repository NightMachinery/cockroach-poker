---
name: chrome-cdp
description: Drive the running Cockroach Poker app in a headful Chrome over the Chrome DevTools Protocol (CDP) on :9222 — screenshot pages, probe the DOM, and assert on-screen state. Use for visual verification, "does this reflow / is there horizontal scroll / what text is on screen" checks, and capturing a specific player's perspective of /play or the /game projector.
---

# chrome-cdp — drive Chrome directly, when the MCP won't

A dependency-free way to **screenshot and inspect the running app** by talking to
a headful Chrome over the Chrome DevTools Protocol (CDP) on `:9222`, using Node's
built-in `WebSocket` (Node ≥ 22). Use it for visual verification and "does this
reflow / is there horizontal scroll / what text is on screen" checks.

This skill was ported from the snow-white project and adapted for Cockroach
Poker's stack: React + Chakra UI frontend (Vite on `:5173`), Node + Socket.IO
backend (`:8420`), identity in `localStorage` under `cp_auth` / `cp_name` /
`cp_avatar`, and rooms auto-joined via the query param `/?room=CODE`.

## Why not just use the chrome-devtools MCP?

A `chrome-devtools` MCP server, when it works, is ergonomic
(`navigate_page` / `take_screenshot` / `take_snapshot` / `click`). **But in
practice it is flaky in long sessions:** individual tools intermittently
disappear from the toolset (`No such tool available: …`) even though
`claude mcp list` shows `✓ Connected`, and after a `/mcp` reconnect the server
can sit in `⏸ Pending approval`. This skill bypasses all of that: it opens a raw
WebSocket to the same Chrome and speaks CDP directly.

## Prerequisites

- Chrome listening for remote debugging:
  `curl -s --noproxy '*' http://127.0.0.1:9222/json/version` returns JSON with a
  `"Browser"` field. The user launches Chrome with
  `--remote-debugging-port=9222`; **don't kill their browser.**
- The frontend dev server up on `:5173` (`pnpm --prefix frontend dev`) and the
  backend on `:8420` (`pnpm dev` at the repo root). See `docs/self-hosting.md`.
  Remember `NO_PROXY=127.0.0.1,localhost` if a proxy is configured.
- Node ≥ 22 (built-in `WebSocket`). This repo's Node is fine (`node -v`).

## The screenshot/probe tool

[`shot.mjs`](./shot.mjs). Run it from the repo root:

```bash
# Home page, desktop viewport:
node .claude/skills/chrome-cdp/shot.mjs --out=/tmp/home.png

# The /play controller from a specific seated player's perspective, with a probe:
node .claude/skills/chrome-cdp/shot.mjs --room=ABCD --auth=tok-alice --name=Alice \
  --path=/play --vp=desktop --probe --out=/tmp/play-alice.png

# The shared /game projector / spectator screen:
node .claude/skills/chrome-cdp/shot.mjs --room=ABCD --path=/game --out=/tmp/table.png
```

Flags:
- `--room=CODE` — room to auto-join (omit for home). Appended as `?room=CODE`.
- `--auth=TOKEN` / `--name=NAME` / `--avatar=X` — identity written to
  localStorage (`cp_auth` / `cp_name` / `cp_avatar`) **before** navigating.
- `--path=/play|/game|/host|…` — which route to land on (default `/`).
- `--vp=desktop|mobile` — viewport (CDP metrics override, not window resize).
- `--out=PATH` — write a PNG.
- `--probe` — print JSON state (see below).
- `--wait=MS` — render wait after navigate (default 2200ms; raise for slow WS).

Env overrides: `CP_ORIGIN` (default `http://localhost:5173`), `CHROME_CDP`
(default `http://127.0.0.1:9222`).

`--probe` prints, e.g.:

```json
{"htmlDir":"ltr","hscroll":false,"iw":1280,"sw":1280,"url":"http://localhost:5173/play?room=ABCD","title":"Cockroach Poker","body":"…first 600 chars of visible text…"}
```

- `hscroll:false` ⇒ no horizontal scroll at this viewport.
- `body` ⇒ the first 600 chars of visible text, so you can assert state
  (whose turn, the pass/claim banner, reveal result, game-over) without pixels.

## Key know-how (the things that bite you)

1. **Viewport: override metrics, don't resize the window.** A headful Chrome
   window may be small, so resizing it clamps `innerWidth`.
   `Emulation.setDeviceMetricsOverride` (what `shot.mjs` does) overrides via CDP
   regardless of window size.

2. **Identity lives in `localStorage`, shared across same-origin tabs.** Keys:
   `cp_auth` (auth token → server-derived stable `userId` via HMAC),
   `cp_name`, `cp_avatar`. `shot.mjs` loads the origin first, sets these, then
   navigates — so one tab can impersonate any player in sequence. The auth token
   is what the backend's `identify` handler maps to a `userId`
   (`tokenToUserId`), so a stable `--auth` value gives a stable identity across
   runs. **Capture one perspective at a time** to avoid the last-write-wins
   localStorage pitfall.

3. **Drive the *other* players from Node, not from N browser tabs.** To exercise
   a real multiplayer flow (start game, pass, peek, call) you need several
   connected clients. Use the committed companion [`drive.mjs`](./drive.mjs) — it
   connects three players (Alice/Bob/Cara) over `socket.io-client`, each with a
   stable token, and drives a full game:

   ```bash
   # Headless regression: assert the hidden-info / peek / reveal contract.
   node .claude/skills/chrome-cdp/drive.mjs

   # Set up a live game and HOLD the sockets open, then screenshot a perspective:
   node .claude/skills/chrome-cdp/drive.mjs --hold      # prints ROOMCODE + tokens
   node .claude/skills/chrome-cdp/shot.mjs --auth=tok-alice --name=Alice \
        --room=<ROOMCODE> --probe --out=/tmp/play.png
   ```

   Because the browser identity (`--auth=tok-alice`) HMACs to the same `userId`
   as the driver's `tok-alice` client, the screenshot shows that exact seat's
   server-masked perspective of the game the driver is running. Key events (see
   `backend/server.js`):
   - `identify(authToken, name)` → `identity({userId, name})`
   - join/create flows, `requestStartGame(roomCode)`
   - `requestPeekCard(roomCode)` → `returnPeekCard({card})` (turn player only)
   - `requestPlayerCallCard(...)` → room-wide `returnReveal({...})`
   - per-viewer `returnGameRoom` (each socket gets its own masked payload)

4. **Per-viewer masking is server-side.** After the remote-play conversion,
   `returnGameRoom` is sanitized per socket: a viewer sees a real `hand` only for
   their own player, and `currentAction.card === 0` unless they are in the
   `conspiracy` or have peeked. To verify hidden-information enforcement, read
   the *WS frames* (or the probe `body`), not just the rendered UI — the point is
   the secret never reaches the wrong client.

## Minimal CDP, if you need more than screenshots

`shot.mjs` is ~150 lines; copy its `send()` helper to issue any CDP method
(`DOM.*`, `Input.dispatchMouseEvent` to click, `Runtime.evaluate` for arbitrary
JS, `Page.printToPDF`, etc.). The protocol is just `{id, method, params}` in and
`{id, result}` out over the target's `webSocketDebuggerUrl`.
