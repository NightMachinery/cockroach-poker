// Player model for lowdb
// Players are embedded in GameRoom, so this is just a schema definition

export const PlayerSchema = {
  uuid: String,
  userId: String, // stable identity behind this player
  nickname: String,
  playerIcon: String,
  socketId: String,
  hand: Array, // Array of card numbers
  handSize: Number,
  pile: Array, // Array of card numbers (face-up)
  pileSize: Number,
  role: String, // see Roles constant
  promotedBy: String, // userId of whoever promoted this player to mod
  everTempMod: Boolean, // has ever been a temp mod (designation persists)
  online: Boolean, // presence
  nameNumber: Number, // stable disambiguation suffix (0 = none)
  prevRole: String, // role to restore when leaving observer
};

export const createPlayer = (data) => {
  return {
    uuid: data.uuid,
    userId: data.userId || null,
    nickname: data.nickname,
    playerIcon: data.playerIcon || 'default',
    socketId: data.socketId || null,
    hand: data.hand || [],
    handSize: data.handSize || 0,
    pile: data.pile || [],
    pileSize: data.pileSize || 0,
    role: data.role || 'player',
    promotedBy: data.promotedBy || null,
    everTempMod: data.everTempMod || false,
    online: data.online !== undefined ? data.online : true,
    nameNumber: data.nameNumber || 0,
    prevRole: data.prevRole || null,
  };
};

// For compatibility with existing code
class Player {
  constructor(data) {
    Object.assign(this, createPlayer(data));
  }
}

export default Player;
