// GameAction model for lowdb
// GameAction is embedded in GameRoom, so this is just a schema definition

export const GameActionSchema = {
  turnPlayer: String, // UUID of current turn player
  prevPlayer: String, // UUID of previous player
  conspiracy: Array, // Array of UUIDs who have seen the card
  card: Number, // Current card in play
  claim: Number, // Claimed card type
};

export const createGameAction = (data) => {
  return {
    turnPlayer: data.turnPlayer || null,
    prevPlayer: data.prevPlayer || null,
    conspiracy: data.conspiracy || [],
    card: data.card || null,
    claim: data.claim || null,
  };
};

// For compatibility
class GameAction {
  constructor(data) {
    Object.assign(this, createGameAction(data));
  }
}

export default GameAction;
