import { describe, expect, test, vi, afterEach } from 'vitest';
import { GameRoomService } from '../../../backend/services/gameroom.service.js';
import { GameStatus, Roles } from '../../../backend/utilities/constants.js';

const makePlayer = (uuid, role = Roles.PLAYER) => ({
  uuid,
  userId: `user-${uuid}`,
  nickname: uuid,
  role,
  hand: [],
  handSize: 0,
  pile: [],
  pileSize: 0,
});

const makeRoom = (players) => ({
  roomCode: 'TEST',
  numPlayers: players.length,
  gameStatus: GameStatus.SETUP,
  players,
  currentAction: null,
});

describe('GameRoomService.startGame', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('deals cards to active players and starts on a random active player', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.75);
    const service = new GameRoomService();
    const activeA = makePlayer('active-a');
    const observer = makePlayer('observer', Roles.OBSERVER);
    const activeB = makePlayer('active-b');
    const room = makeRoom([activeA, observer, activeB]);
    service.updateGameRoom(room.roomCode, room);

    service.startGame(room.roomCode);

    expect(room.gameStatus).toBe(GameStatus.ONGOING);
    expect(activeA.hand).toHaveLength(32);
    expect(activeA.handSize).toBe(32);
    expect(activeB.hand).toHaveLength(32);
    expect(activeB.handSize).toBe(32);
    expect(observer.hand).toEqual([]);
    expect(observer.handSize).toBe(0);
    expect(room.currentAction).toMatchObject({
      turnPlayer: activeB.uuid,
      prevPlayer: activeB.uuid,
      conspiracy: [],
      card: -1,
      claim: -1,
    });
  });

  test('throws before starting when there are no active players', () => {
    const service = new GameRoomService();
    const room = makeRoom([makePlayer('observer', Roles.OBSERVER)]);
    service.updateGameRoom(room.roomCode, room);

    expect(() => service.startGame(room.roomCode)).toThrow(/no active players/i);
    expect(room.gameStatus).toBe(GameStatus.SETUP);
    expect(room.currentAction).toBeNull();
  });
});
