// GameRoom model for lowdb
// This replaces the Mongoose schema with a plain object structure

export const createGameRoom = (data) => {
  return {
    _id: data._id || generateId(),
    roomCode: data.roomCode,
    numPlayers: data.numPlayers,
    gameStatus: data.gameStatus,
    players: data.players || [],
    currentAction: data.currentAction || null,
    deck: data.deck || [],
    deckSize: data.deckSize || 0,
    // Identity/roles support:
    creatorUserId: data.creatorUserId || null, // immutable room owner
    migrateMap: data.migrateMap || {}, // roomMigrateId -> userId (server only)
    nameSeq: data.nameSeq || {}, // base nickname -> next disambiguation number
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: data.updatedAt || new Date().toISOString(),
  };
};

// Helper to generate unique IDs
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// GameRoom "class" with save method for compatibility
export class GameRoom {
  constructor(data) {
    Object.assign(this, createGameRoom(data));
  }

  async save() {
    const { getDB } = await import('../config/db.js');
    const db = getDB();

    this.updatedAt = new Date().toISOString();

    // Find and update or insert
    const index = db.data.gameRooms.findIndex(gr => gr._id === this._id);
    if (index >= 0) {
      db.data.gameRooms[index] = { ...this };
    } else {
      db.data.gameRooms.push({ ...this });
    }

    await db.write();
    return this;
  }

  static async find(query = {}) {
    const { getDB } = await import('../config/db.js');
    const db = getDB();
    await db.read();

    let results = db.data.gameRooms;

    // Simple query support
    if (query.gameStatus && query.gameStatus.$ne !== undefined) {
      results = results.filter(gr => gr.gameStatus !== query.gameStatus.$ne);
    }

    // Return GameRoom instances
    return results.map(data => new GameRoom(data));
  }

  static async findById(id) {
    const { getDB } = await import('../config/db.js');
    const db = getDB();
    await db.read();

    const data = db.data.gameRooms.find(gr => gr._id === id);
    return data ? new GameRoom(data) : null;
  }

  static async deleteOne(query) {
    const { getDB } = await import('../config/db.js');
    const db = getDB();
    await db.read();

    const index = db.data.gameRooms.findIndex(gr => {
      if (query._id) return gr._id === query._id;
      if (query.roomCode) return gr.roomCode === query.roomCode;
      return false;
    });

    if (index >= 0) {
      db.data.gameRooms.splice(index, 1);
      await db.write();
      return { deletedCount: 1 };
    }

    return { deletedCount: 0 };
  }
}

export default GameRoom;
