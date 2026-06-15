#!/usr/bin/env node
// Multiplayer driver for Cockroach Poker — connects N players to the running
// server via socket.io-client and drives a full game flow, asserting the
// remote-play hidden-information guarantees end-to-end.
//
// This is the companion to shot.mjs: shot.mjs captures ONE browser perspective,
// while this script plays the OTHER players from Node so there is real game
// state to look at (the pattern described in README.md §3). It also doubles as a
// fast, headless regression for the server-side masking / peek / reveal contract
// (no browser needed).
//
// Usage (from the repo root, with the server running on :8420):
//   node .claude/skills/chrome-cdp/drive.mjs
//   node .claude/skills/chrome-cdp/drive.mjs --hold        # set up a live game and idle
//
// Modes:
//   (default)  Create a room, seat Alice/Bob/Cara, start, and run the full
//              assert suite (hands hidden, card masked, peek auth, reveal,
//              reset). Exits 0 iff all pass.
//   --hold     Same setup + one start-round so there's a live in-flight claim,
//              then print the room code + tokens and KEEP the sockets open so a
//              browser (shot.mjs --auth=tok-alice --room=CODE) can render the
//              shared table. Ctrl-C to stop.
//
// Env: CP_ORIGIN (default http://localhost:8420). Remember NO_PROXY=127.0.0.1,localhost.
//
// Identity note: each player uses a stable, human-readable token (tok-alice,
// …). The server HMACs the token into a stable userId, so the SAME token in a
// browser via `shot.mjs --auth=tok-alice` controls the same seat — that is how
// you screenshot a specific player's masked perspective of a game this script
// is driving.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

// Resolve socket.io-client from the repo's node_modules regardless of cwd.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(path.join(repoRoot, 'package.json'));
const { io } = require('socket.io-client');

const ORIGIN = process.env.CP_ORIGIN || 'http://localhost:8420';
const HOLD = process.argv.includes('--hold');
const log = (...a) => console.log(...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function mkClient(token, name) {
  const s = io(ORIGIN, { transports: ['websocket'] });
  const c = { s, token, name, userId: null, uuid: null, lastRoom: null, lastPeek: null, lastReveal: null };
  s.on('identity', (info) => { if (info?.userId) c.userId = info.userId; });
  s.on('returnGameRoom', (room) => { c.lastRoom = room; });
  s.on('returnPeekCard', (p) => { c.lastPeek = p; });
  s.on('returnReveal', (p) => { c.lastReveal = p; });
  s.on('returnJoinPlayerToRoom', (ok, room, uuid) => { if (ok) c.uuid = uuid; });
  return c;
}

const identify = (c) => new Promise((res) => {
  c.s.emit('identify', c.token, c.name);
  const t = setInterval(() => { if (c.userId) { clearInterval(t); res(); } }, 30);
});

async function setup() {
  const a = mkClient('tok-alice', 'Alice');
  const b = mkClient('tok-bob', 'Bob');
  const d = mkClient('tok-cara', 'Cara');
  const all = [a, b, d];

  await Promise.all(all.map((c) => new Promise((r) => c.s.on('connect', r))));
  await Promise.all(all.map(identify));
  log('identified:', all.map((c) => `${c.name}=${c.userId.slice(0, 8)}`).join(' '));

  // Alice creates the room.
  const roomCode = await new Promise((res) => {
    a.s.once('returnEmptyGameRoom', (room) => res(room.roomCode));
    a.s.emit('requestCreateEmptyGameRoom');
  });
  log('room created:', roomCode);

  // Everyone joins, then subscribes to broadcasts.
  for (const c of all) {
    await new Promise((res) => {
      c.s.once('returnJoinPlayerToRoom', () => res());
      c.s.emit('requestJoinPlayerToRoom', roomCode, c.name, 'jake');
    });
    c.s.emit('joinSocketRoom', roomCode);
  }
  await wait(300);
  log('joined uuids:', all.map((c) => `${c.name}=${c.uuid?.slice(0, 6)}`).join(' '));

  // Alice (creator) starts the game.
  a.s.emit('requestStartGame', roomCode);
  await wait(500);

  return { all, roomCode };
}

async function runAsserts({ all, roomCode }) {
  // ---- Assertion 1: hidden hands ----
  let pass = true;
  for (const viewer of all) {
    for (const p of viewer.lastRoom.players) {
      const own = p.uuid === viewer.uuid;
      const handLen = (p.hand || []).length;
      if (own && handLen === 0) { pass = false; log(`FAIL: ${viewer.name} sees own hand empty`); }
      if (!own && handLen !== 0) { pass = false; log(`FAIL: ${viewer.name} sees ${p.nickname}'s hand!`); }
    }
  }
  log(pass ? 'PASS: each viewer sees only their own hand' : 'FAIL: hand masking');

  const ca = all[0].lastRoom.currentAction;
  const turn = all.find((c) => c.uuid === ca.turnPlayer);
  const others = all.filter((c) => c.uuid !== ca.turnPlayer);
  log('turn player:', turn.name);

  // ---- Assertion 2: start round masks the card to the new turn player ----
  const myHand = turn.lastRoom.players.find((p) => p.uuid === turn.uuid).hand;
  const card = myHand[0];
  const target = others[0];
  turn.s.emit('requestPlayerStartRound', roomCode, turn.uuid, target.uuid, card, card /*truthful*/);
  await wait(400);
  const a2 = turn.lastRoom.currentAction.card === card && target.lastRoom.currentAction.card === 0;
  log(`after start: starter(conspiracy)=${turn.lastRoom.currentAction.card}, new-turn(not-peeked)=${target.lastRoom.currentAction.card}`);
  log(a2 ? 'PASS: card visible to conspiracy, masked to new turn player' : 'FAIL: card masking after start');

  // ---- Assertion 3: peek authorization + persistence ----
  others[1].lastPeek = null;
  let gotError = false;
  others[1].s.once('actionError', () => { gotError = true; });
  others[1].s.emit('requestPeekCard', roomCode);
  await wait(250);
  const a3a = gotError && others[1].lastPeek === null;
  log(a3a ? 'PASS: non-turn player cannot peek (actionError, no card)' : 'FAIL: non-turn peek leaked');

  target.lastPeek = null;
  target.s.emit('requestPeekCard', roomCode);
  await wait(250);
  const a3b = target.lastPeek && target.lastPeek.card === card;
  log(a3b ? `PASS: turn player peeks and sees card=${target.lastPeek?.card}` : 'FAIL: turn peek');

  // Refresh-after-peek: peek doesn't re-broadcast (no leak that someone looked);
  // the persisted `peeked` only surfaces on a fresh fetch (reconnect/refresh).
  target.s.emit('requestGameRoom', roomCode);
  await wait(250);
  const a3c = target.lastRoom.currentAction.youPeeked === true && target.lastRoom.currentAction.card === card;
  log(a3c ? 'PASS: after refresh, youPeeked=true and card persisted/visible' : 'FAIL: youPeeked persistence');

  // ---- Assertion 4: call + reveal + reset ----
  all.forEach((c) => (c.lastReveal = null));
  target.s.emit('requestPlayerCallCard', roomCode, target.uuid, true);
  await wait(400);
  const reveals = all.map((c) => c.lastReveal);
  const allGot = reveals.every((r) => r && r.actualCard === card);
  log(allGot ? `PASS: all clients received returnReveal (actualCard=${card}, wasCorrect=${reveals[0]?.wasCorrect})` : 'FAIL: returnReveal');
  await wait(150);
  const a4b = all.every((c) => c.lastRoom.currentAction.card === 0);
  log(a4b ? 'PASS: masked room after call shows card:0 (round reset)' : 'FAIL: card not reset');

  const results = { hands: pass, cardMask: a2, nonTurnPeek: a3a, turnPeek: a3b, youPeeked: a3c, reveal: allGot, reset: a4b };
  log('\n=== SUMMARY ===');
  log(JSON.stringify(results, null, 2));
  const ok = Object.values(results).every(Boolean);
  log(ok ? 'ALL PASS ✅' : 'SOME FAILED ❌');
  all.forEach((c) => c.s.close());
  process.exit(ok ? 0 : 1);
}

async function runHold({ all, roomCode }) {
  // One start-round so there's a live in-flight claim on the table.
  const ca = all[0].lastRoom.currentAction;
  const turn = all.find((c) => c.uuid === ca.turnPlayer);
  const others = all.filter((c) => c.uuid !== ca.turnPlayer);
  const card = turn.lastRoom.players.find((p) => p.uuid === turn.uuid).hand[0];
  turn.s.emit('requestPlayerStartRound', roomCode, turn.uuid, others[0].uuid, card, card);
  await wait(400);

  log('\n=== LIVE GAME (holding sockets open) ===');
  log('ROOMCODE=' + roomCode);
  log('STARTER=' + turn.name + ' → NOW_TURN=' + others[0].name + ' (claimed a ' + card + ')');
  log('tokens:', all.map((c) => `${c.name}=${c.token}`).join('  '));
  log('\nScreenshot a perspective, e.g.:');
  log(`  node .claude/skills/chrome-cdp/shot.mjs --auth=${others[0].token} --name=${others[0].name} --room=${roomCode} --probe --out=/tmp/play.png`);
  log('\nCtrl-C to stop.');
  setInterval(() => {}, 1 << 30);
}

setup()
  .then((ctx) => (HOLD ? runHold(ctx) : runAsserts(ctx)))
  .catch((e) => { console.error(e); process.exit(2); });
