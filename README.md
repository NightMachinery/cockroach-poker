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
