// User model for lowdb.
//
// A user is the persistent identity behind a device's auth token. We store the
// token (server-side only) so a returning device is recognized, plus the last
// display name so players are not re-prompted for it.
//
// Shape: { userId, token, name }

import { getDB } from '../config/db.js';

export const findUserByToken = async (token) => {
  const db = getDB();
  return db.data.users.find((u) => u.token === token) || null;
};

export const findUserById = async (userId) => {
  const db = getDB();
  return db.data.users.find((u) => u.userId === userId) || null;
};

// Create or update a user record, returning the stored user.
export const upsertUser = async ({ userId, token, name }) => {
  const db = getDB();
  let user = db.data.users.find((u) => u.userId === userId);
  if (user) {
    if (token) user.token = token;
    if (name) user.name = name;
  } else {
    user = { userId, token: token || null, name: name || null };
    db.data.users.push(user);
  }
  await db.write();
  return user;
};

// Update just the display name for a known user.
export const setUserName = async (userId, name) => {
  const db = getDB();
  const user = db.data.users.find((u) => u.userId === userId);
  if (user) {
    user.name = name;
    await db.write();
  }
  return user;
};
