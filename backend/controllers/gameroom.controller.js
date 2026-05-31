import GameRoom from '../models/gameroom.model.js';

export const getGameRoom = async (req, res) => {
  const { id } = req.params;
  try {
    const gameRoom = await GameRoom.findById(id);
    res.status(200).json({ success: true, data: gameRoom });
  } catch (error) {
    console.error(`Error in fetching GameRoom: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching GameRoom',
    });
  }
};

export const getGameRooms = async (req, res) => {
  try {
    const gameRooms = await GameRoom.find({});
    res.status(200).json({ success: true, data: gameRooms });
  } catch (error) {
    console.error(`Error in fetching gameRooms: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching gameRooms',
    });
  }
};

export const createGameRoom = async (req, res) => {
  const gameRoom = req.body; // user request body

  if (!gameRoom.roomCode) {
    return res
      .status(400)
      .json({ success: false, message: 'Please provide all GameRoom fields' });
  }

  const newGameRoom = new GameRoom(gameRoom);

  try {
    await newGameRoom.save();
    res.status(201).json({ success: true, data: newGameRoom });
  } catch (error) {
    console.error(`Error while creating gameRoom: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Server error while creating gameRoom',
    });
  }
};

export const updateGameRoom = async (req, res) => {
  const { id } = req.params;

  const reqGameRoom = req.body;

  try {
    const gameRoom = await GameRoom.findById(id);
    if (!gameRoom) {
      return res
        .status(404)
        .json({ success: false, message: 'Error: GameRoom not found' });
    }

    Object.assign(gameRoom, reqGameRoom);
    await gameRoom.save();

    res.status(200).json({ success: true, data: gameRoom });
  } catch (error) {
    console.error(`Error while updating gameRoom: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Server error while updating gameRoom',
    });
  }
};

export const deleteGameRoom = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await GameRoom.deleteOne({ _id: id });
    if (result.deletedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: 'Error: GameRoom not found' });
    }
    res.status(200).json({ success: true, message: 'GameRoom deleted' });
  } catch (error) {
    console.error(`Error while deleting gameRoom: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting gameRoom',
    });
  }
};
