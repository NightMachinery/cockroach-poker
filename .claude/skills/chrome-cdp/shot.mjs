#!/usr/bin/env node
// Reliable Chrome screenshotter + DOM prober over the Chrome DevTools Protocol,
// talking straight to a headful Chrome on :9222 using Node's BUILT-IN WebSocket
// (Node >= 22). No dependencies, no MCP server in the loop.
//
// Why this exists: a chrome-devtools MCP server can be flaky in long sessions —
// individual tools (take_screenshot/take_snapshot/evaluate_script) intermittently
// vanish from the toolset mid-session and need a /mcp reconnect. This script hits
// the same Chrome directly, so it keeps working when the MCP doesn't. See
// ./README.md for the full story and the multi-player workflow.
//
// Adapted for Cockroach Poker (React + Socket.IO). Identity lives in
// localStorage under cp_auth / cp_name / cp_avatar, and a room is auto-joined via
// the query param /?room=CODE (see frontend/src/lib/identity.js).
//
// Usage:
//   node shot.mjs --out=PATH [--room=CODE] [--auth=TOKEN] [--name=NAME] \
//                 [--path=/play] [--vp=desktop|mobile] [--probe] [--wait=MS]
//
// Examples:
//   # Home page, desktop:
//   node .claude/skills/chrome-cdp/shot.mjs --out=/tmp/home.png
//   # The /play controller as a specific seated player (identity set first):
//   node .claude/skills/chrome-cdp/shot.mjs --room=ABCD --auth=tok-alice \
//        --name=Alice --path=/play --probe --out=/tmp/play-alice.png
//   # The shared /game projector screen:
//   node .claude/skills/chrome-cdp/shot.mjs --room=ABCD --path=/game --out=/tmp/table.png
//
// --probe prints JSON: { htmlDir, hscroll, iw, sw, body } — handy for asserting
// "no horizontal scroll" and reading on-screen text without pixels.
//
// Identity note: the app reads identity from localStorage (cp_auth / cp_name /
// cp_avatar). This script loads the origin first to set those keys, THEN
// navigates to the target — so one Chrome tab can impersonate any player in turn.
// To exercise multiplayer flows, drive the *other* players from a socket.io-client
// script against the backend (see README); you only need a browser for the
// perspective you are screenshotting.

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  })
);
const {
  room = '',
  auth = '',
  name = '',
  avatar = '',
  path = '',
  vp = 'desktop',
  out,
  probe,
  wait,
} = args;
const ORIGIN = process.env.CP_ORIGIN || 'http://localhost:5173';
const CDP = process.env.CHROME_CDP || 'http://127.0.0.1:9222';
const RENDER_WAIT = Number(wait) || 2200;

const noproxyFetch = (u, o) => fetch(u, o); // 127.0.0.1 — set NO_PROXY if needed

// Pick an existing page target, or create one.
const targets = await (await noproxyFetch(`${CDP}/json`)).json();
const target =
  targets.find((t) => t.type === 'page') ||
  (await (await noproxyFetch(`${CDP}/json/new`)).json());

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d.result);
    pending.delete(d.id);
  }
};

await send('Page.enable');
await send('Runtime.enable');

// Viewport. A headful Chrome window may be small, so DON'T rely on resizing the
// OS window — override metrics via CDP instead (this is the equivalent of the
// MCP `emulate` tool, and unlike `resize_page` it is not clamped by the window).
const dims =
  vp === 'mobile'
    ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
    : { width: 1280, height: 850, deviceScaleFactor: 1, mobile: false };
await send('Emulation.setDeviceMetricsOverride', dims);

// Load the origin first so we can write identity into localStorage...
await send('Page.navigate', { url: `${ORIGIN}/` });
await new Promise((r) => setTimeout(r, 800));
const setLS = `(${(a, n, av) => {
  try {
    if (a) localStorage.setItem('cp_auth', a);
    if (n) localStorage.setItem('cp_name', n);
    if (av) localStorage.setItem('cp_avatar', av);
    return 'ok';
  } catch (e) {
    return '' + e;
  }
}})(${JSON.stringify(auth)}, ${JSON.stringify(name)}, ${JSON.stringify(avatar)})`;
await send('Runtime.evaluate', { expression: setLS });

// ...then navigate to the actual target. A room is auto-joined via ?room=CODE;
// --path lets you land directly on /play, /game, etc.
const base = path ? `${ORIGIN}${path.startsWith('/') ? path : '/' + path}` : `${ORIGIN}/`;
const url = room
  ? `${base}${base.includes('?') ? '&' : '?'}room=${encodeURIComponent(room)}`
  : base;
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, RENDER_WAIT)); // let the WS connect + render

if (probe) {
  const expr = `(${() => {
    return JSON.stringify({
      htmlDir: getComputedStyle(document.documentElement).direction,
      hscroll: document.documentElement.scrollWidth > window.innerWidth,
      iw: window.innerWidth,
      sw: document.documentElement.scrollWidth,
      url: location.href,
      title: document.title,
      body: document.body.innerText.slice(0, 600),
    });
  }})()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(r.result?.value || JSON.stringify(r));
}

if (out) {
  const cap = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  if (cap.data) {
    const fs = await import('fs');
    fs.writeFileSync(out, Buffer.from(cap.data, 'base64'));
    console.log('SAVED', out);
  } else {
    console.log('FAIL', JSON.stringify(cap).slice(0, 150));
  }
}

ws.close();
