// pages/Credits.jsx
import {
  Box,
  Heading,
  VStack,
  Text,
  Link,
  Container,
} from '@chakra-ui/react';

const Credits = () => {
  return (
    <Container maxW='container.md' py={10}>
      <Heading mb={6}>Credits</Heading>

      {/* Assets */}
      <Heading size='md' mt={4} mb={2}>
        Assets
      </Heading>
      <VStack align='start'>
        <Text>Card designs by Lindsey Seay</Text>
        <Text>
          Avatars by{' '}
          <Link href='https://icons8.com/' color='teal.500' isExternal>
            Icons8↗
          </Link>
        </Text>
        <Text>
          <strong>"Justice"</strong> by <em>Sonda</em>
        </Text>
        <Text>
          <strong>"Drives Me Nuts"</strong> by <em>A.T.M.</em>
        </Text>
        <Text>
          <strong>"Funk in the Trunk"</strong> by <em>Trinity</em>
        </Text>
      </VStack>

      <Heading size='md' mt={6} mb={2}>
        Built With
      </Heading>
      <VStack align='start' spacing={2}>
        <Text>
          <Link href='https://chakra-ui.com/' isExternal color='teal.500'>
            Chakra UI↗
          </Link>{' '}
          – Component styling
        </Text>
        <Text>
          <Link href='https://reactjs.org/' isExternal color='teal.500'>
            React↗
          </Link>{' '}
          – UI library
        </Text>
        <Text>
          <Link href='https://socket.io/' isExternal color='teal.500'>
            Socket.IO↗
          </Link>{' '}
          – Real-time multiplayer
        </Text>
        <Text>
          <Link href='https://vitejs.dev/' isExternal color='teal.500'>
            Vite↗
          </Link>{' '}
          – Development & build tool
        </Text>
        <Text>
          <Link href='https://vitest.dev/' isExternal color='teal.500'>
            Vitest↗
          </Link>{' '}
          – Testing framework
        </Text>
      </VStack>

      <Heading size='md' mt={6} mb={2}>
        About the Game
      </Heading>
      <VStack align='start' spacing={2}>
        <Text>
          Cockroach Poker is a bluffing card game by Drei Magier Spiele.
          This is an unofficial online implementation for educational purposes.
        </Text>
      </VStack>
    </Container>
  );
};

export default Credits;
