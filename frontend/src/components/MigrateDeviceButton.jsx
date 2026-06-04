import { Button, IconButton, useToast, Tooltip } from '@chakra-ui/react';
import { FiSmartphone } from 'react-icons/fi';
import { useEffect, useRef } from 'react';
import { socket } from '../lib/socket.js';
import { buildMigrateLink } from '../lib/identity.js';
import { copyText } from '../lib/clipboard.js';

// Requests a room-scoped migrate link for `targetUserId` and copies it.
// - iconOnly: compact SVG-icon button (used by mods next to each player).
// - otherwise: a labeled button (used by a user for their own device).
//
// The migrate link carries a room-specific opaque id (no real auth token), so
// opening it on another device adopts that player's identity for the room.
export default function MigrateDeviceButton({
  roomCode,
  targetUserId,
  iconOnly = false,
  label = 'Migrate device',
  ...rest
}) {
  const toast = useToast();
  const pending = useRef(false);

  useEffect(() => {
    const onLink = async ({ roomCode: rc, targetUserId: tid, migrateId, displayName }) => {
      if (!pending.current || tid !== targetUserId || rc !== roomCode) return;
      pending.current = false;
      const link = buildMigrateLink(rc, migrateId);
      const ok = await copyText(link);
      toast({
        title: ok ? `Migration link copied${displayName ? ` for ${displayName}` : ''}` : 'Could not copy link',
        description: link,
        status: ok ? 'success' : 'error',
        duration: 5000,
        isClosable: true,
      });
    };
    const onErr = (msg) => {
      if (!pending.current) return;
      pending.current = false;
      toast({ title: msg || 'Action failed', status: 'error', duration: 3000, isClosable: true });
    };
    socket.on('returnMigrateLink', onLink);
    socket.on('actionError', onErr);
    return () => {
      socket.off('returnMigrateLink', onLink);
      socket.off('actionError', onErr);
    };
  }, [roomCode, targetUserId, toast]);

  const handleClick = () => {
    pending.current = true;
    socket.emit('requestMigrateLink', roomCode, targetUserId);
  };

  if (iconOnly) {
    return (
      <Tooltip label='Copy migration link' hasArrow>
        <IconButton
          aria-label='Copy migration link'
          icon={<FiSmartphone />}
          size='sm'
          variant='solid'
          bg='#E9C46A'
          color='#264653'
          boxShadow='md'
          _hover={{ bg: '#E76F51', color: 'white' }}
          onClick={handleClick}
          {...rest}
        />
      </Tooltip>
    );
  }

  return (
    <Button
      leftIcon={<FiSmartphone />}
      size='sm'
      variant='outline'
      colorScheme='teal'
      onClick={handleClick}
      {...rest}
    >
      {label}
    </Button>
  );
}
