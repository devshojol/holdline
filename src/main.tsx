import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './app/App';
import { keepServerAwake } from './multiplayer/client';
import { startCrazyGamesRooms } from './multiplayer/crazygamesRooms';
import { crazyGames } from './platform/crazygames';

// start their SDK as the page loads, so their site sees it at once (a no-op outside CrazyGames)
void crazyGames.ready();
keepServerAwake();
void startCrazyGamesRooms();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
