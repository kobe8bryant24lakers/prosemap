import { getLocale } from '../lib/i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import '../app/globals.css';

const root = document.getElementById('root');
if (!root) throw new Error('Desktop root element is missing');

document.documentElement.lang = getLocale();

createRoot(root).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
