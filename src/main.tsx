import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Studio } from './studio/Studio';
import './studio/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Studio />
  </StrictMode>
);
