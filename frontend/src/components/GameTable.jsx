import { Box, Text, Image, HStack, VStack } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';

// Shared "table" view: every player around the table with their avatar, hand
// count, and face-up pile, the turn-player glow, grayed-out conspiracy members,
// and the centered reveal box. Used both by the standalone /game projector
// screen (myUuid = null) and embedded in each player's /play controller.
//
// Props:
//   gameRoom : the (per-viewer masked) room object.
//   myUuid   : the viewer's in-game uuid, or null for a spectator/projector.
//   reveal   : the latest `returnReveal` payload, or null. When set, the reveal
//              box animates the true card; otherwise an in-flight claim
//              indicator (card back + "CLAIM IS: X") shows during a live round.

const cardEntrance = keyframes`
  0% { transform: scale(0.5) rotate(-10deg); opacity: 0; }
  50% { transform: scale(1.1) rotate(3deg); opacity: 1; }
  100% { transform: scale(1) rotate(0deg); }
`;

const avatarGlow = keyframes`
  0% { box-shadow: 0 0 20px 10px rgba(72, 187, 120, 0.6); }
  50% { box-shadow: 0 0 40px 25px rgba(72, 187, 120, 1); }
  100% { box-shadow: 0 0 20px 10px rgba(72, 187, 120, 0.6); }
`;

const getPilePosition = (position) => {
  // Top left
  if (position.top === '5%' && position.left === '5%') return { top: '10%', left: '15%' };
  // Top right
  if (position.top === '5%' && position.right === '5%') return { top: '10%', right: '15%' };
  // Bottom left
  if (position.bottom === '5%' && position.left === '5%') return { bottom: '10%', left: '15%' };
  // Bottom right
  if (position.bottom === '5%' && position.right === '5%') return { bottom: '10%', right: '15%' };
  // Top center
  if (position.top === '5%' && position.left === '50%')
    return { top: '30%', left: '50%', transform: 'translateX(-50%)', flexDirection: 'row' };
  // Bottom center
  if (position.bottom === '5%' && position.left === '50%')
    return { bottom: '30%', left: '50%', transform: 'translateX(-50%)', flexDirection: 'row' };
  return {};
};

export const CardNumberToString = {
  0: 'Unknown',
  1: 'Bat',
  2: 'Fly',
  3: 'Cockroach',
  4: 'Toad',
  5: 'Rat',
  6: 'Scorpion',
  7: 'Spider',
  8: 'Stinkbug',
};

export const CardNumberToImage = {
  0: '/cards/back.png',
  1: '/cards/bat.png',
  2: '/cards/fly.png',
  3: '/cards/roach.png',
  4: '/cards/frog.png',
  5: '/cards/rat.png',
  6: '/cards/scorpion.png',
  7: '/cards/spider.png',
  8: '/cards/stinkbug.png',
};

export const avatarMap = {
  'baby-yoda': '/avatars/baby-yoda.png',
  bmo: '/avatars/bmo.png',
  'cookie-monster': '/avatars/cookie-monster.png',
  finn: '/avatars/finn.png',
  'genie-lamp': '/avatars/genie-lamp.png',
  'harry-potter': '/avatars/harry-potter.png',
  jake: '/avatars/jake.png',
  mermaid: '/avatars/mermaid.png',
  'navi-avatar': '/avatars/navi-avatar.png',
  'wonder-woman': '/avatars/wonder-woman.png',
  'bill-cipher': '/avatars/bill-cipher.png',
};

export const getPlayerName = (players, givenUUID) => {
  const foundPlayer = (players || []).find((p) => p.uuid == givenUUID);
  return foundPlayer ? foundPlayer.displayName || foundPlayer.nickname : 'Unknown Player';
};

const positions = [
  { top: '5%', left: '5%' },
  { top: '5%', right: '5%' },
  { bottom: '5%', left: '5%' },
  { bottom: '5%', right: '5%' },
  { top: '5%', left: '50%', transform: 'translateX(-50%)' },
  { bottom: '5%', left: '50%', transform: 'translateX(-50%)' },
];

const GameTable = ({ gameRoom, myUuid = null, reveal = null }) => {
  if (!gameRoom) return null;

  const currentAction = gameRoom.currentAction;
  // A live round is in flight once someone has passed/started (conspiracy grows)
  // and there is a real claim to display.
  const hasLiveClaim =
    !reveal &&
    currentAction &&
    (currentAction.conspiracy?.length || 0) >= 1 &&
    currentAction.claim > 0;

  return (
    <Box
      width='100%'
      height='100%'
      bg='#F4A261'
      p={4}
      display='flex'
      flexDirection='column'
      alignItems='center'
      justifyContent='center'
      position='relative'
      borderRadius='md'
    >
      {gameRoom.players.map((player, index) => {
        const pileCounts = player?.pile?.reduce((acc, card) => {
          acc[card] = (acc[card] || 0) + 1;
          return acc;
        }, {});

        const avatarSrc = avatarMap[player.playerIcon] || '/avatars/default.png';
        const isInConspiracy = currentAction?.conspiracy?.includes(player.uuid);
        const isTurnPlayer = player.uuid === currentAction?.turnPlayer;
        const isMe = myUuid && player.uuid === myUuid;

        return (
          <Box key={`player-${index}`}>
            <Box
              position='absolute'
              display='flex'
              flexDirection='column'
              alignItems='center'
              zIndex={2}
              {...positions[index % positions.length]}
            >
              <Box
                width={['50px', '65px', '80px']}
                height={['50px', '65px', '80px']}
                borderRadius='full'
                overflow='hidden'
                animation={isTurnPlayer ? `${avatarGlow} 1.5s ease-in-out infinite` : 'none'}
                filter={isInConspiracy ? 'grayscale(100%) brightness(0.5)' : 'none'}
                opacity={isInConspiracy ? 0.5 : 1}
                transition='filter 0.5s ease, opacity 0.5s ease'
                border={isMe ? '3px solid #FBC02D' : 'none'}
                backgroundColor='rgba(255,255,255,0.1)'
              >
                <Image
                  src={avatarSrc}
                  alt={player.nickname}
                  width={['50px', '65px', '80px']}
                  borderRadius='full'
                  filter={isInConspiracy ? 'grayscale(100%) brightness(0.5)' : 'none'}
                  opacity={isInConspiracy ? 0.5 : 1}
                  transition='filter 0.5s ease, opacity 0.5s ease'
                />
              </Box>
              <Text
                mt='2px'
                fontSize={['xl', 'xl']}
                color='white'
                fontWeight='bold'
                textShadow='0 0 3px black'
                textAlign='center'
                maxW='80px'
                whiteSpace='nowrap'
              >
                {player.nickname}
                {isMe ? ' (you)' : ''}
              </Text>
              <HStack spacing='8px' mt='1px'>
                <Image src='/cards/back.png' alt='Hand Card' height='65px' objectFit='contain' />
                <Text fontSize='5xl' color='black' textShadow='0 0 9px white'>
                  ×{player?.handSize ?? player?.hand?.length ?? 0}
                </Text>
              </HStack>
            </Box>

            <Box
              position='absolute'
              display='flex'
              gap='4px'
              p={1}
              bg='rgba(0,0,0,0.4)'
              borderRadius='md'
              zIndex={1}
              {...getPilePosition(positions[index % positions.length])}
            >
              {pileCounts &&
                Object.entries(pileCounts).map(([cardNum, count]) => {
                  const card = parseInt(cardNum);
                  return (
                    <Box
                      key={`pile-${index}-${card}`}
                      display='flex'
                      alignItems='center'
                      gap='6px'
                    >
                      <Image
                        src={CardNumberToImage[card]}
                        alt={CardNumberToString[card]}
                        height='65px'
                        objectFit='contain'
                      />
                      <Text fontSize='3xl' color='white' whiteSpace='nowrap'>
                        ×{count}
                      </Text>
                    </Box>
                  );
                })}
            </Box>
          </Box>
        );
      })}

      {/* In-flight claim indicator (no actual card — masking-safe). */}
      {hasLiveClaim && (
        <VStack
          position='absolute'
          top='50%'
          left='50%'
          transform='translate(-50%, -50%)'
          spacing={2}
          zIndex='3'
        >
          <Box
            aspectRatio='6/6'
            backgroundColor='#F3D475'
            borderRadius='md'
            display='flex'
            justifyContent='center'
            alignItems='center'
            boxShadow='0 0 100vw rgba(0,0,0,0.9)'
            animation={`${cardEntrance} 0.6s ease`}
          >
            <Image
              src='/cards/back.png'
              alt='Facedown Card'
              width='90%'
              height='90%'
              objectFit='contain'
              borderRadius='md'
            />
          </Box>
          <Text
            fontSize={['lg', 'xl', '2xl']}
            fontWeight='bold'
            color='white'
            textShadow='0 0 5px black'
            bg='rgba(0,0,0,0.5)'
            px={4}
            py={2}
            borderRadius='md'
          >
            CLAIM IS: {CardNumberToString[currentAction.claim]}
          </Text>
        </VStack>
      )}

      {/* Reveal box, driven by the returnReveal event. */}
      {reveal && (
        <VStack
          position='absolute'
          top='50%'
          left='50%'
          transform='translate(-50%, -50%)'
          spacing={2}
          zIndex='3'
        >
          <Box
            aspectRatio='6/6'
            backgroundColor={reveal.wasCorrect ? '#48BB78' : '#F56565'}
            borderRadius='md'
            display='flex'
            justifyContent='center'
            alignItems='center'
            boxShadow='0 0 100vw rgba(0,0,0,0.9)'
            animation={`${cardEntrance} 0.6s ease`}
            transition='background-color 0.5s ease'
          >
            <Image
              src={CardNumberToImage[reveal.actualCard]}
              alt='Revealed Card'
              width='90%'
              height='90%'
              objectFit='contain'
              borderRadius='md'
            />
          </Box>
          <Text
            fontSize={['lg', 'xl', '2xl']}
            fontWeight='bold'
            color='white'
            textShadow='0 0 5px black'
            bg='rgba(0,0,0,0.5)'
            px={4}
            py={2}
            borderRadius='md'
          >
            ACTUAL CARD: {CardNumberToString[reveal.actualCard]}
          </Text>
          <Text
            fontSize={['md', 'lg', 'xl']}
            fontWeight='bold'
            color='white'
            textShadow='0 0 5px black'
            bg='rgba(0,0,0,0.5)'
            px={4}
            py={1}
            borderRadius='md'
          >
            {getPlayerName(gameRoom.players, reveal.loserUuid)} takes the card
          </Text>
        </VStack>
      )}
    </Box>
  );
};

export default GameTable;
