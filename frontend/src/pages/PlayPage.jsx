import {
  Box,
  Button,
  Card,
  CardBody,
  CardHeader,
  Drawer,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerContent,
  DrawerCloseButton,
  Heading,
  HStack,
  Text,
  useDisclosure,
  SimpleGrid,
  Image,
  Avatar,
  VStack,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  Badge,
  Divider,
  Link as ChakraLink,
} from '@chakra-ui/react';

import { Navigate, useLocation, Link as ReactRouterLink } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { useToast } from '@chakra-ui/react';
import { socket, bootstrapIdentity, onUserId, getMyUserId } from '../lib/socket.js';
import RoomLinkButton from '../components/RoomLinkButton.jsx';
import PlayerList from '../components/PlayerList.jsx';
import MigrateDeviceButton from '../components/MigrateDeviceButton.jsx';
import GameTable, {
  CardNumberToString,
  CardNumberToImage,
  avatarMap,
} from '../components/GameTable.jsx';

// Play a short "your turn" ping using the Web Audio API (no asset needed).
const playTurnPing = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1175, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.start();
    osc.stop(ctx.currentTime + 0.42);
    osc.onended = () => ctx.close();
  } catch {
    /* audio unavailable */
  }
};

const PlayPage = () => {
  const toast = useToast();
  const turnPlayerModal = useDisclosure();
  const playerListDrawer = useDisclosure();
  const [player, setPlayer] = useState(null);
  const [socketReady, setSocketReady] = useState(false);
  const location = useLocation();
  const roomCode = location.state?.roomCode;
  // Identity comes from the shared socket, not navigation state.
  const [uuid, setUuid] = useState(null);
  const uuidRef = useRef(null);
  const [myUserId, setMyUserId] = useState(getMyUserId());
  const [selectedCard, setSelectedCard] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [claim, setClaim] = useState(0);
  const [callMode, setCallMode] = useState(false);
  const [passMode, setPassMode] = useState(false);
  const [gameRoom, setGameRoom] = useState(null);
  const [currentAction, setCurrentAction] = useState(null);
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [isFirstTurnInGameAction, setIsFirstTurnInGameAction] = useState(false);
  const [players, setPlayers] = useState([]);

  // Remote-play state.
  const [peekedCard, setPeekedCard] = useState(null); // local copy after peeking
  const [reveal, setReveal] = useState(null); // latest returnReveal payload
  const [gameOver, setGameOver] = useState(null); // loser uuid once game ends
  const [activity, setActivity] = useState([]); // lightweight action log
  const prevActionRef = useRef(null);
  const wasMyTurnRef = useRef(false);
  const titleFlashRef = useRef(null);
  const gameRoomRef = useRef(null); // latest gameRoom, for socket handlers

  const selectCardDrawer = useDisclosure();
  const selectPlayerDrawer = useDisclosure();
  const makeStatementDrawer = useDisclosure();
  const [showPile, setShowPile] = useState(false);

  const isObserver = player?.role === 'observer';

  const getPlayerName = (givenUUID) => {
    const foundPlayer = players.find((p) => p.uuid == givenUUID);
    return foundPlayer ? foundPlayer.displayName || foundPlayer.nickname : 'Unknown Player';
  };

  const pushActivity = (text) => {
    setActivity((prev) => [...prev.slice(-19), { text, ts: Date.now() }]);
  };

  const handleCardSelection = (card) => {
    setSelectedCard(card);
    selectCardDrawer.onClose();
    selectPlayerDrawer.onOpen();
  };

  const handlePlayerSelection = (player) => {
    setSelectedPlayer(player);
    selectPlayerDrawer.onClose();
    makeStatementDrawer.onOpen();
  };

  const handleStatementSubmit = () => {
    if (claim === 0) {
      toast({ title: 'Please pick a claim.', status: 'error', duration: 4000, isClosable: true });
      return;
    }

    socket.emit(
      'requestPlayerStartRound',
      roomCode,
      uuid,
      selectedPlayer.uuid,
      selectedCard,
      claim
    );

    makeStatementDrawer.onClose();
    setSelectedCard(null);
    setSelectedPlayer(null);
    setClaim(0);
    setPeekedCard(null);
    setIsFirstTurnInGameAction(false);
    setIsMyTurn(false);

    toast({ title: 'Card sent!', status: 'success', duration: 4000, isClosable: true });
  };

  const handleCallCard = (callAs) => {
    // The outcome toast is driven by the returnReveal event — the caller has not
    // peeked, so we don't have the true card client-side here.
    socket.emit('requestPlayerCallCard', roomCode, uuid, callAs);
    setCallMode(false);
    setIsMyTurn(false);
    turnPlayerModal.onClose();
  };

  const handlePassCard = (toPlayer, claim) => {
    if (claim === 0) {
      toast({ title: 'Please pick a claim.', status: 'error', duration: 4000, isClosable: true });
      return;
    }

    socket.emit('requestPlayerPassCard', roomCode, uuid, toPlayer.uuid, claim);

    toast({
      title: `Card sent to ${toPlayer.nickname}!`,
      status: 'success',
      duration: 7000,
      isClosable: true,
    });

    makeStatementDrawer.onClose();
    turnPlayerModal.onClose();
    setSelectedCard(null);
    setSelectedPlayer(null);
    setClaim(0);
    setPassMode(false);
    setPeekedCard(null);
    setIsMyTurn(false);
  };

  // PASS requires peeking first: ask the server for the true card, then reveal it
  // locally and switch the modal into pass mode.
  const handlePeekToPass = () => {
    if (peekedCard != null) {
      setPassMode(true);
      return;
    }
    socket.emit('requestPeekCard', roomCode);
  };

  useEffect(() => {
    bootstrapIdentity();
    const offUser = onUserId((id) => setMyUserId(id));
    if (socket.connected) setSocketReady(true);

    const handleConnect = () => setSocketReady(true);

    const handleReturnNewRound = (loserId, loserName) => {
      if (loserId === uuidRef.current) {
        toast({
          title: 'You lost the round! Go again.',
          status: 'info',
          duration: 9000,
          isClosable: true,
        });
      } else {
        toast({
          title: `New round! ${loserName} starts.`,
          status: 'info',
          duration: 9000,
          isClosable: true,
        });
      }
    };

    const handleReturnPlayer = (player) => {
      if (!player) return;
      player.avatar = avatarMap[player.playerIcon] || '/avatars/default.png';
      setPlayer(player);
    };

    const handleReturnGameRoom = (gameRoom) => {
      if (!gameRoom) {
        console.warn('Received game room: null');
        return;
      }

      setPlayers(gameRoom.players || []);
      setGameRoom(gameRoom);
      const ca = gameRoom.currentAction;
      setCurrentAction(ca);

      // Find my own player by identity (userId), and learn my in-game uuid.
      const meId = getMyUserId();
      const mine = gameRoom.players.find((p) => meId && p.userId === meId) || null;

      // Activity log: detect a fresh pass/start (a new live claim from prevPlayer
      // to turnPlayer) by comparing against the previous action.
      const prev = prevActionRef.current;
      if (ca && ca.claim > 0 && (ca.conspiracy?.length || 0) >= 1) {
        const changed =
          !prev ||
          prev.turnPlayer !== ca.turnPlayer ||
          (prev.conspiracy?.length || 0) !== (ca.conspiracy?.length || 0);
        if (changed) {
          const fromName =
            gameRoom.players.find((p) => p.uuid === ca.prevPlayer)?.nickname || 'Someone';
          const toName =
            gameRoom.players.find((p) => p.uuid === ca.turnPlayer)?.nickname || 'someone';
          pushActivity(`${fromName} → ${toName}, claiming ${CardNumberToString[ca.claim]}`);
        }
      }
      prevActionRef.current = ca;

      if (mine) {
        setPlayer(mine);
        setUuid(mine.uuid);
        uuidRef.current = mine.uuid;

        // Refresh mid-pass: if the server says I've peeked, seed the local card.
        if (ca && ca.youPeeked && ca.card > 0) {
          setPeekedCard(ca.card);
        }

        if (ca && ca.turnPlayer === mine.uuid) {
          setIsMyTurn(true);
          setIsFirstTurnInGameAction(ca.prevPlayer === mine.uuid);
        } else {
          setIsMyTurn(false);
          setIsFirstTurnInGameAction(false);
          // No longer my turn → forget any stale peeked card / pass mode.
          setPeekedCard(null);
          setPassMode(false);
          setCallMode(false);
        }
      }
    };

    // The turn player's private peek result — only this socket receives it.
    const handleReturnPeekCard = ({ card }) => {
      setPeekedCard(card);
      setPassMode(true);
    };

    // Room-wide reveal at call time.
    const handleReturnReveal = (payload) => {
      setReveal(payload);
      const amCaller = payload.callerUuid === uuidRef.current;
      const amLoser = payload.loserUuid === uuidRef.current;
      pushActivity(
        `${getPlayerNameFrom(payload.callerUuid)} called ${
          payload.callAs ? 'TRUE' : 'FALSE'
        } — it was a ${CardNumberToString[payload.actualCard]} (${
          payload.wasCorrect ? 'correct' : 'wrong'
        })`
      );
      toast({
        title: amCaller
          ? payload.wasCorrect
            ? 'Phew — good call!'
            : `Wrong — it was a ${CardNumberToString[payload.actualCard]}!`
          : `${getPlayerNameFrom(payload.callerUuid)} called: it was a ${
              CardNumberToString[payload.actualCard]
            }`,
        description: amLoser ? 'You take the card.' : undefined,
        status: amCaller ? (payload.wasCorrect ? 'success' : 'error') : 'info',
        duration: 5000,
        isClosable: true,
      });
      setTimeout(() => setReveal(null), 2000);
    };

    const handleReturnGameOver = (loserId) => {
      setGameOver(loserId);
    };

    const handleActionError = (msg) => {
      toast({ title: msg || 'Action failed', status: 'error', duration: 4000, isClosable: true });
    };

    // getPlayerName closure over latest players (players state may be stale here).
    const getPlayerNameFrom = (givenUUID) => {
      const found = (gameRoomRef.current?.players || []).find((p) => p.uuid == givenUUID);
      return found ? found.displayName || found.nickname : 'Someone';
    };

    socket.on('connect', handleConnect);
    socket.on('returnPlayer', handleReturnPlayer);
    socket.on('returnGameRoom', handleReturnGameRoom);
    socket.on('returnNewRound', handleReturnNewRound);
    socket.on('returnPeekCard', handleReturnPeekCard);
    socket.on('returnReveal', handleReturnReveal);
    socket.on('returnGameOver', handleReturnGameOver);
    socket.on('actionError', handleActionError);

    return () => {
      offUser();
      socket.off('connect', handleConnect);
      socket.off('returnPlayer', handleReturnPlayer);
      socket.off('returnGameRoom', handleReturnGameRoom);
      socket.off('returnNewRound', handleReturnNewRound);
      socket.off('returnPeekCard', handleReturnPeekCard);
      socket.off('returnReveal', handleReturnReveal);
      socket.off('returnGameOver', handleReturnGameOver);
      socket.off('actionError', handleActionError);
    };
  }, []);

  // Keep a ref to the latest gameRoom so socket handlers can read fresh players.
  useEffect(() => {
    gameRoomRef.current = gameRoom;
  }, [gameRoom]);

  // "Your turn" alert: sound + tab-title flash when the turn transitions to me.
  useEffect(() => {
    const becameMyTurn = isMyTurn && !wasMyTurnRef.current;
    wasMyTurnRef.current = isMyTurn;

    if (becameMyTurn) {
      playTurnPing();
      // Flash the tab title until the tab is focused again or it's no longer my turn.
      if (document.hidden && !titleFlashRef.current) {
        const original = document.title;
        let on = false;
        titleFlashRef.current = setInterval(() => {
          on = !on;
          document.title = on ? '🎴 YOUR TURN!' : original;
        }, 1000);
      }
    }

    const stopFlash = () => {
      if (titleFlashRef.current) {
        clearInterval(titleFlashRef.current);
        titleFlashRef.current = null;
        document.title = 'Cockroach Poker';
      }
    };

    if (!isMyTurn) stopFlash();

    const onVisible = () => {
      if (!document.hidden) stopFlash();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isMyTurn]);

  useEffect(() => {
    return () => {
      if (titleFlashRef.current) clearInterval(titleFlashRef.current);
    };
  }, []);

  useEffect(() => {
    if (isMyTurn && !isFirstTurnInGameAction && !gameOver) {
      turnPlayerModal.onOpen();
    }
  }, [isMyTurn, isFirstTurnInGameAction, gameOver]);

  // Once connected, identified, and we know the room: join (idempotent) and
  // subscribe to room broadcasts.
  useEffect(() => {
    if (socketReady && roomCode && myUserId) {
      const storedName = (() => {
        try {
          return localStorage.getItem('cp_name') || '';
        } catch {
          return '';
        }
      })();
      const storedAvatar = (() => {
        try {
          return localStorage.getItem('cp_avatar') || 'jake';
        } catch {
          return 'jake';
        }
      })();
      socket.emit('requestJoinPlayerToRoom', roomCode, storedName, storedAvatar);
      socket.emit('joinSocketRoom', roomCode);
      socket.emit('requestGameRoom', roomCode);
    }
  }, [socketReady, roomCode, myUserId]);

  // Keep our socketId fresh on the server once we know our in-game uuid.
  useEffect(() => {
    if (uuid && roomCode) {
      socket.emit('setSocketId', roomCode, uuid, socket.id);
    }
  }, [uuid, roomCode]);

  // ---- Derived UI bits ------------------------------------------------------

  const liveClaim =
    currentAction && currentAction.claim > 0 && (currentAction.conspiracy?.length || 0) >= 1;

  const turnBanner = (() => {
    if (!currentAction || gameOver) return null;
    const turnName = getPlayerName(currentAction.turnPlayer);
    if (liveClaim) {
      const fromName = getPlayerName(currentAction.prevPlayer);
      return `${fromName} passed to ${turnName}, claiming ${
        CardNumberToString[currentAction.claim]
      } · It's ${turnName}'s turn`;
    }
    return `It's ${turnName}'s turn to start the round`;
  })();

  return (
    <Box
      width='100vw'
      minHeight='100vh'
      bg='#E9C46A'
      display='flex'
      flexDirection='column'
      alignItems='center'
      p={[2, 4]}
    >
      {/* Turn modal (call / pass) */}
      <Modal isOpen={turnPlayerModal.isOpen} onClose={turnPlayerModal.onClose} isCentered>
        <ModalOverlay />
        <ModalContent bg='#FFF7D6' borderRadius='md' p={6}>
          <ModalHeader textAlign='center'>Your Turn!</ModalHeader>
          <ModalCloseButton />
          <ModalBody textAlign='center'>
            <VStack>
              <Image
                src={CardNumberToImage[passMode && peekedCard != null ? peekedCard : 0]}
                alt={CardNumberToString[passMode && peekedCard != null ? peekedCard : 0]}
                height='200'
                objectFit='contain'
                mb={2}
              />
              <Text fontSize='lg'>
                <Text as={'span'} fontWeight={'bold'}>
                  {getPlayerName(currentAction?.prevPlayer)}
                </Text>{' '}
                says this card is a{' '}
                <Text as={'span'} fontWeight={'bold'}>
                  {CardNumberToString[currentAction?.claim]}
                </Text>
                .
              </Text>
              <Text fontSize='lg' mb={3}>
                {callMode
                  ? 'Call it!'
                  : passMode && peekedCard != null
                  ? `It was a ${CardNumberToString[peekedCard]}!`
                  : 'What will you do?'}
              </Text>
            </VStack>
          </ModalBody>

          <ModalFooter display='flex' justifyContent='center' gap={4}>
            {callMode ? (
              <>
                <Button colorScheme='green' onClick={() => handleCallCard(true)}>
                  True
                </Button>
                <Button colorScheme='red' onClick={() => handleCallCard(false)}>
                  False
                </Button>
              </>
            ) : passMode ? (
              <Button
                colorScheme='yellow'
                isDisabled={peekedCard == null}
                onClick={() => {
                  setSelectedCard(peekedCard);
                  turnPlayerModal.onClose();
                  selectPlayerDrawer.onOpen();
                }}
              >
                Pass It Along
              </Button>
            ) : (
              <>
                <Button colorScheme='green' onClick={() => setCallMode(true)}>
                  Call It
                </Button>
                <Button
                  colorScheme='yellow'
                  onClick={handlePeekToPass}
                  isDisabled={
                    currentAction?.conspiracy.length >= gameRoom?.numPlayers - 1
                  }
                >
                  Pass It (peek)
                </Button>
              </>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Player list drawer (available during the game) */}
      <Drawer
        isOpen={playerListDrawer.isOpen}
        placement='left'
        onClose={playerListDrawer.onClose}
        size='sm'
      >
        <DrawerOverlay />
        <DrawerContent bg='#FFF9C4'>
          <DrawerCloseButton />
          <DrawerHeader bg='#FBC02D'>Players & Activity</DrawerHeader>
          <DrawerBody>
            {gameRoom && <PlayerList room={gameRoom} me={myUserId} />}
            <HStack mt={3} spacing={2}>
              <RoomLinkButton roomCode={roomCode} size='sm' />
              {myUserId && (
                <MigrateDeviceButton roomCode={roomCode} targetUserId={myUserId} />
              )}
            </HStack>
            <Divider my={3} />
            <Heading size='sm' mb={2}>
              Activity
            </Heading>
            <VStack align='stretch' spacing={1} maxH='40vh' overflowY='auto'>
              {activity.length === 0 ? (
                <Text fontSize='sm' color='gray.500'>
                  No activity yet.
                </Text>
              ) : (
                [...activity].reverse().map((a) => (
                  <Text key={a.ts} fontSize='sm'>
                    {a.text}
                  </Text>
                ))
              )}
            </VStack>
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      {!roomCode ? (
        <Navigate to='/' replace />
      ) : !player ? (
        <Text mt={10}>
          GameRoom {roomCode} or Player UUID {uuid} does not exist.
        </Text>
      ) : (
        <VStack spacing={3} width='100%' maxW='1100px'>
          {/* Header row */}
          <HStack width='100%' justify='space-between' align='center'>
            <Button size='sm' colorScheme='teal' onClick={playerListDrawer.onOpen}>
              Players & Activity
            </Button>
            <HStack spacing={2}>
              <Text fontSize='md' fontWeight='bold'>
                {player.nickname}
              </Text>
              {isObserver && <Badge colorScheme='gray'>Observer</Badge>}
              <Image
                src={`/avatars/${player.playerIcon}.png`}
                alt={player.nickname}
                width={'44px'}
                borderRadius='full'
              />
            </HStack>
          </HStack>

          {gameRoom.gameStatus === 1 ? (
            <>
              {/* Game-over overlay state */}
              {gameOver ? (
                <VStack
                  bg='#FFF9C4'
                  border='2px solid #FBC02D'
                  borderRadius='md'
                  p={6}
                  spacing={2}
                  width='100%'
                >
                  <Text fontSize='4xl' fontWeight='bold' color='#172d36'>
                    Game Over!
                  </Text>
                  <Text fontSize='2xl' fontWeight='bold' color='#264653'>
                    Loser: {getPlayerName(gameOver)}
                  </Text>
                  <ChakraLink as={ReactRouterLink} to='/' color='teal.600' fontWeight='bold'>
                    Play again?
                  </ChakraLink>
                </VStack>
              ) : null}

              {/* Turn / pass banner */}
              {turnBanner && (
                <Box
                  width='100%'
                  bg={isMyTurn ? '#48BB78' : 'whiteAlpha.800'}
                  color={isMyTurn ? 'white' : '#264653'}
                  borderRadius='md'
                  p={2}
                  textAlign='center'
                  fontWeight='bold'
                >
                  {isMyTurn ? "⭐ It's your turn! " : ''}
                  {turnBanner}
                </Box>
              )}

              {/* Shared table */}
              <Box
                width='100%'
                height={['46vh', '52vh', '58vh']}
                position='relative'
                bg='#F4A261'
                borderRadius='md'
              >
                <GameTable gameRoom={gameRoom} myUuid={uuid} reveal={reveal} />
              </Box>

              {/* Own hand/pile + action button (observers get none) */}
              {!isObserver && (
                <>
                  <Card width='100%'>
                    <CardHeader bg='#FBC02D' borderTopRadius='md' py={2}>
                      <HStack justify='space-between'>
                        <Heading size='sm'>
                          {showPile
                            ? `Your Pile (${player.pileSize})`
                            : `Your Hand (${player.handSize})`}
                        </Heading>
                        <Button size='xs' variant='outline' onClick={() => setShowPile((p) => !p)}>
                          {showPile ? 'Show Hand' : 'Show Pile'}
                        </Button>
                      </HStack>
                    </CardHeader>
                    <CardBody maxHeight='260px' overflowY='auto' p={3}>
                      <SimpleGrid columns={[3, 4, 6]} spacing={3}>
                        {(showPile ? player?.pile || [] : player?.hand || []).map((card, index) => (
                          <Box
                            key={`${card}-${index}`}
                            bg='white'
                            borderRadius='md'
                            display='flex'
                            justifyContent='center'
                            alignItems='center'
                          >
                            <Image
                              src={CardNumberToImage[card]}
                              alt={CardNumberToString[card]}
                              height='110px'
                              objectFit='contain'
                            />
                          </Box>
                        ))}
                      </SimpleGrid>
                    </CardBody>
                  </Card>

                  {isFirstTurnInGameAction ? (
                    <Button colorScheme='yellow' onClick={selectCardDrawer.onOpen} width='100%'>
                      Play!
                    </Button>
                  ) : isMyTurn ? (
                    <Button
                      colorScheme='yellow'
                      width='100%'
                      onClick={() => turnPlayerModal.onOpen()}
                    >
                      It's your turn! (Call or Pass)
                    </Button>
                  ) : (
                    <Button colorScheme='gray' width='100%' isDisabled>
                      It's not your turn yet.
                    </Button>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <Text fontSize='xl'>Waiting for the host to start the game...</Text>
              <HStack justify='center' spacing={2} mb={2}>
                <RoomLinkButton roomCode={roomCode} size='sm' />
                {myUserId && (
                  <MigrateDeviceButton roomCode={roomCode} targetUserId={myUserId} />
                )}
              </HStack>
              <Box width='100%' bg='whiteAlpha.700' borderRadius='md' p={3} mb={2}>
                <Text fontWeight='bold' color='#264653' mb={2}>
                  Players ({gameRoom.numPlayers})
                </Text>
                <PlayerList room={gameRoom} me={myUserId} />
              </Box>
            </>
          )}

          {/* Select-card drawer */}
          <Drawer
            isOpen={selectCardDrawer.isOpen}
            placement='right'
            onClose={selectCardDrawer.onClose}
            size='md'
          >
            <DrawerOverlay />
            <DrawerContent bg='#F4A261' overflow='scroll'>
              <DrawerCloseButton />
              <DrawerHeader bg='#E76F51'>Select a Card</DrawerHeader>
              <DrawerBody>
                <Text mb={4}>Choose one of your cards to send:</Text>
                <SimpleGrid columns={2} spacing={4}>
                  {player?.hand?.map((card, index) => (
                    <Box
                      key={index}
                      borderRadius='md'
                      display='flex'
                      justifyContent='center'
                      alignItems='center'
                      cursor='pointer'
                      onClick={() => handleCardSelection(card)}
                      _hover={{ borderColor: 'teal.300', transform: 'scale(1.05)' }}
                      transition='all 0.2s'
                    >
                      <Image
                        src={CardNumberToImage[card]}
                        alt={CardNumberToString[card]}
                        boxSize='200'
                        objectFit='contain'
                        mb={2}
                      />
                    </Box>
                  ))}
                </SimpleGrid>
              </DrawerBody>
              <DrawerFooter>
                <Button variant='outline' onClick={selectCardDrawer.onClose}>
                  Cancel
                </Button>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>

          {/* Select-player drawer */}
          <Drawer
            isOpen={selectPlayerDrawer.isOpen}
            placement='right'
            onClose={selectPlayerDrawer.onClose}
            size='md'
          >
            <DrawerOverlay />
            <DrawerContent bg='#F4A261'>
              <DrawerCloseButton />
              <DrawerHeader bg='#E76F51'>Choose a Player</DrawerHeader>
              <DrawerBody>
                <Text mb={4}>
                  Select a player to send a{' '}
                  <Text as={'span'} fontWeight={'bold'}>
                    {CardNumberToString[selectedCard]}
                  </Text>{' '}
                  to:
                </Text>
                <VStack spacing={4} align='stretch'>
                  {players
                    .filter((p) => p.uuid !== player?.uuid && p.role !== 'observer')
                    .map((otherPlayer) => {
                      const isInConspiracy = currentAction?.conspiracy.includes(otherPlayer.uuid);
                      return (
                        <Box
                          key={otherPlayer.uuid}
                          bg='white'
                          p={4}
                          border='2px solid'
                          borderColor={
                            selectedPlayer?.uuid === otherPlayer.uuid ? 'teal.500' : 'gray.200'
                          }
                          borderRadius='md'
                          display='flex'
                          alignItems='center'
                          opacity={isInConspiracy ? 0.5 : 1}
                          pointerEvents={isInConspiracy ? 'none' : 'auto'}
                          cursor={isInConspiracy ? 'not-allowed' : 'pointer'}
                          onClick={() => !isInConspiracy && handlePlayerSelection(otherPlayer)}
                          _hover={
                            !isInConspiracy
                              ? { borderColor: 'teal.300', transform: 'translateX(5px)' }
                              : {}
                          }
                          transition='all 0.2s'
                        >
                          <Avatar
                            size='md'
                            src={avatarMap[otherPlayer.playerIcon] || '/avatars/default.png'}
                            name={otherPlayer.nickname}
                          />
                          <Text fontWeight='bold' ml={3}>
                            {otherPlayer.nickname}
                          </Text>
                        </Box>
                      );
                    })}
                </VStack>
              </DrawerBody>
              <DrawerFooter>
                <Button
                  variant='outline'
                  mr={3}
                  onClick={() => {
                    selectPlayerDrawer.onClose();
                    selectCardDrawer.onOpen();
                  }}
                  isDisabled={passMode}
                >
                  Back
                </Button>
                <Button variant='outline' onClick={selectPlayerDrawer.onClose}>
                  Cancel
                </Button>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>

          {/* Make-a-claim drawer */}
          <Drawer
            isOpen={makeStatementDrawer.isOpen}
            placement='right'
            onClose={makeStatementDrawer.onClose}
            size='md'
          >
            <DrawerOverlay />
            <DrawerContent bg='#F4A261'>
              <DrawerCloseButton />
              <DrawerHeader bg='#E76F51'>Make a Claim</DrawerHeader>
              <DrawerBody>
                <VStack spacing={4} align='stretch'>
                  <Text>
                    You're sending a{' '}
                    <Text fontWeight={'bold'} as={'span'}>
                      {CardNumberToString[selectedCard]}
                    </Text>{' '}
                    to{' '}
                    <Text fontWeight={'bold'} as={'span'}>
                      {selectedPlayer?.nickname}
                    </Text>
                    .
                  </Text>
                  <Image
                    src={CardNumberToImage[selectedCard]}
                    alt={CardNumberToString[selectedCard]}
                    height='200'
                    objectFit='contain'
                    mb={2}
                  />
                  <Text fontWeight='bold'>What will you claim this card is?</Text>
                  <Box bg='#FFF9C4' p={4} borderRadius='md'>
                    <Text mb={2} fontWeight='bold'>
                      This card is a...
                    </Text>
                    <SimpleGrid columns={2} spacing={3}>
                      {Object.entries(CardNumberToString)
                        .filter(([key]) => key !== '0')
                        .map(([num, label]) => (
                          <Button
                            key={num}
                            onClick={() => setClaim(Number(num))}
                            bg={claim === Number(num) ? '#f2ecb8' : ''}
                            borderColor={claim === Number(num) ? 'gray.600' : 'gray.300'}
                            borderWidth={claim === Number(num) ? '2px' : '1px'}
                            variant='outline'
                            _hover={{ transform: 'scale(1.05)', boxShadow: 'md' }}
                          >
                            {label}
                          </Button>
                        ))}
                    </SimpleGrid>
                  </Box>
                </VStack>
              </DrawerBody>
              <DrawerFooter>
                <Button
                  variant='outline'
                  mr={3}
                  onClick={() => {
                    makeStatementDrawer.onClose();
                    selectPlayerDrawer.onOpen();
                  }}
                >
                  Back
                </Button>
                <Button
                  colorScheme='teal'
                  onClick={
                    passMode
                      ? () => handlePassCard(selectedPlayer, claim)
                      : () => handleStatementSubmit()
                  }
                >
                  Send Card
                </Button>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        </VStack>
      )}
    </Box>
  );
};

export default PlayPage;
