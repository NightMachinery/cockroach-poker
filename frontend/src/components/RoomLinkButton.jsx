import { Button, IconButton, Tooltip, useToast } from '@chakra-ui/react';
import { FiClipboard, FiCheck } from 'react-icons/fi';
import { useState } from 'react';
import { buildRoomLink } from '../lib/identity.js';
import { copyText } from '../lib/clipboard.js';

// Copies an auto-join link for the room. The link opens the app with
// ?room=CODE, which auto-joins the visitor.
// - iconOnly: compact circular clipboard-icon button (used in the top corner).
// - otherwise: a labeled pill button.
export default function RoomLinkButton({
  roomCode,
  size = 'md',
  iconOnly = false,
  ...rest
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const link = buildRoomLink(roomCode);
    const ok = await copyText(link);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast({
        title: 'Invite link copied!',
        description: link,
        status: 'success',
        duration: 3000,
        isClosable: true,
      });
    } else {
      toast({
        title: 'Could not copy',
        description: link,
        status: 'error',
        duration: 4000,
        isClosable: true,
      });
    }
  };

  if (iconOnly) {
    return (
      <Tooltip label='Copy invite link' hasArrow>
        <IconButton
          aria-label='Copy invite link'
          icon={copied ? <FiCheck /> : <FiClipboard />}
          onClick={handleCopy}
          size={size}
          isRound
          bg='#E9C46A'
          color='#264653'
          boxShadow='md'
          _hover={{ bg: '#E76F51', color: 'white' }}
          {...rest}
        />
      </Tooltip>
    );
  }

  return (
    <Button
      onClick={handleCopy}
      leftIcon={copied ? <FiCheck /> : <FiClipboard />}
      size={size}
      bg='#E9C46A'
      color='#264653'
      fontWeight='bold'
      boxShadow='md'
      borderRadius='full'
      _hover={{ bg: '#E76F51', color: 'white', transform: 'translateY(-1px)' }}
      _active={{ transform: 'translateY(0)' }}
      transition='all 0.15s'
      {...rest}
    >
      {copied ? 'Copied!' : 'Copy invite link'}
    </Button>
  );
}
