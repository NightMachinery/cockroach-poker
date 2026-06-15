import { describe, expect, test } from 'vitest';
import { GameRoomService } from '../../../backend/services/gameroom.service.js';
import { GameStatus, Roles } from '../../../backend/utilities/constants.js';

// Hidden-information enforcement + peek/reveal flow (remote-play conversion).

const makePlayer = (uuid, role = Roles.PLAYER) => ({
  uuid,
  userId: `user-${uuid}`,
  nickname: uuid,
  role,
  hand: [1, 2, 3],
  handSize: 3,
  pile: [],
  pileSize: 0,
});

const seedRoom = (service, currentAction) => {
  const a = makePlayer('a');
  const b = makePlayer('b');
  const c = makePlayer('c');
  const room = {
    roomCode: 'TEST',
    numPlayers: 3,
    gameStatus: GameStatus.ONGOING,
    players: [a, b, c],
    currentAction,
  };
  service.updateGameRoom('TEST', room);
  return { room, a, b, c };
};

describe('publicGameRoomFor masking', () => {
  test('a viewer sees only their own hand; others are empty', () => {
    const service = new GameRoomService();
    seedRoom(service, {
      turnPlayer: 'b',
      prevPlayer: 'a',
      conspiracy: ['a'],
      peeked: [],
      card: 5,
      claim: 5,
    });

    const view = service.publicGameRoomFor('TEST', 'user-b');
    const own = view.players.find((p) => p.uuid === 'b');
    const other = view.players.find((p) => p.uuid === 'a');
    expect(own.hand).toEqual([1, 2, 3]);
    expect(own.handSize).toBe(3);
    expect(other.hand).toEqual([]);
    expect(other.handSize).toBe(3); // size still public
  });

  test('in-flight card is hidden from non-conspiracy, shown to conspiracy', () => {
    const service = new GameRoomService();
    seedRoom(service, {
      turnPlayer: 'b',
      prevPlayer: 'a',
      conspiracy: ['a'],
      peeked: [],
      card: 5,
      claim: 5,
    });

    // a is in conspiracy → sees the real card.
    expect(service.publicGameRoomFor('TEST', 'user-a').currentAction.card).toBe(5);
    // b has not peeked and is not in conspiracy → masked.
    expect(service.publicGameRoomFor('TEST', 'user-b').currentAction.card).toBe(0);
    // spectator (null) → masked.
    expect(service.publicGameRoomFor('TEST', null).currentAction.card).toBe(0);
  });

  test('youPeeked is derived and raw peeked array is stripped', () => {
    const service = new GameRoomService();
    seedRoom(service, {
      turnPlayer: 'b',
      prevPlayer: 'a',
      conspiracy: ['a'],
      peeked: ['b'],
      card: 5,
      claim: 5,
    });

    const viewB = service.publicGameRoomFor('TEST', 'user-b').currentAction;
    expect(viewB.youPeeked).toBe(true);
    expect(viewB.peeked).toBeUndefined();
    expect(viewB.card).toBe(5); // b peeked → sees it

    const viewC = service.publicGameRoomFor('TEST', 'user-c').currentAction;
    expect(viewC.youPeeked).toBe(false);
    expect(viewC.card).toBe(0);
  });

  test('sentinel cards (0/-1) are never revealed', () => {
    const service = new GameRoomService();
    seedRoom(service, {
      turnPlayer: 'a',
      prevPlayer: 'a',
      conspiracy: ['a'],
      peeked: ['a'],
      card: -1,
      claim: -1,
    });
    expect(service.publicGameRoomFor('TEST', 'user-a').currentAction.card).toBe(0);
  });
});

describe('peekCard', () => {
  test('only the turn player may peek; updates peeked', () => {
    const service = new GameRoomService();
    const { room } = seedRoom(service, {
      turnPlayer: 'b',
      prevPlayer: 'a',
      conspiracy: ['a'],
      peeked: [],
      card: 5,
      claim: 5,
    });

    expect(service.peekCard('TEST', 'c')).toEqual({ ok: false }); // not turn player
    const res = service.peekCard('TEST', 'b');
    expect(res).toEqual({ ok: true, card: 5 });
    expect(room.currentAction.peeked).toContain('b');
  });

  test('cannot peek when there is no live card', () => {
    const service = new GameRoomService();
    seedRoom(service, {
      turnPlayer: 'b',
      prevPlayer: 'a',
      conspiracy: [],
      peeked: [],
      card: 0,
      claim: 0,
    });
    expect(service.peekCard('TEST', 'b')).toEqual({ ok: false });
  });
});

describe('callCard reveal', () => {
  test('returns a reveal object and resets the round', () => {
    const service = new GameRoomService();
    const { room } = seedRoom(service, {
      turnPlayer: 'b',
      prevPlayer: 'a',
      conspiracy: ['a'],
      peeked: [],
      card: 5,
      claim: 5, // truthful claim
    });

    // b calls TRUE; claim was truthful so caller is correct → prevPlayer (a) loses.
    const reveal = service.callCard('TEST', 'b', true);
    expect(reveal).toMatchObject({
      actualCard: 5,
      claim: 5,
      callAs: true,
      wasCorrect: true,
      reality: true,
      loserUuid: 'a',
      callerUuid: 'b',
      prevPlayerUuid: 'a',
    });
    // Round reset, card masked back to 0.
    expect(room.currentAction.card).toBe(0);
    expect(room.currentAction.peeked).toEqual([]);
    // Loser got the card in their pile.
    expect(room.players.find((p) => p.uuid === 'a').pile).toContain(5);
  });

  test('wrong call makes the caller the loser', () => {
    const service = new GameRoomService();
    seedRoom(service, {
      turnPlayer: 'b',
      prevPlayer: 'a',
      conspiracy: ['a'],
      peeked: [],
      card: 5,
      claim: 6, // a lied (claimed 6, it's 5)
    });
    // reality = false. b calls TRUE (wrong) → b loses.
    const reveal = service.callCard('TEST', 'b', true);
    expect(reveal.reality).toBe(false);
    expect(reveal.wasCorrect).toBe(false);
    expect(reveal.loserUuid).toBe('b');
  });

  test('non-turn player cannot call', () => {
    const service = new GameRoomService();
    seedRoom(service, {
      turnPlayer: 'b',
      prevPlayer: 'a',
      conspiracy: ['a'],
      peeked: [],
      card: 5,
      claim: 5,
    });
    expect(service.callCard('TEST', 'c', true)).toBe(false);
  });
});
