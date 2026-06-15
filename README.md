# Cockroach Poker Online

An online multiplayer implementation of the bluffing card game Cockroach Poker.

## Self-Hosting

See [docs/self-hosting.md](docs/self-hosting.md) for complete self-hosting instructions.

Quick start:
```bash
./self_host.py setup
```

## Tech Stack

- **Frontend**: React 19, Vite 6, Chakra UI
- **Backend**: Node.js, Express, Socket.IO
- **Database**: lowdb (lightweight JSON file storage)
- **Deployment**: Caddy web server

## Development

### Prerequisites

- Node.js (via nvm)
- pnpm package manager
- Python 3 (for self-host script)

### Local Development

```bash
# Install dependencies
pnpm install
cd frontend && pnpm install

# Start backend (port 8420)
pnpm run dev

# Start frontend dev server (port 5173)
cd frontend && pnpm run dev
```

### Production Build

```bash
# Build frontend
cd frontend && pnpm run build

# Start production server
NODE_ENV=production node backend/server.js
```

## Game Rules

Cockroach Poker is a bluffing game where players pass cards to each other, making claims about what creature is on the card. The receiving player must decide whether to believe the claim or call it a bluff. The goal is to avoid collecting four of the same creature type.

### Remote play

The game is built for **remote play** — each player is alone on their own device.

- The **shared table** (everyone's piles, hand counts, the turn indicator, and the
  reveal animation) is rendered on every player's own `/play` controller, so no
  shared physical screen is needed. Observers see the table with no hand.
- The `/game` route is an **optional** big-screen / projector / stream view of the
  same table and is not required for remote play.
- A persistent **pass/claim banner**, an **activity log**, and a **your-turn alert**
  (sound + tab-title flash) keep remote players in the loop.

### Hidden-information model

Hidden information is enforced **server-side**, not just hidden in the UI:

- Each client's `returnGameRoom` is **sanitized per viewer**: you receive the real
  `hand` only for your own player; everyone else's `hand` is empty (`handSize`
  stays visible). Piles are public face-up for everyone.
- The in-flight card's true value is masked to `0` for anyone not entitled to see
  it. On your turn you must **peek** (PASS) to look at the card before passing it
  on — the server reveals the card only to you, and records that you've seen it
  (`peeked`), so a refresh mid-pass keeps it visible.
- At **call** time the card becomes public and is broadcast to the whole room via a
  one-shot `returnReveal` event for the reveal animation.

See [docs/remote-play.md](docs/remote-play.md) for the socket contract and the
per-recipient broadcast design.

## Credits

### Assets

- Card designs by Lindsey Seay
- Avatars by [Icons8](https://icons8.com/)
- Music: "Justice" by Sonda, "Drives Me Nuts" by A.T.M., "Funk in the Trunk" by Trinity

### Built With

- [Chakra UI](https://chakra-ui.com/) – Component styling
- [React](https://reactjs.org/) – UI library
- [Socket.IO](https://socket.io/) – Real-time multiplayer
- [Vite](https://vitejs.dev/) – Development & build tool
- [Vitest](https://vitest.dev/) – Testing framework

### About

Cockroach Poker is a card game by Drei Magier Spiele. This is an unofficial online implementation for educational purposes.

## License

This project is for educational purposes only. Cockroach Poker is a trademark of Drei Magier Spiele.
