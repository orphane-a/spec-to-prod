import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Garde } from './composants/Connexion';
import './styles.css';

createRoot(document.getElementById('racine')!).render(
  <StrictMode>
    <Garde>
      <App />
    </Garde>
  </StrictMode>,
);
