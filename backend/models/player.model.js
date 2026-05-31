// Player model for lowdb
// Players are embedded in GameRoom, so this is just a schema definition

export const PlayerSchema = {
  uuid: String,
  nickname: String,
  playerIcon: String,
  socketId: String,
  hand: Array, // Array of card numbers
  handSize: Number,
  pile: Array, // Array of card numbers (face-up)
  pileSize: Number,
};

export const createPlayer = (data) => {
  return {
    uuid: data.uuid,
    nickname: data.nickname,
    playerIcon: data.playerIcon || 'default',
    socketId: data.socketId || null,
    hand: data.hand || [],
    handSize: data.handSize || 0,
    pile: data.pile || [],
    pileSize: data.pileSize || 0,
  };
};

// For compatibility with existing code
class Player {
  constructor(data) {
    Object.assign(this, createPlayer(data));
  }
}

export default Player;
