import express from 'express';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import {
  CardNumberToString,
  Cards,
  GAME_ROOM_PREFIX,
  GameStatus,
  Roles,
  NO_MODS_TIMEOUT_MS,
} from './utilities/constants.js';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { GameRoomService } from './services/gameroom.service.js';
import {
  tokenToUserId,
  newAuthToken,
} from './utilities/identity.js';
import {
  findUserByToken,
  findUserById,
  upsertUser,
  setUserName,
} from './models/user.model.js';
import cors from 'cors';
import path from 'path';

dotenv.config();

const app = express();

// Set BASE_URL from environment or construct from PORT
const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 8420}`;
app.use(cors());

const PORT = process.env.PORT || 8420;

// Create an HTTP server and attach Express
const server = createServer(app);

// SocketIO
const io = new Server(server, {
  cors: {
    origin: '*', // Adjust as needed for security
  },
});

// Allows us to parse JSON data in request body
app.use(express.json());

const __dirname = path.resolve();

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '/frontend/dist')));

  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'frontend', 'dist', 'index.html'));
  });
}

const gameRoomService = new GameRoomService();

// Connect the database, then restore game rooms from it.
// connectDB() must run before any model query (lowdb has no query buffering).
const dbReady = (async () => {
  await connectDB();
  await gameRoomService.initializeGameRoomMap();
})();

// Broadcast a PER-VIEWER sanitized room to everyone in it. Each socket gets a
// payload masked for its own identity (own hand only, in-flight card hidden
// unless that viewer may see it). Unidentified sockets get the spectator view,
// and multiple sockets per user are handled automatically.
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

// ===== Temp-mod "no mods online" timers (per room) =====
const noModTimers = new Map(); // roomCode -> timeout handle

const clearNoModTimer = (roomCode) => {
  const t = noModTimers.get(roomCode);
  if (t) {
    clearTimeout(t);
    noModTimers.delete(roomCode);
  }
};

// Recompute mod presence for a room and manage the temp-mod lifecycle:
// - If a real mod is online: revoke any temp mods and cancel the timer.
// - If no real mod is online: start a timer that promotes a temp mod on expiry.
const evaluateMods = (roomCode) => {
  const gameRoom = gameRoomService.getGameRoom(roomCode);
  if (!gameRoom) {
    clearNoModTimer(roomCode);
    return;
  }

  if (gameRoomService.anyRealModOnline(roomCode)) {
    clearNoModTimer(roomCode);
    const changed = gameRoomService.revokeTempMods(roomCode);
    if (changed) {
      gameRoomService.saveGameRoom(roomCode);
      broadcastGameRoom(roomCode);
    }
    return;
  }

  // No real mod online. If a temp mod already holds power, nothing to do.
  const hasTempMod = gameRoom.players.some(
    (p) => p.online && p.role === Roles.TEMP_MOD
  );
  if (hasTempMod) {
    clearNoModTimer(roomCode);
    return;
  }

  // Otherwise arm the timer (once) to promote a temp mod after the timeout.
  if (!noModTimers.has(roomCode)) {
    const handle = setTimeout(() => {
      noModTimers.delete(roomCode);
      const chosen = gameRoomService.promoteTempMod(roomCode);
      if (chosen) {
        gameRoomService.saveGameRoom(roomCode);
        broadcastGameRoom(roomCode);
      }
    }, NO_MODS_TIMEOUT_MS);
    noModTimers.set(roomCode, handle);
  }
};

io.on('connection', (socket) => {
  console.log(`Socket ${socket.id} connected.`);

  // Tracks which (room, user) this socket is present in, for disconnect.
  socket.data.rooms = new Set();

  const sendGameRoomToEveryoneInRoom = (roomCode) => {
    broadcastGameRoom(roomCode);
  };

  // identify: resolve/create the user behind this device's auth token and
  // remember the chosen display name. The token never leaves the client except
  // to this handler; everything else references the derived userId.
  socket.on('identify', async (token, name) => {
    try {
      let authToken = token;
      if (!authToken) authToken = newAuthToken();
      const userId = tokenToUserId(authToken);
      await upsertUser({ userId, token: authToken, name });
      socket.data.userId = userId;
      socket.data.authToken = authToken;
      const user = await findUserById(userId);
      socket.emit('identity', {
        userId,
        name: user?.name || name || null,
        // Echo back a token if we minted one for a tokenless client.
        token: token ? undefined : authToken,
      });
    } catch (err) {
      console.error('identify error:', err);
    }
  });

  const sendNewRoundInfoToEveryoneInRoom = (roomCode) => {
    const gameRoom = gameRoomService.getGameRoom(roomCode);
    const loserId = gameRoom.currentAction.turnPlayer;
    const loser = gameRoomService.getPlayerByUUID(roomCode, loserId);
    io.to(GAME_ROOM_PREFIX + roomCode).emit(
      'returnNewRound',
      loserId,
      loser.nickname
    );
  };

  const endGameIfLossCondition = (roomCode) => {
    const gameOver = gameRoomService.endGameIfLossCondition(roomCode);
    if (gameOver) {
      io.to(GAME_ROOM_PREFIX + roomCode).emit('returnGameOver', gameOver);
    }
  };

  // requestGameRoom: request for GameRoom data from a host
  socket.on('requestGameRoom', async (roomCode) => {
    console.log(`Socket ${socket.id} requested GameRoom info for ${roomCode}`);
    socket.emit(
      'returnGameRoom',
      gameRoomService.publicGameRoomFor(roomCode, socket.data.userId)
    );
  });

  // requestCreateEmptyGameRoom: create an empty GameRoom. The requesting user
  // becomes the room creator/owner once they join as a player.
  socket.on('requestCreateEmptyGameRoom', async () => {
    console.log(`Socket ${socket.id} requested to create an empty GameRoom`);
    const gameRoom = gameRoomService.createEmptyGameRoom();
    // Pre-assign the creator so the first joiner is guaranteed to be owner even
    // if they are momentarily beaten to it; the actual creator player record is
    // created on join.
    if (socket.data.userId) {
      gameRoom.creatorUserId = socket.data.userId;
    }
    socket.emit(
      'returnEmptyGameRoom',
      gameRoomService.publicGameRoomFor(gameRoom.roomCode, socket.data.userId)
    );
  });

  socket.on('requestStartGame', async (roomCode) => {
    console.log(`Socket ${socket.id} requested to start game ${roomCode}`);
    // Only a user with mod powers (creator/mod/temp mod) may start the game.
    const actor = gameRoomService.getPlayerByUserId(
      roomCode,
      socket.data.userId
    );
    if (!gameRoomService.hasModPower(actor)) {
      socket.emit('actionError', 'Only a mod can start the game');
      return;
    }
    try {
      gameRoomService.startGame(roomCode);
    } catch (err) {
      console.error('startGame error:', err);
      socket.emit('actionError', err.message || 'Could not start the game');
      return;
    }
    gameRoomService.saveGameRoom(roomCode);
    console.log(`Emitting returnStartGame for room ${roomCode}`);
    socket.emit('returnStartGame', roomCode);
    sendGameRoomToEveryoneInRoom(roomCode);
  });

  // requestJoinPlayerToRoom: join (or rejoin) a room under the caller's
  // identity. No client-supplied uuid: the server derives it from the
  // authenticated userId, so refresh/reconnect never duplicates a player.
  socket.on(
    'requestJoinPlayerToRoom',
    async (roomCode, nickname, playerIcon) => {
      const userId = socket.data.userId;
      const gameRoom = gameRoomService.getGameRoom(roomCode);
      const existing = userId
        ? gameRoomService.getPlayerByUserId(roomCode, userId)
        : null;

      // Allow joining during SETUP, or rejoining at any time if already a member.
      const canJoin =
        gameRoom &&
        userId &&
        (nickname || '').length <= 16 &&
        (existing ||
          (gameRoom.gameStatus === GameStatus.SETUP &&
            gameRoom.numPlayers <= 6));

      if (!canJoin) {
        socket.emit('returnJoinPlayerToRoom', false, null, null);
        return;
      }

      const player = gameRoomService.joinOrGetPlayer(
        roomCode,
        userId,
        nickname,
        playerIcon,
        socket.id
      );
      socket.join(GAME_ROOM_PREFIX + roomCode);
      socket.data.rooms.add(roomCode);
      gameRoomService.saveGameRoom(roomCode);

      socket.emit('returnJoinPlayerToRoom', true, roomCode, player.uuid);
      evaluateMods(roomCode);
      broadcastGameRoom(roomCode);
    }
  );

  // joinWithMigrate: adopt the identity referenced by a room-scoped migrate id.
  // Binds this device's auth token to that room player's userId, then joins.
  socket.on('joinWithMigrate', async (roomCode, migrateId) => {
    const targetUserId = gameRoomService.resolveMigrate(roomCode, migrateId);
    if (!targetUserId) {
      socket.emit('returnJoinPlayerToRoom', false, null, null);
      return;
    }
    // This device now acts as targetUserId for this session. Rebind the token
    // record so the migrated identity sticks to this device too.
    socket.data.userId = targetUserId;
    if (socket.data.authToken) {
      await upsertUser({ userId: targetUserId, token: socket.data.authToken });
    }
    const player = gameRoomService.joinOrGetPlayer(
      roomCode,
      targetUserId,
      null,
      null,
      socket.id
    );
    socket.join(GAME_ROOM_PREFIX + roomCode);
    socket.data.rooms.add(roomCode);
    gameRoomService.saveGameRoom(roomCode);
    socket.emit('returnJoinPlayerToRoom', true, roomCode, player.uuid);
    socket.emit('identity', { userId: targetUserId, name: player.nickname });
    evaluateMods(roomCode);
    broadcastGameRoom(roomCode);
  });

  // checkJoinCode: checks if the room exists for a roomCode, from player
  socket.on('checkJoinCode', async (roomCode) => {
    console.log(`Socket ${socket.id} requested GameRoom info for ${roomCode}`);
    //roomExists is a boolean
    let roomExists = false;

    const gameRoom = gameRoomService.getGameRoom(roomCode);

    if (gameRoom == undefined) {
      console.log('Game Code is false');
      roomExists = false;
    } else {
      roomExists = true;
    }
    socket.emit('receiveJoinCode', roomExists);
  });

  // joinSocketRoom: subscribe this socket to a room's broadcasts. If the socket
  // has an identity that is a player in the room, mark them online.
  socket.on('joinSocketRoom', async (roomCode) => {
    socket.join(GAME_ROOM_PREFIX + roomCode);
    socket.data.rooms.add(roomCode);
    console.log(
      `Socket ${socket.id} joined room ${GAME_ROOM_PREFIX + roomCode}`
    );
    if (socket.data.userId) {
      const player = gameRoomService.setOnlineByUserId(
        roomCode,
        socket.data.userId,
        true
      );
      if (player) {
        gameRoomService.saveGameRoom(roomCode);
        evaluateMods(roomCode);
      }
    }
    broadcastGameRoom(roomCode);
  });

  // requestSetRole: promote/demote a player (authorization enforced server-side)
  socket.on('requestSetRole', (roomCode, targetUserId, newRole) => {
    const res = gameRoomService.setRole(
      roomCode,
      socket.data.userId,
      targetUserId,
      newRole
    );
    if (res.ok) {
      gameRoomService.saveGameRoom(roomCode);
      evaluateMods(roomCode);
      broadcastGameRoom(roomCode);
    } else {
      socket.emit('actionError', res.error);
    }
  });

  // requestSetObserver: move a player to/from observer (self or mod)
  socket.on('requestSetObserver', (roomCode, targetUserId, observe) => {
    const res = gameRoomService.setObserver(
      roomCode,
      socket.data.userId,
      targetUserId,
      observe
    );
    if (res.ok) {
      gameRoomService.saveGameRoom(roomCode);
      broadcastGameRoom(roomCode);
    } else {
      socket.emit('actionError', res.error);
    }
  });

  // requestMigrateLink: get a room-scoped migrate id for a target player.
  // Allowed for self, or for any user with mod powers.
  socket.on('requestMigrateLink', (roomCode, targetUserId) => {
    const actor = gameRoomService.getPlayerByUserId(
      roomCode,
      socket.data.userId
    );
    const isSelf = socket.data.userId === targetUserId;
    if (!isSelf && !gameRoomService.hasModPower(actor)) {
      socket.emit('actionError', 'Not authorized');
      return;
    }
    const target = gameRoomService.getPlayerByUserId(roomCode, targetUserId);
    if (!target) {
      socket.emit('actionError', 'Player not found');
      return;
    }
    const migrateId = gameRoomService.getMigrateIdFor(roomCode, targetUserId);
    socket.emit('returnMigrateLink', {
      roomCode,
      targetUserId,
      migrateId,
      displayName: gameRoomService.displayName(target),
    });
  });

  // selectAvatar: update avatar in memory (no DB call)
  socket.on('selectAvatar', ({ playerId, avatar }) => {
    try {
      const roomCode = gameRoomService.getRoomCodeByPlayerUUID(playerId);
      if (!roomCode) {
        console.warn(`No room found for player UUID: ${playerId}`);
        return;
      }

      const gameRoom = gameRoomService.getGameRoom(roomCode);
      const player = gameRoom.players.find((p) => p.uuid === playerId);

      if (!player) {
        console.warn(
          `Player with UUID ${playerId} not found in GameRoom ${roomCode}`
        );
        return;
      }

      player.playerIcon = avatar;
      console.log(`Avatar updated for ${player.nickname}: ${avatar}`);

      socket.emit('avatarUpdated', { success: true, avatar });
    } catch (error) {
      console.error('Error: Could not update avatar in memory:', error);
      socket.emit('avatarUpdated', {
        success: false,
        message: 'Failed to update avatar',
      });
    }
  });

  // getPlayer: returns a player by roomCode and uuid
  socket.on('getPlayer', (roomCode, uuid) => {
    try {
      // Use gameRoomService to get the game room
      const gameRoom = gameRoomService.getGameRoom(roomCode);

      if (!gameRoom) {
        console.warn(`No game room found for room code: ${roomCode}`);
        socket.emit('returnPlayer', null);
        return;
      }

      // Find the player in the game room
      const player = gameRoom.players.find((p) => p.uuid === uuid);

      if (player) {
        console.log(`Player found: ${player.nickname}`);
        socket.emit('returnPlayer', player);
      } else {
        console.warn(`No player found with UUID: ${uuid} in room: ${roomCode}`);
        socket.emit('returnPlayer', null);
      }
    } catch (error) {
      console.error('Error in getPlayer:', error);
      socket.emit('returnPlayer', null);
    }
  });

  // setSocketId: sets a player by roomCode and uuid's socket to socketId
  socket.on('setSocketId', (roomCode, uuid, socketId) => {
    // Use gameRoomService to check if the gameRoom is real
    console.log(`Socket ID: ${socketId}`);
    const gameRoom = gameRoomService.getGameRoom(roomCode);
    if (!gameRoom) {
      console.warn(`No game room found for room code: ${roomCode}`);
      return;
    }

    //calls setPlayerSocketId in gameRoomService
    const player = gameRoomService.setPlayerSocketId(roomCode, uuid, socketId);
    if (!player) {
      console.warn(
        `setPlayerSocketId(): Player with UUID ${uuid} not found in room ${roomCode}.`
      );
    }
  });

  // requestPlayerStartRound: player starts a round by sending a card to someone.
  socket.on(
    'requestPlayerStartRound',
    (roomCode, fromPlayer, toPlayer, card, claim) => {
      console.log(
        `[${roomCode}] Player ${fromPlayer} requests send card ${card} and claim ${claim} to ${toPlayer}`
      );
      if (!roomCode) {
        console.warn(`Error: requestPlayerStartRound: No room code provided`);
        return;
      }
      const gameRoom = gameRoomService.getGameRoom(roomCode);
      if (!gameRoom) {
        console.warn(
          `Error: requestPlayerStartRound: Game room ${roomCode} not found`
        );
        return;
      }

      const success = gameRoomService.startRound(
        roomCode,
        fromPlayer,
        toPlayer,
        card,
        claim
      );

      if (success) {
        sendGameRoomToEveryoneInRoom(roomCode);
      } else {
        console.warn('gameRoomService.startRound() failed');
      }
    }
  );

  // requestPlayerPassCard: player looks at the current card and passes it to someone else with a claim.
  socket.on(
    'requestPlayerPassCard',
    (roomCode, fromPlayer, toPlayer, claim) => {
      console.log(
        `[${roomCode}] Player ${fromPlayer} requests pass current card with claim ${claim} to ${toPlayer}`
      );
      if (!roomCode) {
        console.warn(`Error: requestPlayerPassCard: No room code provided`);
        return;
      }
      const gameRoom = gameRoomService.getGameRoom(roomCode);
      if (!gameRoom) {
        console.warn(
          `Error: requestPlayerPassCard: Game room ${roomCode} not found`
        );
        return;
      }

      const success = gameRoomService.passCard(
        roomCode,
        fromPlayer,
        toPlayer,
        claim
      );

      if (success) {
        sendGameRoomToEveryoneInRoom(roomCode);
      } else {
        console.warn('gameRoomService.passCard() failed');
      }
    }
  );

  // requestPlayerCallCard: player calls a claim as true or false.
  socket.on('requestPlayerCallCard', (roomCode, fromPlayer, callAs) => {
    console.log(
      `[${roomCode}] Player ${fromPlayer} requests call current card with callAs ${callAs}`
    );
    if (!roomCode) {
      console.warn(`Error: requestPlayerCallCard: No room code provided`);
      return;
    }
    const gameRoom = gameRoomService.getGameRoom(roomCode);
    if (!gameRoom) {
      console.warn(
        `Error: requestPlayerCallCard: Game room ${roomCode} not found`
      );
      return;
    }
    const prevPlayer = gameRoom.currentAction?.prevPlayer;

    const success = gameRoomService.callCard(roomCode, fromPlayer, callAs);

    if (success) {
      sendGameRoomToEveryoneInRoom(roomCode);
      sendNewRoundInfoToEveryoneInRoom(roomCode);
      endGameIfLossCondition(roomCode);
    } else {
      console.warn('gameRoomService.callCard() failed');
    }
  });

  // On disconnect, mark this identity offline in every room it was present in,
  // then re-evaluate mod presence (may arm the temp-mod timer).
  socket.on('disconnect', () => {
    console.log(`Socket ${socket.id} disconnected.`);
    const userId = socket.data.userId;
    if (!userId) return;
    for (const roomCode of socket.data.rooms) {
      // Only flip offline if no other socket for this user is still in the room.
      const stillConnected = anyOtherSocketForUserInRoom(
        roomCode,
        userId,
        socket.id
      );
      if (stillConnected) continue;
      const player = gameRoomService.setOnlineByUserId(roomCode, userId, false);
      if (player) {
        gameRoomService.saveGameRoom(roomCode);
        evaluateMods(roomCode);
        broadcastGameRoom(roomCode);
      }
    }
  });
});

// True if some socket OTHER than excludeId belongs to userId and is in the room.
function anyOtherSocketForUserInRoom(roomCode, userId, excludeId) {
  const room = io.sockets.adapter.rooms.get(GAME_ROOM_PREFIX + roomCode);
  if (!room) return false;
  for (const sid of room) {
    if (sid === excludeId) continue;
    const s = io.sockets.sockets.get(sid);
    if (s && s.data && s.data.userId === userId) return true;
  }
  return false;
}
// Wait for the database to be ready before accepting connections.
dbReady.then(() => {
  server.listen(PORT, () => {
    console.log(`Server is running on ${BASE_URL}`);
  });
});
