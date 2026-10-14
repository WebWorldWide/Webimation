import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts ship with the app so graphics render identically offline.
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import { Studio } from './studio/Studio';
import './studio/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Studio />
  </StrictMode>
);
