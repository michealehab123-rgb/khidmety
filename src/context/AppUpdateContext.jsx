import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

// Get compile-time build timestamp injected by Vite
const APP_BUILD_TIME = typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : 0;

const AppUpdateContext = createContext({
    hasUpdate: false,
    isUpdating: false,
    triggerUpdate: () => {},
    checkForUpdates: () => {},
    appBuildTime: APP_BUILD_TIME
});

export const AppUpdateProvider = ({ children }) => {
    const [hasUpdate, setHasUpdate] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const serverBuildTimeRef = useRef(0);

    // Check version.json on server
    const checkForUpdates = useCallback(async () => {
        try {
            const installedBuildTime = parseInt(localStorage.getItem('installedBuildTime') || '0', 10);
            const lastUpdatedTime = parseInt(localStorage.getItem('lastUpdatedActionTime') || '0', 10);
            
            // If user clicked update within the last 30 seconds, suppress update prompts to allow fresh load
            if (Date.now() - lastUpdatedTime < 30 * 1000) {
                setHasUpdate(false);
                return;
            }

            const effectiveLocalBuildTime = Math.max(APP_BUILD_TIME, installedBuildTime);

            const response = await fetch(`/version.json?t=${Date.now()}`, {
                headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data && data.buildTime) {
                    serverBuildTimeRef.current = data.buildTime;
                    
                    // Only set update if server buildTime is strictly newer than what user has installed
                    if (data.buildTime > effectiveLocalBuildTime) {
                        console.log('[UpdateCheck] New build available! Server:', data.buildTime, 'Installed/Local:', effectiveLocalBuildTime);
                        setHasUpdate(true);
                    } else {
                        setHasUpdate(false);
                    }
                }
            }
        } catch (err) {
            console.warn('[UpdateCheck] Failed to fetch version.json:', err);
        }
    }, []);

    useEffect(() => {
        // Initial check on mount
        checkForUpdates();

        // Check when window gains focus
        const handleFocus = () => checkForUpdates();
        window.addEventListener('focus', handleFocus);

        // Check periodically every 3 minutes
        const interval = setInterval(checkForUpdates, 3 * 60 * 1000);

        // When SW signals update available, trigger a clean version check
        const handleSwUpdate = () => {
            console.log('[UpdateCheck] SW update event received -> re-checking version...');
            checkForUpdates();
        };
        window.addEventListener('swUpdateAvailable', handleSwUpdate);

        return () => {
            window.removeEventListener('focus', handleFocus);
            clearInterval(interval);
            window.removeEventListener('swUpdateAvailable', handleSwUpdate);
        };
    }, [checkForUpdates]);

    const triggerUpdate = async () => {
        setIsUpdating(true);
        try {
            const timeToSave = serverBuildTimeRef.current || Date.now();
            localStorage.setItem('installedBuildTime', timeToSave.toString());
            localStorage.setItem('lastUpdatedActionTime', Date.now().toString());

            // 1. Clear all PWA & browser CacheStorage
            if ('caches' in window) {
                const cacheNames = await caches.keys();
                await Promise.all(cacheNames.map(name => caches.delete(name)));
            }

            // 2. Unregister Service Workers to ensure fresh controller load
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (const registration of registrations) {
                    if (registration.waiting) {
                        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                    }
                    await registration.unregister().catch(() => {});
                }
            }
        } catch (e) {
            console.error('Error during app update cache clearing:', e);
        } finally {
            setHasUpdate(false);
            // 3. Force reload window with clean URL
            const cleanUrl = window.location.origin + window.location.pathname;
            window.location.href = cleanUrl + '?v=' + Date.now();
        }
    };

    return (
        <AppUpdateContext.Provider value={{
            hasUpdate,
            isUpdating,
            triggerUpdate,
            checkForUpdates,
            appBuildTime: APP_BUILD_TIME
        }}>
            {children}
        </AppUpdateContext.Provider>
    );
};

export const useAppUpdate = () => useContext(AppUpdateContext);
