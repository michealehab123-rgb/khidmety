import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'fs';
import path from 'path';

const currentBuildTime = Date.now();

// Plugin لتوليد version.json تلقائياً في المجلد العام (public) عند كل Build
function generateVersionJsonPlugin() {
  return {
    name: 'generate-version-json',
    buildStart() {
      try {
        const publicDir = path.resolve(__dirname, 'public');
        if (!fs.existsSync(publicDir)) {
          fs.mkdirSync(publicDir, { recursive: true });
        }
        const versionPath = path.join(publicDir, 'version.json');
        fs.writeFileSync(
          versionPath,
          JSON.stringify({
            buildTime: currentBuildTime,
            dateStr: new Date(currentBuildTime).toLocaleString('ar-EG')
          }, null, 2)
        );
        console.log(`[VersionPlugin] Generated version.json with buildTime: ${currentBuildTime}`);
      } catch (err) {
        console.error('[VersionPlugin] Error generating version.json:', err);
      }
    }
  };
}

export default defineConfig({
  define: {
    __APP_BUILD_TIME__: JSON.stringify(currentBuildTime)
  },
  plugins: [
    react(),
    generateVersionJsonPlugin(),
    VitePWA({
      // ⚠️ مهم: نستخدم 'prompt' مش 'autoUpdate' عشان نتحكم يدوياً في الـ SW
      // وعشان firebase-messaging-sw.js يشتغل بدون تعارض
      registerType: 'prompt',
      
      // 🔑 نقول للـ VitePWA إن في SW خارجي خاص بـ Firebase - ومتحكمش فيه
      // الـ PWA SW بيتولى الـ caching بس، والـ Firebase SW بيتولى الـ push
      injectRegister: null, // منعمل autoRegister للـ sw.js - هنعمل ده يدوياً في main.jsx
      
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // الإشعارات دي بتتم عن طريق firebase-messaging-sw.js مش هنا
        // هنا بنعمل caching للملفات الأساسية بس
        runtimeCaching: [],
        // تمكين التشغيل أوفلاين للصفحات وتحميل index.html
        navigateFallback: '/index.html',
        importScripts: ['/firebase-messaging-sw.js'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      },
      
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'favicon.svg', 'favicon-96x96.png'],
      manifest: {
        name: 'Khidmety',
        short_name: 'Khidmety',
        description: 'An integrated system for managing Sunday school attendance, visitation tracking, points, and rewards dynamically.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        dir: 'rtl',
        icons: [
          {
            src: 'favicon-96x96.png',
            sizes: '96x96',
            type: 'image/png'
          },
          {
            src: 'web-app-manifest-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'web-app-manifest-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'web-app-manifest-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  server: {
    watch: {
      ignored: ['**/android/**']
    }
  }
});