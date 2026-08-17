// ===================================================================
// sw.js (Main Service Worker for PWA & Offline Support)
// ===================================================================

const CACHE_NAME = 'khidmety-app-v1';

// الملفات الأساسية اللي بنحتاجها للتشغيل offline
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/favicon.ico',
  '/favicon.svg',
  '/favicon-96x96.png',
  '/web-app-manifest-192x192.png',
  '/web-app-manifest-512x512.png',
  '/apple-touch-icon.png',
  '/site.webmanifest',
];

// ===== Install: خزّن الـ assets الأساسية =====
self.addEventListener('install', (event) => {
  console.log('[SW] Installing and caching core assets...');
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS).catch((err) => {
        console.warn('[SW] Some core assets failed to cache:', err);
      });
    })
  );
});

// ===== Activate: امسح الـ caches القديمة =====
self.addEventListener('activate', (event) => {
  console.log('[SW] Activated. Cleaning old caches...');
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ===== Message: تعليمات من الـ App =====
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ===== Fetch: الاستراتيجية الرئيسية للـ Offline =====
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // تجاهل الطلبات غير الـ HTTP/HTTPS (مثل chrome-extension)
  if (!url.protocol.startsWith('http')) return;

  // تجاهل طلبات Firebase / googleapis / gstatic (دي بتحتاج نت دايمًا)
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('fcm.googleapis.com')
  ) {
    return; // خليها تروح للنت عادي
  }

  // ── Navigation Requests (صفحات الـ SPA) ──────────────────────────
  // لما حد يفتح أي صفحة من جوة التطبيق، ارجع index.html من الـ cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // لو النت موجود، خزن نسخة جديدة من index.html
          if (response && response.status === 200) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', cloned));
          }
          return response;
        })
        .catch(() => {
          // لو مفيش نت، ارجع index.html من الـ cache
          console.log('[SW] Offline: serving index.html from cache for:', url.pathname);
          return caches.match('/index.html');
        })
    );
    return;
  }

  // ── Static Assets (JS, CSS, Images) ──────────────────────────────
  // استراتيجية: Cache First → Network Fallback
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image' ||
    request.destination === 'font' ||
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff|woff2|ttf)$/)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;

        return fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              const cloned = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
            }
            return response;
          })
          .catch(() => {
            console.warn('[SW] Offline: asset not in cache:', url.pathname);
          });
      })
    );
    return;
  }
});

// ===== استيراد Firebase Messaging SW =====
try {
  importScripts('/firebase-messaging-sw.js');
} catch (e) {
  console.error('[SW] Failed to import firebase-messaging-sw.js:', e);
}
