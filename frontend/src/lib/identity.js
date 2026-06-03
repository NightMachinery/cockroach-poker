// Client-side identity helpers.
//
// The auth token is a random secret stored in localStorage. It identifies this
// device/user to the server but is NEVER placed in a URL. The display name is
// remembered too, so players are not re-prompted on return visits.

const TOKEN_KEY = 'cp_auth';
const NAME_KEY = 'cp_name';
const AVATAR_KEY = 'cp_avatar';

const randomToken = () => {
  // 32 hex chars from a CSPRNG. Works over HTTP and HTTPS.
  const bytes = new Uint8Array(16);
  (window.crypto || window.msCrypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

export const getAuthToken = () => {
  let token = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
  } catch {
    /* localStorage unavailable */
  }
  if (!token) {
    token = randomToken();
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* ignore */
    }
  }
  return token;
};

export const getStoredName = () => {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
};

export const setStoredName = (name) => {
  try {
    if (name) localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
};

export const getStoredAvatar = () => {
  try {
    return localStorage.getItem(AVATAR_KEY) || '';
  } catch {
    return '';
  }
};

export const setStoredAvatar = (avatar) => {
  try {
    if (avatar) localStorage.setItem(AVATAR_KEY, avatar);
  } catch {
    /* ignore */
  }
};

// Read room / migrate params from the current URL (auto-join links).
export const getRoomParamsFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  return {
    room: (params.get('room') || '').toUpperCase() || null,
    migrate: params.get('migrate') || null,
  };
};

// Build a shareable auto-join link for a room.
export const buildRoomLink = (roomCode) =>
  `${window.location.origin}/?room=${encodeURIComponent(roomCode)}`;

// Build a device-migration link carrying a room-scoped migrate id.
export const buildMigrateLink = (roomCode, migrateId) =>
  `${window.location.origin}/?room=${encodeURIComponent(
    roomCode
  )}&migrate=${encodeURIComponent(migrateId)}`;
