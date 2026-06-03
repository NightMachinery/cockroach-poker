import {
  Box,
  HStack,
  VStack,
  Text,
  Badge,
  Avatar,
  Wrap,
  WrapItem,
  Button,
  Tooltip,
} from '@chakra-ui/react';
import { FiArrowUp, FiArrowDown, FiEye, FiEyeOff } from 'react-icons/fi';
import { socket } from '../lib/socket.js';
import MigrateDeviceButton from './MigrateDeviceButton.jsx';

const ROLE_BADGE = {
  creator: { label: 'Owner', colorScheme: 'purple' },
  mod: { label: 'Mod', colorScheme: 'blue' },
  temp_mod: { label: 'Temp Mod', colorScheme: 'cyan' },
  observer: { label: 'Observer', colorScheme: 'gray' },
  player: null,
};

const MOD_POWER = ['creator', 'mod', 'temp_mod'];

const avatarSrc = (icon) =>
  icon ? `/avatars/${icon}.png` : '/avatars/default.png';

// Renders the room's players with role badges, self-highlight, and (for mods)
// per-player controls. `me` is the current user's userId.
export default function PlayerList({ room, me, compact = false }) {
  if (!room) return null;
  const players = room.players || [];
  const mePlayer = players.find((p) => p.userId === me);
  const iAmMod = !!mePlayer && MOD_POWER.includes(mePlayer.role);
  const iAmCreator = !!mePlayer && mePlayer.role === 'creator';

  const setRole = (targetUserId, newRole) =>
    socket.emit('requestSetRole', room.roomCode, targetUserId, newRole);
  const setObserver = (targetUserId, observe) =>
    socket.emit('requestSetObserver', room.roomCode, targetUserId, observe);

  return (
    <VStack align='stretch' spacing={2} width='100%'>
      {players.map((p) => {
        const isSelf = p.userId === me;
        const badge = ROLE_BADGE[p.role];
        const isObserver = p.role === 'observer';
        const targetIsMod = MOD_POWER.includes(p.role);
        const targetIsCreator = p.role === 'creator';

        // Can the current actor demote this target?
        const canDemote =
          iAmMod &&
          targetIsMod &&
          !targetIsCreator &&
          (iAmCreator || p.promotedBy === me);
        // Can promote a plain (non-mod, non-observer) player to mod?
        const canPromote = iAmMod && p.role === 'player';

        return (
          <Box
            key={p.userId}
            p={2}
            borderRadius='md'
            border='2px solid'
            borderColor={isSelf ? 'teal.400' : 'gray.200'}
            bg={isSelf ? 'teal.50' : 'white'}
            boxShadow={isSelf ? '0 0 0 2px rgba(56,178,172,0.4)' : 'none'}
            opacity={isObserver ? 0.7 : 1}
          >
            <HStack justify='space-between' align='center'>
              <HStack spacing={3} minW={0}>
                <Avatar size='sm' src={avatarSrc(p.playerIcon)} name={p.nickname} />
                <Box minW={0}>
                  <HStack spacing={2}>
                    <Text fontWeight='bold' color='#264653' noOfLines={1}>
                      {p.displayName}
                    </Text>
                    {isSelf && (
                      <Text as='span' fontSize='sm' color='teal.600' fontWeight='semibold'>
                        (you)
                      </Text>
                    )}
                    {!p.online && (
                      <Badge colorScheme='red' variant='subtle'>
                        offline
                      </Badge>
                    )}
                  </HStack>
                  {badge && (
                    <Badge
                      colorScheme={badge.colorScheme}
                      variant={p.role === 'temp_mod' ? 'outline' : 'solid'}
                      mt={0.5}
                    >
                      {badge.label}
                    </Badge>
                  )}
                </Box>
              </HStack>

              {!compact && (
                <Wrap spacing={1} justify='flex-end' shouldWrapChildren>
                  {/* Self observer self-service */}
                  {isSelf && !targetIsCreator && (
                    <WrapItem>
                      <Tooltip
                        label={isObserver ? 'Rejoin the game' : 'Become an observer'}
                        hasArrow
                      >
                        <Button
                          size='xs'
                          leftIcon={isObserver ? <FiEye /> : <FiEyeOff />}
                          variant='outline'
                          colorScheme='orange'
                          onClick={() => setObserver(p.userId, !isObserver)}
                        >
                          {isObserver ? 'Rejoin' : 'Observe'}
                        </Button>
                      </Tooltip>
                    </WrapItem>
                  )}

                  {/* Mod controls on others */}
                  {iAmMod && !isSelf && (
                    <>
                      {canPromote && (
                        <WrapItem>
                          <Tooltip label='Promote to mod' hasArrow>
                            <Button
                              size='xs'
                              leftIcon={<FiArrowUp />}
                              variant='ghost'
                              colorScheme='blue'
                              onClick={() => setRole(p.userId, 'mod')}
                            >
                              Mod
                            </Button>
                          </Tooltip>
                        </WrapItem>
                      )}
                      {canDemote && (
                        <WrapItem>
                          <Tooltip label='Demote to player' hasArrow>
                            <Button
                              size='xs'
                              leftIcon={<FiArrowDown />}
                              variant='ghost'
                              colorScheme='gray'
                              onClick={() => setRole(p.userId, 'player')}
                            >
                              Demote
                            </Button>
                          </Tooltip>
                        </WrapItem>
                      )}
                      {!targetIsCreator && (
                        <WrapItem>
                          <Tooltip
                            label={isObserver ? 'Bring back to game' : 'Make observer'}
                            hasArrow
                          >
                            <Button
                              size='xs'
                              leftIcon={isObserver ? <FiEye /> : <FiEyeOff />}
                              variant='ghost'
                              colorScheme='orange'
                              onClick={() => setObserver(p.userId, !isObserver)}
                            >
                              {isObserver ? 'Unobserve' : 'Observe'}
                            </Button>
                          </Tooltip>
                        </WrapItem>
                      )}
                      <WrapItem>
                        <MigrateDeviceButton
                          roomCode={room.roomCode}
                          targetUserId={p.userId}
                          iconOnly
                        />
                      </WrapItem>
                    </>
                  )}
                </Wrap>
              )}
            </HStack>
          </Box>
        );
      })}
    </VStack>
  );
}
