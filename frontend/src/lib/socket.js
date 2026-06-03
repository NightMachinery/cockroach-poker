// Shared socket + identity bootstrap.
//
// All pages use a single socket connected to the current origin (so ws/wss is
// chosen automatically). On (re)connect we identify ourselves to the server
// with the persisted auth token and display name. The resolved userId is kept
// here so components can tell which player is "me".

import { io } from 'socket.io-client';
import { getAuthToken, getStoredName, setStoredName } from './identity.js';

export const socket = io(window.location.origin, { autoConnect: false });

let myUserId = null;
const userIdListeners = new Set();

export const getMyUserId = () => myUserId;
export const onUserId = (fn) => {
  userIdListeners.add(fn);
  if (myUserId) fn(myUserId);
  return () => userIdListeners.delete(fn);
};

// Send identify with our token+name. Safe to call repeatedly.
export const sendIdentify = (name) => {
  const token = getAuthToken();
  socket.emit('identify', token, name || getStoredName() || null);
};

let bootstrapped = false;
// Wire identity once for the app lifetime: identify on every connect, and track
// the server-assigned userId.
export const bootstrapIdentity = () => {
  if (bootstrapped) return;
  bootstrapped = true;

  socket.on('identity', (info) => {
    if (info?.userId) {
      myUserId = info.userId;
      userIdListeners.forEach((fn) => fn(myUserId));
    }
    if (info?.name) setStoredName(info.name);
  });

  socket.on('connect', () => sendIdentify());

  if (!socket.connected) socket.connect();
  else sendIdentify();
};
