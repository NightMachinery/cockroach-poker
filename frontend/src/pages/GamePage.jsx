import { Box, Text, Container, HStack, VStack } from '@chakra-ui/react';
import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Link as ReactRouterLink } from 'react-router-dom';
import { Link as ChakraLink } from '@chakra-ui/react';
import { socket, bootstrapIdentity } from '../lib/socket.js';
import RoomLinkButton from '../components/RoomLinkButton.jsx';
import GameTable, { getPlayerName } from '../components/GameTable.jsx';

// Standalone spectator / projector screen. Shows the shared table for everyone
// (no hand — myUuid is null). After the remote-play conversion it is an optional
// big-screen view; each player now also sees the table on their own /play page.
const GamePage = () => {
  const location = useLocation();
  const { roomCode } = location.state || {};

  const [gameRoom, setGameRoom] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [gameOver, setGameOver] = useState(null);

  useEffect(() => {
    bootstrapIdentity();

    socket.on('connect', () => {
      console.log(`Connected with id ${socket.id}`);
    });

    socket.on('returnGameRoom', (gameRoom) => {
      setGameRoom(gameRoom);
    });

    socket.on('returnGameOver', (loserId) => {
      setGameOver(loserId);
    });

    // The card is revealed to the whole room at call time; animate it for ~2s.
    socket.on('returnReveal', (payload) => {
      setReveal(payload);
      setTimeout(() => setReveal(null), 2000);
    });

    return () => {
      socket.off('connect');
      socket.off('returnGameRoom');
      socket.off('returnGameOver');
      socket.off('returnReveal');
    };
  }, []);

  useEffect(() => {
    if (roomCode) {
      socket.emit('joinSocketRoom', roomCode);
    }
  }, [roomCode]);

  return (
    <Container
      maxW='100vw'
      maxH='100vh'
      display='flex'
      justifyContent='center'
      alignItems='center'
      bg='#2A9D8F'
      p={0}
      flexDirection='column'
    >
      <Box
        display='flex'
        justifyContent='center'
        alignItems='center'
        height='100vh'
        bg='#E9C46A'
        p={4}
        position='relative'
        width='100%'
      >
        <HStack position='absolute' top='3' left='4' spacing={3} align='center'>
          <Text fontSize='2xl' fontWeight='bold' color='#264653'>
            Room:{' '}
            <Text
              as='span'
              color='#FBC02D'
              textShadow='0 0 1px #264653, 0 0 3px #000000, 0 0 15px #264653;'
            >
              {roomCode || 'N/A'}
            </Text>
          </Text>
          <RoomLinkButton roomCode={roomCode} size='sm' />
        </HStack>
        {gameRoom ? (
          <Box width='90%' height='90%' position='relative'>
            {gameOver ? (
              <VStack
                spacing={1}
                position='absolute'
                top='50%'
                left='50%'
                transform='translate(-50%, -50%)'
                zIndex={4}
                bg='rgba(255,255,255,0.85)'
                p={8}
                borderRadius='md'
              >
                <Text fontSize='5xl' fontWeight='bold' color='#172d36'>
                  Game Over!
                </Text>
                <Text fontSize='3xl' fontWeight='bold' color='#264653'>
                  Loser: {getPlayerName(gameRoom.players, gameOver)}
                </Text>
                <Text fontSize='2xl' fontWeight='bold' color='#172d36' decoration={'underline'}>
                  <ChakraLink as={ReactRouterLink} to='/'>
                    Play again?
                  </ChakraLink>
                </Text>
              </VStack>
            ) : null}
            <GameTable gameRoom={gameRoom} myUuid={null} reveal={reveal} />
          </Box>
        ) : (
          <VStack>
            <Text fontSize={'2xl'}>Loading game...</Text>
            <Text fontSize={'lg'}>
              If this doesn't load,{' '}
              <Text as={'span'} color={'teal.500'} textDecoration={'underline'}>
                <ChakraLink as={ReactRouterLink} to='/'>
                  try again.
                </ChakraLink>
              </Text>
            </Text>
          </VStack>
        )}
      </Box>
    </Container>
  );
};

export default GamePage;
