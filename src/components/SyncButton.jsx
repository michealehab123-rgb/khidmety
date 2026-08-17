import { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { waitForPendingWrites } from 'firebase/firestore';
import { RefreshCw, Cloud, CloudOff, Check, AlertCircle } from 'lucide-react';
import { subscribeOfflineQueue, processOfflineQueue } from '../services/offlineQueue';

export default function SyncButton() {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [syncStatus, setSyncStatus] = useState('idle'); // 'idle' | 'syncing' | 'success' | 'error'
    const [queueState, setQueueState] = useState({ isProcessing: false, count: 0 });
    const prevProcessingRef = useRef(false);

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        const unsub = subscribeOfflineQueue((state) => {
            setQueueState(state);

            // If it was processing and now finished with 0 remaining items, show success
            if (prevProcessingRef.current && !state.isProcessing && state.count === 0) {
                setSyncStatus('success');
                setTimeout(() => setSyncStatus('idle'), 5000);
            }
            prevProcessingRef.current = state.isProcessing;
        });

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            if (unsub) unsub();
        };
    }, []);

    const isSyncing = syncStatus === 'syncing' || queueState.isProcessing;

    const handleSync = async () => {
        if (!isOnline || isSyncing) return;
        setSyncStatus('syncing');

        try {
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 25000)
            );

            await Promise.race([
                Promise.all([
                    waitForPendingWrites(db),
                    processOfflineQueue()
                ]),
                timeoutPromise
            ]);

            setSyncStatus('success');
            setTimeout(() => setSyncStatus('idle'), 5000);
        } catch (error) {
            console.error('Sync failed:', error);
            setSyncStatus('error');
            setTimeout(() => setSyncStatus('idle'), 4000);
        }
    };

    const getTooltipText = () => {
        if (!isOnline) {
            return queueState.count > 0 
                ? `أنت غير متصل - في انتظار رفع ${queueState.count} صورة عند توفر الاتصال`
                : 'أنت غير متصل - سيتم الحفظ تلقائياً عند الاتصال';
        }
        if (isSyncing) {
            return queueState.count > 0
                ? `جاري رفع ومزامنة ${queueState.count} صورة مع السيرفر...`
                : 'جاري مزامنة البيانات مع السيرفر...';
        }
        if (syncStatus === 'success') {
            return 'تمت مزامنة جميع البيانات والصور بنجاح! ✅';
        }
        if (syncStatus === 'error') {
            return 'فشلت المزامنة أو انتهت المهلة. حاول مجدداً';
        }
        if (queueState.count > 0) {
            return `يوجد ${queueState.count} صورة بانتظار الرفع (اضغط للمزامنة)`;
        }
        return 'تحقق من مزامنة البيانات والصور مع السيرفر';
    };

    return (
        <button
            onClick={handleSync}
            disabled={!isOnline || isSyncing}
            className={`p-2.5 rounded-xl transition-all duration-300 flex items-center justify-center border border-transparent relative group cursor-pointer
                ${!isOnline 
                    ? 'text-amber-500 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 hover:border-amber-200 dark:hover:border-amber-800' 
                    : syncStatus === 'success'
                        ? 'text-emerald-500 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 hover:border-emerald-200 dark:hover:border-emerald-800'
                        : syncStatus === 'error'
                            ? 'text-rose-500 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 hover:border-rose-200 dark:hover:border-rose-800'
                            : isSyncing
                                ? 'text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 hover:border-blue-200 dark:hover:border-blue-800'
                                : queueState.count > 0
                                    ? 'text-amber-500 dark:text-amber-400 bg-amber-50/70 dark:bg-amber-950/20 hover:border-amber-200 dark:hover:border-amber-800'
                                    : 'text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-200 dark:hover:border-slate-700'
                }`}
            aria-label="Sync Database and Images"
        >
            {!isOnline ? (
                <CloudOff size={18} className="animate-pulse" />
            ) : isSyncing ? (
                <RefreshCw size={18} className="animate-spin text-blue-500 dark:text-blue-400" />
            ) : syncStatus === 'success' ? (
                <Check size={18} className="scale-110 transition-transform font-bold text-emerald-500 dark:text-emerald-400" />
            ) : syncStatus === 'error' ? (
                <AlertCircle size={18} />
            ) : (
                <Cloud size={18} />
            )}

            {/* Badge for pending tasks when offline or idle */}
            {queueState.count > 0 && !isSyncing && syncStatus !== 'success' && (
                <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center shadow-sm">
                    {queueState.count}
                </span>
            )}

            {/* Tooltip */}
            <span className="pointer-events-none absolute top-full mt-2 hidden group-hover:block bg-slate-900/95 dark:bg-slate-800/95 text-white text-[11px] py-1.5 px-2.5 rounded-lg shadow-md whitespace-nowrap z-50 animate-in fade-in slide-in-from-top-1">
                {getTooltipText()}
            </span>
        </button>
    );
}
