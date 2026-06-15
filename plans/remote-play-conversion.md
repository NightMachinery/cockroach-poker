# Remote-Play Conversion for Cockroach Poker

> **Handoff doc.** This is a self-contained implementation plan for another
> developer. It records the current architecture, the gaps for remote play, the
> design decisions already made (with rationale), and a concrete, ordered
> implementation path with verification. File paths and line numbers are from
> the state of `main` at the time of writing — re-confirm them before editing.

## Context

Cockroach Poker is a real-time multiplayer card game:
- **Frontend:** React 19 + Chakra UI 2.8, Vite, React Router (`frontend/`).
- **Backend:** Node.js + Express + Socket.IO 4.8 (`backend/`).
- **Persistence:** lowdb (JSON file at `backend/data/gamerooms.json`).
- **Identity:** HMAC-derived stable `userId` per device (auth token in
  localStorage, never in URLs), `uuid` derived per (room, user). Roles:
  creator / mod / temp_mod / player / observer. Device migration via
  room-scoped opaque migrate links.

It was built assuming players **share a physical space**. The per-player
controller (`/play`, `frontend/src/pages/PlayPage.jsx`) shows only *your* hand
and a turn button. The *shared table* — everyone's piles, hand counts, who is
passing what to whom, the turn indicator, the reveal animation, game-over —
lives in a **separate spectator screen** (`/game`,
`frontend/src/pages/GamePage.jsx`) meant to be projected on one shared display.
Players relied on physically seeing the table and talking to each other.

We are converting it to **remote play**: each player is alone on their own
device. Three requirements, all confirmed with the product owner:

1. **Full hidden-information enforcement.** Today `publicGameRoom()`
   (`backend/services/gameroom.service.js:637`) broadcasts *every* player's full
   `hand` and the true in-flight `currentAction.card` to *everyone*; the UI only
   hides it client-side, so anyone with dev tools sees all hands and the real
   card. For untrusted remote play the server must send each client only its own
   hand and reveal the true card only to players entitled to see it.
2. **The shared table must live on each player's own screen** (integrated into
   `/play`), since there is no shared physical display. Observers see the table
   with no hand.
3. **Rich turn/activity feedback** (in-flight pass+claim banner, turn indicator,
   activity log, and a "it's your turn" alert with sound + tab-title flash),
   because remote players can't see the table or hear table talk.

Plus: surface the existing `PlayerList` (observer/rejoin/migrate mod controls —
`frontend/src/components/PlayerList.jsx`) **during** the game, not just in the
lobby.

### Two latent bugs this work also fixes
- `PlayPage` never handles `returnGameOver` (only `GamePage` does) → a remote
  player on `/play` never sees the game end.
- `GamePage`'s reveal animation is **dead code**: it listens for
  `playerCallResult` and `turnPlayerUpdated`, events the server never emits.

### Game-rule refresher (needed to understand the peek flow)
On your turn you must either **CALL** (guess the previous player's claim is
true/false *without looking at the card*) or **PASS** (you *look* at the card,
then pass it to someone who hasn't seen it yet, with your own claim). Loss = 4 of
the same creature in your face-up pile, or running out of hand cards. The
`conspiracy` array tracks everyone who has already seen the current card (so it
can't be passed back to them).

---

## Part 1 — Backend: per-recipient state, peek flow, reveal flow

Files: `backend/services/gameroom.service.js`, `backend/server.js`.
**No schema change** needed in `backend/models/gameroom.model.js` —
`currentAction` is persisted opaquely via the `{...this}` spread, so a new
`peeked` field saves automatically.

### Current broadcast (the leak), `backend/server.js:71-74`
```js
const broadcastGameRoom = (roomCode) => {
  const room = gameRoomService.publicGameRoom(roomCode);
  if (room) io.to(GAME_ROOM_PREFIX + roomCode).emit('returnGameRoom', room);
};
```
`publicGameRoom` (gameroom.service.js:637-666) includes every player's full
`hand` and `pile` and the raw `currentAction` (with the true `card`). Every
client receives all of it.

### 1a. Per-viewer sanitized room
**Add** `publicGameRoomFor(roomCode, viewerUserId)` in `gameroom.service.js`,
mirroring `publicGameRoom` with three masks. `viewerUserId` may be null
(spectator / not-yet-identified socket).
- `hand`: real array only for the player whose `uuid === viewerUuid`; everyone
  else `hand: []`. `handSize` stays for all.
- `pile`/`pileSize`: **unchanged for everyone** — piles are public face-up in
  this game.
- `currentAction`: shallow-clone, then set `card` via a new private predicate
  `_canSeeActionCard(currentAction, viewerUuid)`:
  ```js
  _canSeeActionCard(ca, viewerUuid) {
    if (!ca || !viewerUuid) return false;
    if (ca.card === 0 || ca.card === -1) return false;        // no live card
    return ca.conspiracy.includes(viewerUuid)
        || (ca.peeked || []).includes(viewerUuid);
  }
  ```
  When false → `card = 0`. `claim`, `turnPlayer`, `prevPlayer`, `conspiracy`
  stay visible to all. **Strip the raw `peeked` array** from the payload; instead
  add a derived `youPeeked: (ca.peeked||[]).includes(viewerUuid)` boolean to the
  cloned `currentAction` (cleaner for the frontend, doesn't leak who looked).

**Change** `publicGameRoom(roomCode)` to `return this.publicGameRoomFor(roomCode, null)`
(kept as the spectator/null wrapper).

### 1b. Personalized broadcast
**Rewrite** `broadcastGameRoom(roomCode)` in `server.js` to iterate the room's
sockets and emit a per-viewer payload. Reuse the adapter-iteration pattern
already in `anyOtherSocketForUserInRoom` (server.js:598-607):
```js
const broadcastGameRoom = (roomCode) => {
  const sockets = io.sockets.adapter.rooms.get(GAME_ROOM_PREFIX + roomCode);
  if (!sockets) return;
  for (const sid of sockets) {
    const s = io.sockets.sockets.get(sid);
    if (!s) continue;
    const room = gameRoomService.publicGameRoomFor(roomCode, s.data.userId);
    if (room) s.emit('returnGameRoom', room);
  }
};
```
This handles unidentified sockets (→ spectator view) and multiple sockets per
user automatically.

**Fix the two direct `publicGameRoom` emit sites** that bypass per-viewer
masking → switch to `publicGameRoomFor(roomCode, socket.data.userId)`:
- `requestGameRoom` handler, server.js:182-185.
- `requestCreateEmptyGameRoom` handler, server.js:198 (room is empty so it's
  functionally safe either way; change for consistency).

### 1c. Peek flow (turn player chooses PASS → must look at the card)
The true card must NOT reach the turn player until they commit to peeking.
- Add `peeked: []` to **every** constructed `currentAction`:
  `startGame` (~line 229), `startRound` (~line 258), `passCard` (~line 290),
  and the `callCard` reset (~line 323).
- **Add** `peekCard(roomCode, playerUuid)`:
  ```js
  peekCard(roomCode, playerUuid) {
    const gameRoom = this.gameRoomMap.get(roomCode);
    if (!gameRoom || !gameRoom.currentAction) return { ok: false };
    const ca = gameRoom.currentAction;
    if (playerUuid !== ca.turnPlayer) return { ok: false };   // only the turn player
    if (ca.card === 0 || ca.card === -1) return { ok: false }; // no live card
    if (!ca.peeked) ca.peeked = [];
    if (!ca.peeked.includes(playerUuid)) ca.peeked.push(playerUuid);
    return { ok: true, card: ca.card };
  }
  ```
- **Add** socket handler `requestPeekCard(roomCode)` in `server.js` (style per
  the existing action handlers ~line 476). **Derive the caller's uuid from
  `socket.data.userId`** — do NOT trust a client-supplied uuid, or a non-turn
  player could spoof:
  ```js
  socket.on('requestPeekCard', (roomCode) => {
    const userId = socket.data.userId;
    if (!userId) return;
    const player = gameRoomService.getPlayerByUserId(roomCode, userId);
    if (!player) return;
    const res = gameRoomService.peekCard(roomCode, player.uuid);
    if (!res.ok) { socket.emit('actionError', 'Cannot peek right now'); return; }
    gameRoomService.saveGameRoom(roomCode);          // persist peeked (refresh-safe)
    socket.emit('returnPeekCard', { card: res.card }); // ONLY this socket
  });
  ```
- **Refresh-after-peek works for free:** `peeked` is persisted and consulted by
  `publicGameRoomFor`, so a reconnecting peeker's `returnGameRoom` already
  contains the real `card` and `youPeeked: true`.
- `passCard` is unchanged: it still appends `fromPlayer` to `conspiracy`; the new
  turn player starts with `peeked: []` and must peek to see it; prior holders
  remain in `conspiracy` and keep visibility.

### 1d. Reveal flow at call time (everyone briefly sees the truth)
`callCard` currently resets `currentAction` (card → 0) immediately, so the
revealed value is gone before anyone can animate it. Carry the reveal in its own
event — keeps masking strict.
- **Change** `callCard(roomCode, fromPlayer, callAs)` to compute and **return a
  reveal object** *before* the reset; keep `return false` on validation failure
  (`if (success)` callers still work — a non-null object is truthy):
  ```js
  const reality    = ca.card === ca.claim;
  const wasCorrect = (callAs === reality);
  const loser      = wasCorrect ? ca.prevPlayer : ca.turnPlayer;
  const reveal = { actualCard: ca.card, claim: ca.claim, callAs, wasCorrect,
                   reality, loserUuid: loser, callerUuid: ca.turnPlayer,
                   prevPlayerUuid: ca.prevPlayer };
  this.addCardToPile(roomCode, loser, ca.card);
  gameRoom.currentAction = { turnPlayer: loser, prevPlayer: loser,
                             conspiracy: [], peeked: [], card: 0, claim: 0 };
  return reveal;
  ```
- **Change** `requestPlayerCallCard` handler (server.js:545-571): on a truthy
  result, emit `returnReveal` to the whole room (the card is public once
  called), then the existing room broadcast + new-round + game-over flow:
  ```js
  const reveal = gameRoomService.callCard(roomCode, fromPlayer, callAs);
  if (reveal) {
    io.to(GAME_ROOM_PREFIX + roomCode).emit('returnReveal', reveal);
    gameRoomService.saveGameRoom(roomCode);   // piles feed loss condition
    sendGameRoomToEveryoneInRoom(roomCode);   // card already masked to 0 — correct
    sendNewRoundInfoToEveryoneInRoom(roomCode);
    endGameIfLossCondition(roomCode);
  }
  ```

### New socket contract (frontend consumes these)
- C→S `requestPeekCard(roomCode)` → S→**one socket** `returnPeekCard({ card })`.
- S→**room** `returnReveal({ actualCard, claim, callAs, wasCorrect, reality, loserUuid, callerUuid, prevPlayerUuid })`.
- `returnGameRoom` is now per-viewer masked; `currentAction.youPeeked` added,
  raw `peeked` removed.

### Backend change checklist
`gameroom.service.js`: add `publicGameRoomFor`, `_canSeeActionCard`, `peekCard`;
change `publicGameRoom` (→ wrapper), `callCard` (return reveal), and add
`peeked: []` to the 4 `currentAction` constructions.
`server.js`: rewrite `broadcastGameRoom`; fix `requestGameRoom` +
`requestCreateEmptyGameRoom` emits; add `requestPeekCard`; update
`requestPlayerCallCard`.
`gameroom.model.js`: no code change (optionally document `peeked`).

---

## Part 2 — Frontend: shared table + controller on one screen (`PlayPage`)

Reuse the visual vocabulary already in `GamePage.jsx`: avatar glow for the turn
player, grayed-out conspiracy avatars, pile-by-type counts, the centered reveal
box with green/red/yellow states.

### 2a. Extract a reusable table component
- **Add** `frontend/src/components/GameTable.jsx` by lifting the table JSX from
  `GamePage.jsx`: the per-player avatar / hand-count / pile layout (~lines
  316-465) and the centered reveal box (~lines 467-535). Props:
  `{ gameRoom, myUuid, reveal }`. Renders all players around the table,
  highlights `currentAction.turnPlayer`, grays conspiracy members, and shows the
  reveal box driven by the `reveal` prop (see 2c) instead of the dead
  `playerCallResult`/`turnPlayerUpdated` listeners.
- **Refactor** `GamePage.jsx` to render `<GameTable myUuid={null} ...>` (keeps
  the standalone spectator/projector screen working and DRY). Remove its dead
  `playerCallResult`/`turnPlayerUpdated` effects; drive its reveal from the new
  `returnReveal` event.

### 2b. Compose the in-game PlayPage layout
PlayPage's ONGOING branch (PlayPage.jsx ~line 521) currently shows only the
table-less controller. Restructure it to show, on one screen:
- The shared `<GameTable gameRoom={gameRoom} myUuid={uuid} reveal={reveal} />`.
- The player's own hand/pile card (existing toggle UI) + the turn action
  button(s) (existing "Play!" / "It's your turn" / disabled states + the
  `turnPlayerModal`).
- `<PlayerList room={gameRoom} me={myUserId} />` available **during** the game
  (e.g. a drawer / collapsible panel) so mods can manage observers and copy
  migrate links mid-game. The component already has every control — this is just
  rendering it in the ONGOING state, not only the waiting state (it's currently
  only at PlayPage.jsx:611 in the waiting branch).
- **Observers** (`role === 'observer'`): render the table + player list, but no
  hand and no action buttons (their `hand` is `[]` and it's never their turn).

### 2c. Wire peek + reveal into the turn flow
The turn modal (PlayPage.jsx ~line 368) currently reads `currentAction.card`
directly to reveal on "Pass It". Under enforcement the client doesn't have it
until peeking:
- On **Pass It** click: emit `requestPeekCard(roomCode)`, await
  `returnPeekCard({ card })`, store it in local state, and drive the pass UI
  (the "It was a X!" text + card image, currently using `currentAction.card` at
  lines 380-400) from that local value.
- **Refresh mid-pass:** seed the local peeked-card state from
  `currentAction.card` whenever `currentAction.youPeeked` is true (the server
  already includes the real card for a peeker).
- **Call It** is unchanged on the wire (`requestPlayerCallCard`), but the result
  toast (lines 130-147) can no longer read `currentAction.card` pre-reveal —
  derive the outcome from the new `returnReveal` event instead.
- **Add a `returnReveal` listener** in PlayPage feeding the `<GameTable>` reveal
  box + a per-player result toast; clear after the animation window (mirror the
  2s timing already in GamePage, lines 215-227).
- **Add a `returnGameOver` listener** in PlayPage (currently missing) → show the
  game-over / "play again" state to remote players.

---

## Part 3 — Frontend: turn & activity feedback

Files: `PlayPage.jsx` (+ small helpers); reuse the existing Chakra `useToast`.
- **In-flight pass banner / turn indicator:** a persistent banner derived from
  `currentAction`, e.g. "**Alice** passed to **Bob**, claiming **Rat**" and
  "It's **Bob's** turn". Use the existing `getPlayerName` (PlayPage.jsx:188) /
  `displayName`. Gives remote players the claim they'd otherwise have heard.
- **Activity log (lightweight):** keep the last N actions in component state,
  appended on `returnGameRoom` transitions and `returnReveal`. Render in a small
  scrollable panel / the player-list drawer. No backend history store.
- **"Your turn" alert:** when `currentAction.turnPlayer` transitions to my uuid,
  (a) play a short sound (reuse the `AudioPlayer` asset approach
  `frontend/src/components/AudioPlayer.jsx`, or a tiny `<audio>` ping added to
  `public/`), and (b) flash the browser tab title (toggle `document.title` on an
  interval until the tab regains focus or it's no longer my turn). Helps AFK
  remote players notice.

---

## Part 4 — Docs

Per repo convention (`docs/` + `README.md` kept current):
- **`README.md`:** update the shared-table description — `/play` now shows the
  table for each remote player; `/game` is an optional projector/stream view.
  Document the hidden-information model (per-recipient state; peek required to
  see a passed card).
- **`docs/`:** add a short note (extend `docs/implementation-summary.md` or add
  `docs/remote-play.md`) describing the per-viewer broadcast, the
  `requestPeekCard` / `returnPeekCard` / `returnReveal` contract, and the
  `peeked` field.

---

## Suggested atomic commits (in order)

1. **Backend: per-recipient room state** — `publicGameRoomFor` +
   `_canSeeActionCard`, personalized `broadcastGameRoom`, fix direct emit sites.
2. **Backend: peek + reveal flows** — `peeked` field, `peekCard` +
   `requestPeekCard`, `callCard` reveal payload + `returnReveal` emit.
3. **Frontend: GameTable extraction** — new `GameTable.jsx`, refactor `GamePage`
   onto it, drive reveal from `returnReveal`, drop dead listeners.
4. **Frontend: PlayPage shared table + peek/reveal/game-over wiring** — compose
   table + controller + in-game PlayerList; peek-on-pass; reveal + game-over
   listeners.
5. **Frontend: turn & activity feedback** — pass/claim banner, activity log,
   your-turn sound + tab-title flash.
6. **Docs** — README + docs/ updates.

Commits 1→2 are backend-only and independently testable. 3 is a safe refactor.
4 depends on 1-3. 5 depends on 4. Each is a cohesive, reviewable unit.

---

## Verification

Setup: `pnpm install` at root and in `frontend/`. Run backend on 8420 and Vite
on 5173, or build the frontend and run with `NODE_ENV=production` for a
single-origin server (see `docs/self-hosting.md`). Use 3 separate browsers /
profiles to get 3 distinct identities.

1. **Hidden info:** join one room with all 3, start the game. In each browser's
   WS frames, confirm `returnGameRoom` has a non-empty `hand` ONLY for that
   viewer's own player, and `currentAction.card === 0` for players not in
   conspiracy/peeked. As a non-turn player, emit `requestPeekCard` from the
   console → expect `actionError`, no `returnPeekCard`.
2. **Peek/pass:** as the turn player click "Pass It" → real card appears only
   after `returnPeekCard`; refresh mid-pass → card still visible
   (`youPeeked`/persisted); pass it on; next player can't see it until they peek.
3. **Call/reveal:** call a card → all 3 browsers show the reveal box
   (green/red), the correct loser gets the pile card, `returnReveal` carries the
   actual card, and the masked `returnGameRoom` right after shows `card: 0`.
4. **Shared table on /play:** each player sees everyone's piles, hand counts,
   turn glow, and the in-flight pass+claim banner — without opening `/game`.
5. **Player list / observers mid-game:** as a mod, open the in-game player list,
   toggle a player to observer and back; copy a migrate link and open it in a
   fresh browser to confirm migration still works during a game.
6. **Feedback:** switch away from the tab, have someone pass to you → sound +
   tab-title flash fire on your turn; activity log records passes + call results.
7. **Game over:** drive a loss (4 of a kind, or empty hand) → game-over state
   now appears on `/play`, not just `/game`.
8. **Regression:** the standalone `/game` spectator screen still renders the
   table + reveal via the refactored `GameTable`.
