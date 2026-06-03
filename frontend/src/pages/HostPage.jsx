import { useEffect, useState } from 'react';
import {
  Box,
  Text,
  Grid,
  Button,
  Container,
  Image,
  VStack,
  HStack,
} from '@chakra-ui/react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import FlippingCard from '../components/FlippingCard.jsx';
import RoomLinkButton from '../components/RoomLinkButton.jsx';
import PlayerList from '../components/PlayerList.jsx';
import MigrateDeviceButton from '../components/MigrateDeviceButton.jsx';
import { socket, bootstrapIdentity, onUserId, getMyUserId } from '../lib/socket.js';
import { getStoredName, getStoredAvatar } from '../lib/identity.js';

const HostPage = () => {
  const [gameRoom, setGameRoom] = useState(null);
  const [myUserId, setMyUserId] = useState(getMyUserId());
  const [flippedStates, setFlippedStates] = useState([
    false, false, false, false, false, false,
  ]);

  const location = useLocation();
  const { roomCode } = location.state || {};
  const navigate = useNavigate();

  const handleStartGame = () => {
    socket.emit('requestStartGame', roomCode);
  };

  useEffect(() => {
    bootstrapIdentity();
    const offUser = onUserId(setMyUserId);

    const handleReturnGameRoom = (gr) => setGameRoom(gr);
    const handleReturnStartGame = (rc) => navigate('/game', { state: { roomCode: rc } });

    socket.on('returnGameRoom', handleReturnGameRoom);
    socket.on('returnStartGame', handleReturnStartGame);

    return () => {
      offUser();
      socket.off('returnGameRoom', handleReturnGameRoom);
      socket.off('returnStartGame', handleReturnStartGame);
    };
  }, [navigate]);

  // Join as the creator player (materializes the owner), then subscribe.
  useEffect(() => {
    if (!roomCode) return;
    const join = () => {
      const name = getStoredName() || 'Host';
      const avatar = getStoredAvatar() || 'jake';
      socket.emit('requestJoinPlayerToRoom', roomCode, name, avatar);
      socket.emit('joinSocketRoom', roomCode);
    };
    if (socket.connected) join();
    else socket.once('connect', join);
  }, [roomCode]);

  useEffect(() => {
    if (gameRoom && gameRoom.numPlayers > 0) {
      const playerCount = Math.min(gameRoom.numPlayers, 6);
      setFlippedStates((prev) => {
        const n = [...prev];
        for (let i = 0; i < playerCount; i++) n[i] = true;
        return n;
      });
    }
  }, [gameRoom]);

  const renderCards = (startIndex) =>
    [...Array(3)].map((_, i) => {
      const player = gameRoom?.players[startIndex + i];
      const flipped = flippedStates[startIndex + i];
      return (
        <FlippingCard
          key={startIndex + i}
          isFlipped={flipped}
          width='10vw'
          height='15vw'
          backImage='/cards/back.png'
          frontContent={
            player ? (
              <Box
                display='flex'
                flexDirection='column'
                alignItems='center'
                justifyContent='center'
                textAlign='center'
                height='100%'
              >
                <Image
                  src={`/avatars/${player.playerIcon}.png`}
                  alt={player.displayName}
                  width='80%'
                  borderRadius='full'
                  mb={2}
                />
                <Text fontWeight='bold' fontSize='lg'>
                  {player.displayName}
                </Text>
              </Box>
            ) : null
          }
        />
      );
    });

  if (!roomCode) return <Navigate to='/' />;

  return (
    <Container
      maxW='100vw'
      p={0}
      bg='#2A9D8F'
      display='flex'
      flexDirection='column'
      alignItems='center'
      minH='100vh'
    >
      {/* Top corner: icon-only copy-invite + migrate-device buttons. Offset on
          md+ so they clear the fixed mute button in the top-right corner
          (App.jsx AudioPlayer, which is hidden on mobile). */}
      <HStack
        position='absolute'
        top={3}
        right={{ base: 3, md: '116px' }}
        spacing={2}
        zIndex={10}
      >
        <RoomLinkButton roomCode={roomCode} size='md' iconOnly />
        {myUserId && (
          <MigrateDeviceButton
            roomCode={roomCode}
            targetUserId={myUserId}
            iconOnly
            size='md'
            isRound
          />
        )}
      </HStack>

      <Grid
        templateColumns='repeat(3, 1fr)'
        gap='4'
        mt='16'
        justifyItems='center'
        width='80%'
      >
        {renderCards(0)}
      </Grid>

      <Box
        display='flex'
        flexDirection='column'
        justifyContent='center'
        alignItems='center'
        mt={4}
        width={{ base: '95%', md: '70%', lg: '50%' }}
      >
        <Button
          onClick={handleStartGame}
          bg='#E9C46A'
          color='#264653'
          fontSize={{ base: '4vw', md: '2vw' }}
          _hover={{ bg: '#E76F51' }}
          px='6'
          py='7'
          mb={3}
          isDisabled={(gameRoom?.numPlayers ?? 0) < 2}
        >
          Start Game ({gameRoom?.numPlayers ?? 0} players)
        </Button>

        {/* Players + mod controls */}
        <Box width='100%' bg='whiteAlpha.800' borderRadius='md' p={3} mb={6}>
          <Text fontWeight='bold' color='#264653' mb={2}>
            Players
          </Text>
          <PlayerList room={gameRoom} me={myUserId} />
        </Box>
      </Box>

      <Grid
        templateColumns='repeat(3, 1fr)'
        gap='4'
        mt='2'
        mb='4'
        justifyItems='center'
        width='80%'
      >
        {renderCards(3)}
      </Grid>
    </Container>
  );
};

export default HostPage;
