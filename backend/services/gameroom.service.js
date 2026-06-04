import GameRoom from '../models/gameroom.model.js';
import Player from '../models/player.model.js';
import {
  CardNumberToString,
  GameStatus,
  Roles,
  REAL_MOD_ROLES,
  MOD_POWER_ROLES,
} from '../utilities/constants.js';
import { derivePlayerUuid, roomMigrateId } from '../utilities/identity.js';
import { v4 as uuidv4 } from 'uuid';

// Manages GameRoom instances for you.
export class GameRoomService {
  // Maps roomCode => gameRoom
  gameRoomMap = new Map();

  // Initializes gameRoomMap from the database.
  async initializeGameRoomMap() {
    // Get all active gameRooms (such that status is not ENDED)
    const gameRooms = await GameRoom.find({
      gameStatus: { $ne: GameStatus.ENDED },
    });

    for (const gameRoom of gameRooms) {
      this.gameRoomMap.set(gameRoom.roomCode, gameRoom);
    }

    //console.log('gameRoomMap initialized:', this.gameRoomMap);
  }

  // Get GameRoom by roomCode.
  // This returns by reference, meaning if you modify
  // the gameRoom elsewhere, it will modify it in gameRoomMap.
  getGameRoom(roomCode) {
    return this.gameRoomMap.get(roomCode);
  }

  // Returns a player by UUID.
  getPlayerByUUID(roomCode, uuid) {
    const gameRoom = this.gameRoomMap.get(roomCode);
    if (!gameRoom) return null;
    for (let player of gameRoom.players) {
      if (player.uuid == uuid) return player;
    }
    return null;
  }

  // Update GameRoom contents.
  updateGameRoom(roomCode, gameRoom) {
    this.gameRoomMap.set(roomCode, gameRoom);
  }

  // Update GameRoom contents and save to database (expensive).
  async updateGameRoomAndSave(roomCode, gameRoom) {
    this.gameRoomMap.set(roomCode, gameRoom);
    gameRoom.save();
  }

  // Create an empty GameRoom.
  // Returns the generated room.
  createEmptyGameRoom() {
    const roomCode = this.generateValidRoomCode();

    const gameRoomBody = {
      roomCode: roomCode,
      numPlayers: 0,
      gameStatus: GameStatus.SETUP,
      players: [],
      currentAction: null,
    };

    const gameRoom = new GameRoom(gameRoomBody);

    this.gameRoomMap.set(roomCode, gameRoom);

    return gameRoom;
  }

  // Create an empty GameRoom with a specific code.
  createEmptyGameRoomWithCode(roomCode) {
    if (this.gameRoomMap.has(roomCode)) {
      throw new Error(
        `createEmptyGameRoom(): An active room with code ${roomCode} already exists.`
      );
    }

    const gameRoomBody = {
      roomCode: roomCode,
      numPlayers: 0,
      gameStatus: GameStatus.SETUP,
      players: [],
      currentAction: null,
    };

    const gameRoom = new GameRoom(gameRoomBody);

    this.gameRoomMap.set(roomCode, gameRoom);

    return gameRoom;
  }

  // Identity-aware join. Returns the player (existing or newly created).
  // A given userId maps to exactly one player per room, so rejoining (refresh,
  // reconnect, device migration) never creates a duplicate.
  joinOrGetPlayer(roomCode, userId, nickname, playerIcon, socketId) {
    const gameRoom = this.gameRoomMap.get(roomCode);
    if (!gameRoom) {
      throw new Error(`joinOrGetPlayer(): GameRoom ${roomCode} not found.`);
    }

    // Existing player for this identity? Update mutable bits and return.
    const existing = gameRoom.players.find((p) => p.userId === userId);
    if (existing) {
      if (nickname) existing.nickname = nickname;
      if (playerIcon) existing.playerIcon = playerIcon;
      if (socketId) existing.socketId = socketId;
      existing.online = true;
      return existing;
    }

    // The creator/owner is either the pre-assigned creatorUserId (set when the
    // room was created) or, failing that, the first user to arrive.
    const isCreator = gameRoom.creatorUserId
      ? gameRoom.creatorUserId === userId
      : true;
    const role = isCreator ? Roles.CREATOR : Roles.PLAYER;

    const player = new Player({
      uuid: derivePlayerUuid(roomCode, userId),
      userId,
      nickname,
      playerIcon,
      socketId,
      hand: [],
      handSize: 0,
      pile: [],
      pileSize: 0,
      role,
      promotedBy: null,
      everTempMod: false,
      online: true,
      nameNumber: 0,
    });

    // Stable per-room name disambiguation number (assigned once, never reused).
    player.nameNumber = this._assignNameNumber(gameRoom, nickname);

    gameRoom.players.push(player);
    gameRoom.numPlayers++;

    if (isCreator) gameRoom.creatorUserId = userId;

    // Register a room-scoped migrate id for this identity.
    gameRoom.migrateMap[roomMigrateId(roomCode, userId)] = userId;

    return player;
  }

  // Assign a stable trailing number for duplicate display names within a room.
  // The first holder of a name gets 0 (no suffix); each subsequent distinct
  // identity gets the next integer. Numbers are never reused, so they remain
  // stable even when earlier players leave.
  _assignNameNumber(gameRoom, nickname) {
    const key = (nickname || '').toLowerCase();
    const used = gameRoom.players
      .filter((p) => (p.nickname || '').toLowerCase() === key)
      .map((p) => p.nameNumber || 0);
    if (used.length === 0) return 0; // first holder, no suffix
    const next = (gameRoom.nameSeq[key] || 0) + 1;
    gameRoom.nameSeq[key] = next;
    return next;
  }

  // Start game.
  startGame(roomCode) {
    const gameRoom = this.gameRoomMap.get(roomCode);
    if (!gameRoom) {
      throw new Error(`startGame(): GameRoom ${roomCode} not found.`);
    }
    if (gameRoom.gameStatus === GameStatus.ONGOING) return;

    // Only active (non-observer) players are dealt cards and take turns.
    const activePlayers = gameRoom.players.filter(
      (p) => p.role !== Roles.OBSERVER
    );
    if (activePlayers.length === 0) {
      throw new Error(`startGame(): GameRoom ${roomCode} has no active players.`);
    }

    // Set game status to ONGOING
    gameRoom.gameStatus = GameStatus.ONGOING;

    // Create the deck (8 of each card type 1–8)
    const deck = [];
    const numCards = 64;
    for (let cardType = 1; cardType <= 8; cardType++) {
      for (let i = 0; i < 8; i++) {
        deck.push(cardType);
      }
    }

    // Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    // Deal cards evenly among active players.
    const cardsPerPlayer = Math.floor(numCards / activePlayers.length);

    // Observers hold no cards.
    gameRoom.players.forEach((player) => {
      player.hand = [];
      player.handSize = 0;
    });

    activePlayers.forEach((player, index) => {
      const start = index * cardsPerPlayer;
      const end = start + cardsPerPlayer;
      player.hand = deck.slice(start, end);
      player.handSize = player.hand.length;
    });

    // Pick a random active player to start. The first action uses the same
    // player for turnPlayer and prevPlayer to mark the start-of-round state.
    const startingPlayer =
      activePlayers[Math.floor(Math.random() * activePlayers.length)];
    gameRoom.currentAction = {
      turnPlayer: startingPlayer.uuid,
      prevPlayer: startingPlayer.uuid,
      conspiracy: [],
      card: -1,
      claim: -1,
    };
  }

  // Starts a round of play.
  startRound(roomCode, fromPlayer, toPlayer, card, claim) {
    const gameRoom = this.gameRoomMap.get(roomCode);
    const currentAction = gameRoom.currentAction;

    // Make sure fromPlayer is the first player in a round
    if (
      fromPlayer != currentAction.turnPlayer ||
      currentAction.turnPlayer != currentAction.prevPlayer
    ) {
      console.warn(
        `Error: startRound: Only the turnPlayer at the start of a round can start a round`
      );
      return false;
    }

    // Remove the card from fromPlayer hand
    this.removeCardFromHand(roomCode, fromPlayer, card);

    // Update currentAction
    gameRoom.currentAction = {
      turnPlayer: toPlayer,
      prevPlayer: fromPlayer,
      conspiracy: [fromPlayer],
      card: card,
      claim: claim,
    };

    // Return (send this update to everyone)
    return true;
  }

  // Player looks at the current card and passes it to someone else.
  passCard(roomCode, fromPlayer, toPlayer, claim) {
    const gameRoom = this.gameRoomMap.get(roomCode);
    const currentAction = gameRoom.currentAction;

    // Make sure fromPlayer is the turn player
    if (fromPlayer != currentAction.turnPlayer) {
      console.warn(`Error: passCard: Only the turnPlayer can pass a card.`);
      return false;
    }

    // Make sure toPlayer has not seen the card
    if (currentAction.conspiracy.includes(toPlayer)) {
      console.warn(
        `Error: passCard: Can't pass a card to someone in conspiracy.`
      );
      return false;
    }

    // Pass card
    gameRoom.currentAction = {
      turnPlayer: toPlayer,
      prevPlayer: fromPlayer,
      conspiracy: [...currentAction.conspiracy, fromPlayer],
      card: currentAction.card,
      claim: claim,
    };

    return true;
  }

  // Player calls the current card as true or false.
  callCard(roomCode, fromPlayer, callAs) {
    const gameRoom = this.gameRoomMap.get(roomCode);
    const currentAction = gameRoom.currentAction;

    // Make sure playerId is the turn player
    if (fromPlayer != currentAction.turnPlayer) {
      console.warn(`Error: callCard: Only the turnPlayer can call a card.`);
      return false;
    }

    // Whether the previous player's claim was true or false
    const reality = currentAction.card === currentAction.claim;

    // Determine who lost the round
    const loser =
      callAs === reality ? currentAction.prevPlayer : currentAction.turnPlayer;

    // Add the card to the loser's pile
    this.addCardToPile(roomCode, loser, currentAction.card);

    // Update currentAction to start a new round
    gameRoom.currentAction = {
      turnPlayer: loser,
      prevPlayer: loser,
      conspiracy: [],
      card: 0,
      claim: 0,
    };

    return true;
  }

  // Check loss condition and end the game if player lost.
  endGameIfLossCondition(roomCode) {
    const gameRoom = this.gameRoomMap.get(roomCode);
    if (!gameRoom) return false;

    const players = gameRoom.players;

    for (const player of players) {
      const pile = player.pile;
      const hand = player.hand;

      // Secondary Loss Condition
      if (hand.length === 0) {
        this.terminateGameRoomAndSave(roomCode);
        return player.uuid;
      }

      let freq = Array.from({ length: 9 }, () => 0);
      for (const card of pile) {
        freq[card]++;
      }
      for (const num of freq) {
        // Primary Loss Condition
        if (num >= 4) {
          this.terminateGameRoomAndSave(roomCode);
          return player.uuid;
        }
      }
    }
    return false;
  }

  // Save GameRoom contents to database.
  async saveGameRoom(roomCode) {
    const gameRoom = this.gameRoomMap.get(roomCode);
    gameRoom.save();
  }

  // Saves all GameRooms to the database. (EXPENSIVE, use sparingly)
  async saveAll() {
    this.gameRoomMap.forEach((roomCode, gameRoom) => {
      gameRoom.save();
    });
  }

  // Used to end a game.
  // Will update the game status and remove it from the map.
  async terminateGameRoomAndSave(roomCode) {
    const gameRoom = this.gameRoomMap.get(roomCode);

    gameRoom.gameStatus = GameStatus.ENDED;

    gameRoom.save();

    this.gameRoomMap.delete(roomCode);
  }

  // Add a card of a certain type to a player's pile
  addCardToPile(roomCode, playerId, card) {
    const player = this.getPlayerByUUID(roomCode, playerId);

    let pile = player.pile;

    pile.push(card);

    player.pileSize++;
  }

  // Remove card of a certain type from player's hand
  removeCardFromHand(roomCode, playerId, card) {
    const player = this.getPlayerByUUID(roomCode, playerId);

    let hand = player.hand;

    const index = hand.indexOf(card);
    if (index > -1) {
      hand.splice(index, 1);
    } else {
      console.warn('Error: removeCardFromHand: no such card in hand.');
      return;
    }

    player.handSize--;
  }

  // Generates a roomCode that is not used by any other room.
  generateValidRoomCode() {
    const characters = 'ABDEFGHJKLMNPQRSTUWXY123456789';
    let roomCode = '';
    do {
      for (let i = 0; i < 4; i++) {
        roomCode += characters.charAt(Math.floor(Math.random() * 30));
      }
    } while (this.gameRoomMap.has(roomCode));

    return roomCode;
  }

  // Returns roomCode that the player is in by UUID.
  getRoomCodeByPlayerUUID(uuid) {
    for (const [roomCode, gameRoom] of this.gameRoomMap.entries()) {
      if (gameRoom.players.some((p) => p.uuid === uuid)) {
        return roomCode;
      }
    }
    return null;
  }
  // Set a player's socketId to a value, based on UUID, should be run every time a player connects, returns player for verification
  setPlayerSocketId(roomCode, uuid, socketId) {
    const gameRoom = this.gameRoomMap.get(roomCode);
    if (!gameRoom) {
      throw new Error(`setPlayerSocketId(): GameRoom ${roomCode} not found.`);
    }

    // Find the player within the room
    const player = gameRoom.players.find((p) => p.uuid === uuid);
    if (!player) {
      throw new Error(
        `setPlayerSocketId(): Player with UUID ${uuid} not found in room ${roomCode}.`
      );
    }

    player.socketId = socketId;
    return player;
  }

  // ===== Identity / roles / presence / observers / migration =====

  getPlayerByUserId(roomCode, userId) {
    const gameRoom = this.gameRoomMap.get(roomCode);
    if (!gameRoom) return null;
    return gameRoom.players.find((p) => p.userId === userId) || null;
  }

  // Display name with stable per-room disambiguation suffix.
  displayName(player) {
    if (!player) return 'Unknown';
    return player.nameNumber
      ? `${player.nickname} ${player.nameNumber}`
      : player.nickname;
  }

  hasModPower(player) {
    return !!player && MOD_POWER_ROLES.includes(player.role);
  }

  isRealMod(player) {
    return !!player && REAL_MOD_ROLES.includes(player.role);
  }

  // Mark a player online/offline by userId. Returns the player (or null).
  setOnlineByUserId(roomCode, userId, online) {
    const player = this.getPlayerByUserId(roomCode, userId);
    if (player) player.online = online;
    return player;
  }

  // True if at least one real mod (creator/mod) is currently online.
  anyRealModOnline(roomCode) {
    const gameRoom = this.gameRoomMap.get(roomCode);
    if (!gameRoom) return false;
    return gameRoom.players.some((p) => p.online && this.isRealMod(p));
  }

  // Change a target's role, enforcing authorization. Returns {ok, error}.
  // newRole is one of Roles.MOD / Roles.PLAYER (promote/demote to/from mod).
  setRole(roomCode, actorUserId, targetUserId, newRole) {
    const gameRoom = this.gameRoomMap.get(roomCode);
    if (!gameRoom) return { ok: false, error: 'Room not found' };

    const actor = this.getPlayerByUserId(roomCode, actorUserId);
    const target = this.getPlayerByUserId(roomCode, targetUserId);
    if (!actor || !target) return { ok: false, error: 'Player not found' };
    if (!this.hasModPower(actor)) return { ok: false, error: 'Not authorized' };

    // The creator role is immutable and never transfers.
    if (target.role === Roles.CREATOR)
      return { ok: false, error: 'Cannot change the owner' };
    if (newRole === Roles.CREATOR)
      return { ok: false, error: 'Cannot assign owner' };

    const actorIsCreator = actor.role === Roles.CREATOR;

    if (newRole === Roles.MOD) {
      // Promote to mod. Mods promoted by a temp mod (or by anyone while the
      // promoter is temp) are themselves temp mods.
      const promotedRole =
        actor.role === Roles.TEMP_MOD ? Roles.TEMP_MOD : Roles.MOD;
      // Don't clobber an existing real mod by re-promoting.
      if (this.isRealMod(target)) return { ok: false, error: 'Already a mod' };
      target.role = promotedRole;
      target.promotedBy = actorUserId;
      if (promotedRole === Roles.TEMP_MOD) target.everTempMod = true;
      return { ok: true };
    }

    if (newRole === Roles.PLAYER) {
      // Demote a mod. Creator may demote anyone; a mod may only demote someone
      // they themselves promoted.
      if (!MOD_POWER_ROLES.includes(target.role))
        return { ok: false, error: 'Target is not a mod' };
      if (!actorIsCreator && target.promotedBy !== actorUserId)
        return {
          ok: false,
          error: 'You can only demote mods you promoted',
        };
      target.role = Roles.PLAYER;
      target.promotedBy = null;
      return { ok: true };
    }

    return { ok: false, error: 'Unsupported role change' };
  }

  // Toggle observer status. Mods may set anyone; players may set themselves.
  setObserver(roomCode, actorUserId, targetUserId, observe) {
    const gameRoom = this.gameRoomMap.get(roomCode);
    if (!gameRoom) return { ok: false, error: 'Room not found' };

    const actor = this.getPlayerByUserId(roomCode, actorUserId);
    const target = this.getPlayerByUserId(roomCode, targetUserId);
    if (!actor || !target) return { ok: false, error: 'Player not found' };

    const isSelf = actorUserId === targetUserId;
    if (!isSelf && !this.hasModPower(actor))
      return { ok: false, error: 'Not authorized' };

    // The creator cannot be forced into observer by others.
    if (target.role === Roles.CREATOR && !isSelf)
      return { ok: false, error: 'Cannot change the owner' };

    if (observe) {
      // Remember the prior role so unobserving restores it (but never observer).
      if (target.role !== Roles.OBSERVER) {
        target.prevRole = target.role;
        target.role = Roles.OBSERVER;
      }
    } else {
      if (target.role === Roles.OBSERVER) {
        target.role = target.prevRole || Roles.PLAYER;
        target.prevRole = null;
      }
    }
    return { ok: true };
  }

  // Temp-mod management ----------------------------------------------------

  // Promote one online player to temp mod. Prefers a previously-designated
  // temp mod (everTempMod) over a random online non-observer.
  promoteTempMod(roomCode) {
    const gameRoom = this.gameRoomMap.get(roomCode);
    if (!gameRoom) return null;
    if (this.anyRealModOnline(roomCode)) return null; // not needed

    const candidates = gameRoom.players.filter(
      (p) => p.online && p.role !== Roles.OBSERVER && p.role !== Roles.TEMP_MOD
    );
    if (candidates.length === 0) return null;

    const prior = candidates.filter((p) => p.everTempMod);
    const pool = prior.length > 0 ? prior : candidates;
    const chosen = pool[Math.floor(Math.random() * pool.length)];

    chosen.role = Roles.TEMP_MOD;
    chosen.everTempMod = true;
    chosen.promotedBy = null;
    return chosen;
  }

  // Demote all temp mods back to player (keeps everTempMod). Called when a real
  // mod returns. Returns true if anything changed.
  revokeTempMods(roomCode) {
    const gameRoom = this.gameRoomMap.get(roomCode);
    if (!gameRoom) return false;
    let changed = false;
    for (const p of gameRoom.players) {
      if (p.role === Roles.TEMP_MOD) {
        p.role = Roles.PLAYER;
        p.promotedBy = null;
        changed = true;
      }
    }
    return changed;
  }

  // Migration --------------------------------------------------------------

  // The room-scoped migrate id for a given identity (safe to share in a link).
  getMigrateIdFor(roomCode, userId) {
    return roomMigrateId(roomCode, userId);
  }

  // Resolve a migrate id back to the userId that owns that room player.
  resolveMigrate(roomCode, migrateId) {
    const gameRoom = this.gameRoomMap.get(roomCode);
    if (!gameRoom) return null;
    return gameRoom.migrateMap?.[migrateId] || null;
  }

  // Sanitized room view safe to broadcast to clients. Strips server-only
  // secrets (migrate map, server secret) and adds display names. Each player's
  // own migrateId is NOT included here; it is fetched on demand by self/mods.
  publicGameRoom(roomCode) {
    const gameRoom = this.gameRoomMap.get(roomCode);
    if (!gameRoom) return null;
    return {
      _id: gameRoom._id,
      roomCode: gameRoom.roomCode,
      numPlayers: gameRoom.numPlayers,
      gameStatus: gameRoom.gameStatus,
      currentAction: gameRoom.currentAction,
      creatorUserId: gameRoom.creatorUserId,
      players: gameRoom.players.map((p) => ({
        uuid: p.uuid,
        userId: p.userId,
        nickname: p.nickname,
        displayName: this.displayName(p),
        nameNumber: p.nameNumber || 0,
        playerIcon: p.playerIcon,
        role: p.role,
        promotedBy: p.promotedBy || null,
        everTempMod: !!p.everTempMod,
        online: !!p.online,
        handSize: p.handSize,
        pileSize: p.pileSize,
        // hand/pile intentionally omitted from the shared room view; PlayPage
        // gets the player's own hand via returnPlayer / its own player entry.
        hand: p.hand,
        pile: p.pile,
      })),
    };
  }
}
