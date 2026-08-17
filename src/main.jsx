import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AppUpdateProvider } from './context/AppUpdateContext.jsx'

// ✅ تسجيل sw.js الخاص بالـ PWA مع تتبع التحديثات الجاهزة
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .then((registration) => {
      console.log('[SW] sw.js registered successfully:', registration.scope);

      // إذا كان هناك Service Worker في حالة الانتظار والتطبيق يعمل بشرط وجود controller نشط سابقاً
      if (registration.waiting && navigator.serviceWorker.controller) {
        window.dispatchEvent(new Event('swUpdateAvailable'));
      }

      // الاستماع لوجود تحديث جديد أثناء تشغيل التطبيق
      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (installingWorker) {
          installingWorker.onstatechange = () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[SW] New version available!');
              window.dispatchEvent(new Event('swUpdateAvailable'));
            }
          };
        }
      };
    })
    .catch((err) => {
      console.error('[SW] Failed to register sw.js:', err);
    });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppUpdateProvider>
      <App />
    </AppUpdateProvider>
  </StrictMode>,
)