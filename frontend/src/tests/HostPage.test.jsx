import '@testing-library/jest-dom';
import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import HostPage from '../pages/HostPage.jsx';

const socketHandlers = new Map();

vi.mock('../lib/socket.js', () => ({
  socket: {
    connected: true,
    id: 'socket-1',
    on: vi.fn((event, handler) => socketHandlers.set(event, handler)),
    off: vi.fn(),
    once: vi.fn((event, handler) => {
      if (event === 'connect') handler();
    }),
    emit: vi.fn(),
  },
  bootstrapIdentity: vi.fn(),
  onUserId: vi.fn((handler) => {
    handler('host-user');
    return vi.fn();
  }),
  getMyUserId: vi.fn(() => 'host-user'),
}));

const LocationProbe = () => {
  const location = useLocation();
  return (
    <div data-testid='location'>
      {location.pathname}:{location.state?.roomCode}
    </div>
  );
};

const renderHost = () =>
  render(
    <ChakraProvider>
      <MemoryRouter
        initialEntries={[{ pathname: '/host', state: { roomCode: 'ROOM' } }]}
      >
        <Routes>
          <Route path='/host' element={<HostPage />} />
          <Route path='/play' element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </ChakraProvider>
  );

describe('HostPage', () => {
  test('navigates the host to the playable view when the game starts', async () => {
    renderHost();

    act(() => {
      socketHandlers.get('returnStartGame')('ROOM');
    });

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/play:ROOM');
    });
  });

  test('shows invite and migrate controls for the host', () => {
    renderHost();

    expect(screen.getByLabelText('Copy invite link')).toBeInTheDocument();
    expect(screen.getByLabelText('Copy migration link')).toBeInTheDocument();
  });
});
