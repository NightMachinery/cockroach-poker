# Remote Play

Cockroach Poker is built for **remote play**: each player is alone on their own
device. This document describes the design that makes that work — server-side
hidden-information enforcement, the per-recipient room broadcast, and the
peek / reveal socket contract.

## Why

The game was originally built assuming players **share a physical space**: the
per-player `/play` controller showed only your hand and a turn button, while the
shared table (everyone's piles, hand counts, turn indicator, reveal animation)
lived on a separate `/game` spectator screen meant for one shared display.

For remote play that doesn't work: there is no shared screen, and the old server
broadcast every player's full `hand` and the true in-flight card to *everyone*
(the UI only hid it client-side, so dev tools exposed it). Three things changed:

1. **Full hidden-information enforcement** — the server now sends each client only
   its own hand and reveals the true card only to players entitled to see it.
2. **The shared table is rendered on each player's own `/play`** (via the reusable
   `GameTable` component), so no shared display is required. `/game` remains as an
   optional projector / stream view.
3. **Rich turn/activity feedback** — pass/claim banner, activity log, and a
   your-turn alert (sound + tab-title flash).

## Per-recipient room state

`gameroom.service.js`:

- **`publicGameRoomFor(roomCode, viewerUserId)`** — the sanitized room view,
  masked for one viewer (`viewerUserId` may be `null` for spectators /
  unidentified sockets):
  - `hand`: the real array only for the viewer's own player; everyone else gets
    `[]`. `handSize` stays for all.
  - `pile` / `pileSize`: unchanged for everyone — piles are public face-up.
  - `currentAction.card`: masked to `0` unless `_canSeeActionCard` allows it.
  - the raw `peeked` array is stripped; a derived boolean `youPeeked` is added.
- **`_canSeeActionCard(ca, viewerUuid)`** — `true` only if there is a live card
  (not the `0` / `-1` sentinels) and the viewer is in `ca.conspiracy` (a prior
  holder) or in `ca.peeked` (looked at it this hop).
- **`publicGameRoom(roomCode)`** is now a thin wrapper: `publicGameRoomFor(roomCode, null)`
  (the spectator / null view).

`server.js`:

- **`broadcastGameRoom(roomCode)`** iterates the room's sockets and emits a
  per-viewer payload (`s.data.userId` → masked room). Handles unidentified
  sockets (spectator view) and multiple sockets per user automatically.
- The two direct emit sites (`requestGameRoom`, `requestCreateEmptyGameRoom`) use
  `publicGameRoomFor(roomCode, socket.data.userId)`.

## The `peeked` field

`currentAction` gains a `peeked: []` array — the uuids of players who have looked
at the current card this hop (distinct from `conspiracy`, the prior holders). It
is added to all four `currentAction` constructions (`startGame`, `startRound`,
`passCard`, and the `callCard` reset). No schema change is needed:
`currentAction` is persisted opaquely via the model's `{...this}` spread, so the
new field saves automatically. Because `peeked` is persisted and consulted by
`publicGameRoomFor`, a peeker who refreshes mid-pass still receives the real card
and `youPeeked: true`.

## Peek flow (PASS requires looking)

On your turn, choosing **PASS** means you must look at the card first. The true
card is not in your masked `returnGameRoom`, so the client requests it:

- C→S **`requestPeekCard(roomCode)`** — the server derives the caller's uuid from
  `socket.data.userId` (never trusts a client-supplied uuid) and calls
  `peekCard(roomCode, playerUuid)`, which:
  - rejects anyone who is not the `turnPlayer`, or when there is no live card;
  - records the uuid in `currentAction.peeked` and persists it;
  - returns `{ ok, card }`.
- S→**one socket** **`returnPeekCard({ card })`** — only the peeker's socket
  receives the true card. The client stores it locally and drives the pass UI.

## Reveal flow (CALL makes the card public)

`callCard` previously reset `currentAction` (card → 0) immediately, so the
revealed value was gone before anyone could animate it. It now computes and
**returns a reveal object** *before* the reset (and still returns `false` on
validation failure, so `if (reveal)` callers work):

```js
{ actualCard, claim, callAs, wasCorrect, reality,
  loserUuid, callerUuid, prevPlayerUuid }
```

`requestPlayerCallCard` emits this room-wide as **`returnReveal`** (the card is
public once called), then runs the normal broadcast + new-round + game-over flow.
The masked `returnGameRoom` that follows correctly shows `card: 0` — the round
has reset.

## Socket contract summary

| Direction | Event | Payload | Notes |
|-----------|-------|---------|-------|
| C→S | `requestPeekCard` | `roomCode` | turn player only; uuid derived server-side |
| S→one | `returnPeekCard` | `{ card }` | only the peeker's socket |
| S→room | `returnReveal` | `{ actualCard, claim, callAs, wasCorrect, reality, loserUuid, callerUuid, prevPlayerUuid }` | the card is public at call time |
| S→viewer | `returnGameRoom` | masked room | per-viewer; `currentAction.youPeeked` added, raw `peeked` removed |

## Frontend

- **`components/GameTable.jsx`** — the reusable shared-table view (avatars, turn
  glow, grayed conspiracy members, pile counts, and the reveal box driven by a
  `reveal` prop). Used by both `/game` (spectator, `myUuid={null}`) and embedded
  in `/play` (`myUuid={uuid}`). Exports the shared card/avatar maps.
- **`pages/GamePage.jsx`** — the standalone projector screen, refactored onto
  `GameTable`; its reveal is driven by `returnReveal` (the old dead
  `playerCallResult` / `turnPlayerUpdated` listeners were removed).
- **`pages/PlayPage.jsx`** — composes the shared table + the player's own
  hand/pile controller + the in-game `PlayerList` (in a drawer, so mods can manage
  observers and copy migrate links mid-game). Wires `requestPeekCard` on PASS,
  the `returnReveal` reveal box + result toast, a `returnGameOver` listener (which
  the old `/play` lacked), the pass/claim banner, the activity log, and the
  your-turn sound + tab-title flash.

## Verification

See the "Verification" section of `plans/remote-play-conversion.md` for the full
manual matrix (hidden info via WS frames, peek/pass, call/reveal, shared table,
mid-game player list / observers, feedback, game over, and the `/game`
regression). The `.claude/skills/chrome-cdp` skill can screenshot and probe each
player's perspective.
