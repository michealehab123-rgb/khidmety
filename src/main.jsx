import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// ✅ تسجيل sw.js الخاص بالـ PWA والذي يستورد داخلياً firebase-messaging-sw.js
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .then((registration) => {
      console.log('[SW] sw.js registered successfully:', registration.scope);
    })
    .catch((err) => {
      console.error('[SW] Failed to register sw.js:', err);
    });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)