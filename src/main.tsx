import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import '@fontsource/dm-serif-display/400.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import './index.css';
import { registerServiceWorkerUpdates } from './pwa/update-coordinator';

createRoot(document.getElementById('root')!).render(<App />);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    registerServiceWorkerUpdates().catch(() => {
      // Offline support is optional; registration failure must not block rendering.
    });
  });
}
