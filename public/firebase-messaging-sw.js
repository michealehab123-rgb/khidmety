// ===================================================================
// firebase-messaging-sw.js
// Service Worker مخصص لاستقبال إشعارات Firebase في الخلفية (Background Push)
// ===================================================================

// استخدام نفس نسخة Firebase المستخدمة في المشروع (compat mode لازم في SW)
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyD5j3-Gvs3fBkbkFCQypFQ4uZBB3nhAWeI",
  authDomain: "sunday-school-1ecad.firebaseapp.com",
  projectId: "sunday-school-1ecad",
  storageBucket: "sunday-school-1ecad.firebasestorage.app",
  messagingSenderId: "226413393015",
  appId: "1:226413393015:web:c6dde83def51958b748272",
  measurementId: "G-FVZGB50RKS"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// ===== استقبال الإشعارات في الخلفية (لما الأبليكيشن مقفول أو في الخلفية) =====
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM SW] Background message received:', payload);

  // نقوم دائماً بعرض الإشعار يدوياً لضمان تشغيل الأيكونة وتوجيه المستخدم عند الضغط
  const notificationTitle = payload.data?.title || payload.notification?.title || 'إشعار جديد';
  const notificationOptions = {
    body: payload.data?.body || payload.notification?.body || '',
    icon: '/web-app-manifest-192x192.png',
    badge: '/favicon-96x96.png',
    tag: payload.data?.tag || `msg-${Date.now()}`,
    data: payload.data || {},
    requireInteraction: false,
    vibrate: [200, 100, 200],
    actions: [
      { action: 'open', title: 'فتح التطبيق' }
    ]
  };
  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// ===== التعامل مع click على الإشعار =====
self.addEventListener('notificationclick', (event) => {
  console.log('[FCM SW] Notification click received:', event);
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // لو التطبيق مفتوح بالفعل، بنعمله focus
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      // لو مش مفتوح، بنفتحه
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// ===== تثبيت الـ Service Worker فوراً بدون انتظار =====
self.addEventListener('install', (event) => {
  console.log('[FCM SW] Service Worker installed.');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[FCM SW] Service Worker activated.');
  event.waitUntil(clients.claim());
});