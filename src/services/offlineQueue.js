import { doc, updateDoc, getDoc, db } from '../firebase';

const DB_NAME = 'SundaySchoolOfflineQueueDB';
const STORE_NAME = 'pending_image_uploads';
const DB_VERSION = 1;
const IMGBB_API_KEY = '5b981ef8e6073a4244e0fd1a51cf5876';

function openDB() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB is not supported'));
            return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

// ── Queue Subscription / Event Listener Mechanism ──────────────────────────
const queueListeners = new Set();
let isProcessing = false;
let pendingRetry = false;

async function notifyQueueListeners() {
    try {
        const tasks = await getPendingImageTasks();
        const count = tasks ? tasks.length : 0;
        const state = { isProcessing, count };
        queueListeners.forEach(cb => {
            try { cb(state); } catch (e) { console.error('Queue listener error:', e); }
        });
    } catch (err) {
        console.error('Error notifying queue listeners:', err);
    }
}

export function subscribeOfflineQueue(callback) {
    if (typeof callback !== 'function') return () => {};
    queueListeners.add(callback);
    // Initial call
    getPendingImageTasks().then(tasks => {
        try {
            callback({ isProcessing, count: tasks ? tasks.length : 0 });
        } catch (e) {
            console.error('Initial queue callback error:', e);
        }
    });
    return () => {
        queueListeners.delete(callback);
    };
}

export async function getPendingImageTasksCount() {
    try {
        const tasks = await getPendingImageTasks();
        return tasks ? tasks.length : 0;
    } catch {
        return 0;
    }
}

export function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export function createThumbnailDataURL(file, maxWidth = 800, maxHeight = 800, quality = 0.85) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > maxWidth) {
                            height = Math.round((height * maxWidth) / width);
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width = Math.round((width * maxHeight) / height);
                            height = maxHeight;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    const thumbDataUrl = canvas.toDataURL('image/jpeg', quality);
                    resolve(thumbDataUrl);
                } catch (err) {
                    console.warn('Thumbnail generation failed, using raw dataUrl fallback:', err);
                    resolve(e.target.result);
                }
            };
            img.onerror = () => resolve(e.target.result);
            img.src = e.target.result;
        };
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
    });
}

export function dataURLtoBlob(dataurl) {
    const arr = dataurl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
}

export async function addPendingImageTask({ productId, file, tempUrlIndex }) {
    try {
        const db = await openDB();
        const dataUrl = await fileToDataURL(file);
        const task = {
            id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            productId,
            fileDataUrl: dataUrl,
            fileName: file.name || 'product_image.jpg',
            fileType: file.type || 'image/jpeg',
            tempUrlIndex,
            createdAt: new Date().toISOString()
        };

        const savedTask = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.put(task);
            req.onsuccess = () => resolve(task);
            req.onerror = (e) => reject(e.target.error);
        });

        notifyQueueListeners();
        return savedTask;
    } catch (err) {
        console.error('Error adding pending image task to IndexedDB:', err);
        return null;
    }
}

export async function getPendingImageTasks() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = (e) => reject(e.target.error);
        });
    } catch (err) {
        console.error('Error fetching pending tasks from IndexedDB:', err);
        return [];
    }
}

export async function deletePendingImageTask(id) {
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.delete(id);
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e.target.error);
        });
        notifyQueueListeners();
    } catch (err) {
        console.error('Error deleting pending image task:', err);
    }
}

export async function processOfflineQueue() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    if (isProcessing) {
        pendingRetry = true;
        return;
    }

    isProcessing = true;
    pendingRetry = false;
    notifyQueueListeners();

    try {
        const tasks = await getPendingImageTasks();
        if (!tasks || tasks.length === 0) return;

        console.log(`🔄 Processing ${tasks.length} offline image upload task(s)...`);

        for (const task of tasks) {
            try {
                const blob = dataURLtoBlob(task.fileDataUrl);
                const fd = new FormData();
                fd.append('image', blob, task.fileName || 'image.jpg');

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 60000);

                const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
                    method: 'POST',
                    body: fd,
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                const resData = await response.json();

                if (resData?.data?.url) {
                    const permanentUrl = resData.data.url;
                    const productRef = doc(db, 'products', task.productId);

                    const freshSnap = await getDoc(productRef);
                    if (freshSnap.exists()) {
                        const freshImages = [...(freshSnap.data().images || [])];

                        const thumbIdx = freshImages.findIndex(
                            img => typeof img === 'string' && img.startsWith('data:')
                        );
                        if (thumbIdx !== -1) {
                            freshImages[thumbIdx] = permanentUrl;
                        } else if (
                            typeof task.tempUrlIndex === 'number' &&
                            freshImages[task.tempUrlIndex] !== undefined
                        ) {
                            freshImages[task.tempUrlIndex] = permanentUrl;
                        } else {
                            freshImages.push(permanentUrl);
                        }

                        const stillHasPendingThumbs = freshImages.some(
                            img => typeof img === 'string' && img.startsWith('data:')
                        );

                        await updateDoc(productRef, {
                            images: freshImages,
                            pendingUpload: stillHasPendingThumbs,
                            recentlySyncedAt: stillHasPendingThumbs ? null : new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        });

                        console.log(`✅ Uploaded & synced! product=${task.productId}`);
                    }

                    await deletePendingImageTask(task.id);
                } else {
                    console.error('ImgBB upload error:', resData);
                }
            } catch (taskErr) {
                console.error(`Task ${task.id} failed:`, taskErr);
            }
        }
    } catch (err) {
        console.error('processOfflineQueue error:', err);
    } finally {
        isProcessing = false;
        notifyQueueListeners();
        if (pendingRetry) {
            pendingRetry = false;
            setTimeout(() => processOfflineQueue(), 500);
        }
    }
}

export function initOfflineQueueListener() {
    if (typeof window === 'undefined') return () => {};

    const handleOnline = () => {
        console.log('🌐 Network online detected! Triggering image upload queue...');
        processOfflineQueue();
    };

    window.addEventListener('online', handleOnline);

    if (navigator.onLine) {
        processOfflineQueue();
    }

    return () => {
        window.removeEventListener('online', handleOnline);
    };
}
