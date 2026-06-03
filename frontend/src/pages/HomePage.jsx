import {
  Box,
  Button,
  Text,
  Image,
  VStack,
  HStack,
  Input,
  useToast,
} from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { socket, bootstrapIdentity } from '../lib/socket.js';
import {
  getStoredName,
  setStoredName,
  getStoredAvatar,
  getRoomParamsFromUrl,
} from '../lib/identity.js';

const DEFAULT_AVATAR = 'jake';

const HomePage = () => {
  const navigate = useNavigate();
  const toast = useToast();

  // Auto-join state (when arriving via an invite/migrate link).
  const [autoParams] = useState(() => getRoomParamsFromUrl());
  const [needName, setNeedName] = useState(false);
  const [nameInput, setNameInput] = useState(getStoredName());

  useEffect(() => {
    bootstrapIdentity();

    const handleReturnEmptyGameRoom = (gameRoom) => {
      navigate('/host', { state: { roomCode: gameRoom.roomCode } });
    };
    const handleJoinResult = (success, returnedRoomCode) => {
      if (success) {
        navigate('/play', { state: { roomCode: returnedRoomCode } });
      } else {
        toast({
          title: 'Could not join room',
          description: 'The room may not exist or the game already started.',
          status: 'error',
          duration: 4000,
          isClosable: true,
        });
        setNeedName(false);
      }
    };

    socket.on('returnEmptyGameRoom', handleReturnEmptyGameRoom);
    socket.on('returnJoinPlayerToRoom', handleJoinResult);
    return () => {
      socket.off('returnEmptyGameRoom', handleReturnEmptyGameRoom);
      socket.off('returnJoinPlayerToRoom', handleJoinResult);
    };
  }, [navigate, toast]);

  // Auto-join flow when ?room= (and optionally &migrate=) is present.
  useEffect(() => {
    if (!autoParams.room) return;

    const doJoin = () => {
      if (autoParams.migrate) {
        // Adopt the migrated identity for this room.
        socket.emit('joinWithMigrate', autoParams.room, autoParams.migrate);
        return;
      }
      const name = getStoredName();
      if (!name) {
        setNeedName(true);
        return;
      }
      const avatar = getStoredAvatar() || DEFAULT_AVATAR;
      socket.emit('requestJoinPlayerToRoom', autoParams.room, name, avatar);
    };

    if (socket.connected) doJoin();
    else socket.once('connect', doJoin);
  }, [autoParams]);

  const handleSubmitName = () => {
    const name = nameInput.trim();
    if (!name) return;
    setStoredName(name);
    const avatar = getStoredAvatar() || DEFAULT_AVATAR;
    socket.emit('requestJoinPlayerToRoom', autoParams.room, name, avatar);
  };

  const handleCreate = () => {
    socket.emit('requestCreateEmptyGameRoom');
  };

  // Prompt for a name when auto-joining without a stored one.
  if (autoParams.room && needName) {
    return (
      <Box
        width='100vw'
        height='100vh'
        bg='#2A9D8F'
        display='flex'
        justifyContent='center'
        alignItems='center'
        p='5%'
      >
        <VStack
          bg='#F4A261'
          p={8}
          borderRadius='md'
          boxShadow='lg'
          spacing={4}
          border='4px solid #33A00A'
        >
          <Text fontSize='xl' fontWeight='bold' color='#264653'>
            Joining room {autoParams.room}
          </Text>
          <Text color='#264653'>Pick a display name:</Text>
          <Input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder='Your name'
            maxLength={16}
            bg='#f4f1de'
            textAlign='center'
            onKeyDown={(e) => e.key === 'Enter' && handleSubmitName()}
          />
          <Button colorScheme='teal' onClick={handleSubmitName} width='100%'>
            Join
          </Button>
        </VStack>
      </Box>
    );
  }

  if (autoParams.room) {
    return (
      <Box
        width='100vw'
        height='100vh'
        bg='#2A9D8F'
        display='flex'
        justifyContent='center'
        alignItems='center'
      >
        <Text fontSize='2xl' fontWeight='bold' color='#264653'>
          Joining room {autoParams.room}…
        </Text>
      </Box>
    );
  }

  return (
    <Box
      width='100vw'
      height='100vh'
      bg='#2A9D8F'
      display='flex'
      justifyContent='center'
      alignItems='center'
      flexDirection='column'
      overflow='hidden'
      p={{ base: '5%', sm: '4%', md: '3%', lg: '2%', xl: '1%' }}
    >
      <HStack
        spacing={{ base: '5%', sm: '4%', md: '3%', lg: '2%', xl: '1%' }}
        width={{ base: '90%', sm: '85%', md: '80%', lg: '75%', xl: '70%' }}
        height={{ base: '85%', sm: '80%', md: '75%', lg: '70%', xl: '65%' }}
        justifyContent='center'
        alignItems='center'
        flexDirection={{ base: 'column', md: 'row' }}
      >
        <Box
          bg='#F4A261'
          p={{ base: 4, sm: 6, md: 8 }}
          borderRadius='md'
          boxShadow='lg'
          border='4px solid'
          borderColor='#33A00A'
          width={{ base: '90%', sm: '80%', md: '70%', lg: '50%', xl: '40%' }}
        >
          <VStack spacing={6} alignItems='center'>
            <Text
              fontSize={{ base: '8vw', sm: '6vw', md: '4vw', lg: '3vw', xl: '2.5vw' }}
              fontWeight='bold'
              textAlign='center'
              color='#264653'
            >
              COCKROACH <br /> POKER🪳
            </Text>

            <Box width='100%'>
              <Button
                onClick={handleCreate}
                bg='#E9C46A'
                color='#264653'
                _hover={{ bg: '#F4A261' }}
                width='100%'
                fontSize={{ base: '5vw', sm: '4vw', md: '3vw', lg: '2.5vw', xl: '2vw' }}
                py='6'
              >
                CREATE
              </Button>
            </Box>

            <Box width='100%' mt={{ base: 0, md: 1 }}>
              <Button
                as={Link}
                to='/join'
                bg='#E9C46A'
                color='#264653'
                _hover={{ bg: '#F4A261' }}
                width='100%'
                fontSize={{ base: '5vw', sm: '4vw', md: '3vw', lg: '2.5vw', xl: '2vw' }}
                py='6'
              >
                JOIN
              </Button>
            </Box>
          </VStack>
        </Box>

        <Image
          src='/cards/back.png'
          alt='Back'
          width={{ base: '30%', sm: '25%', md: '25%', lg: '25%', xl: '20%' }}
          transform={{ base: 'rotate(15deg)', md: 'rotate(20deg)' }}
        />
      </HStack>
    </Box>
  );
};

export default HomePage;
