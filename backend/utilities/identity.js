// Identity & per-room id derivation.
//
// Security model:
// - The client holds a random userAuthToken in localStorage. It is sent to the
//   server to identify the device, but NEVER placed in any URL.
// - userId = HMAC(serverSecret, token): a stable, opaque id derived from the
//   token. Room data references userId, not the token.
// - A room-specific migrateId = HMAC(serverSecret, roomCode + ':' + userId).
//   It is safe to put in a shareable link: it does not reveal the token or the
//   userId, and it is scoped to one room.
// - derivePlayerUuid keeps the in-game player.uuid stable per (room, user) so
//   existing gameplay code (hand/pile/turn keyed by uuid) is unaffected.

import crypto from 'crypto';
import { getDB } from '../config/db.js';

// Lazily-created, persisted server secret. Stored in db meta so derived ids are
// stable across restarts.
let cachedSecret = null;

export const getServerSecret = () => {
  if (cachedSecret) return cachedSecret;
  const db = getDB();
  if (!db.data.meta?.serverSecret) {
    db.data.meta = db.data.meta || {};
    db.data.meta.serverSecret = crypto.randomBytes(32).toString('hex');
    // Fire-and-forget persist; subsequent reads use the cached value.
    db.write().catch(() => {});
  }
  cachedSecret = db.data.meta.serverSecret;
  return cachedSecret;
};

const hmac = (input) =>
  crypto.createHmac('sha256', getServerSecret()).update(input).digest('hex');

// Stable opaque user id derived from the secret auth token.
export const tokenToUserId = (token) => hmac(`user:${token}`).slice(0, 24);

// Room-scoped, shareable id that maps back to a userId only on this server.
export const roomMigrateId = (roomCode, userId) =>
  hmac(`migrate:${roomCode}:${userId}`).slice(0, 32);

// Stable in-game player uuid per (room, user).
export const derivePlayerUuid = (roomCode, userId) =>
  hmac(`player:${roomCode}:${userId}`).slice(0, 32);

// Generate a fresh random token (used if a client somehow lacks one).
export const newAuthToken = () => crypto.randomBytes(16).toString('hex');
