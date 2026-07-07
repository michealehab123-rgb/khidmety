import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { waitForPendingWrites } from 'firebase/firestore';
import { RefreshCw, Cloud, CloudOff, Check, AlertCircle } from 'lucide-react';

export default function SyncButton() {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [syncStatus, setSyncStatus] = useState('idle'); // 'idle' | 'syncing' | 'success' | 'error'

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    const handleSync = async () => {
        if (!isOnline || syncStatus === 'syncing') return;
        setSyncStatus('syncing');

        try {
            // مهلة زمنية قدرها 10 ثوانٍ لمنع التعليق اللانهائي
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), 10000)
            );

            await Promise.race([
                waitForPendingWrites(db),
                timeoutPromise
            ]);

            setSyncStatus('success');
            // إبقاء علامة الصح الخضراء لمدة 5 ثوانٍ بناءً على طلب المستخدم
            setTimeout(() => setSyncStatus('idle'), 5000);
        } catch (error) {
            console.error('Sync failed:', error);
            setSyncStatus('error');
            setTimeout(() => setSyncStatus('idle'), 4000);
        }
    };

    const getTooltipText = () => {
        if (!isOnline) return 'أنت غير متصل - سيتم الحفظ تلقائياً عند الاتصال';
        switch (syncStatus) {
            case 'syncing': return 'جاري مزامنة البيانات مع السيرفر...';
            case 'success': return 'تمت مزامنة جميع البيانات بنجاح!';
            case 'error': return 'فشلت المزامنة أو انتهت المهلة. حاول مجدداً';
            default: return 'تحقق من مزامنة البيانات مع السيرفر';
        }
    };

    return (
        <button
            onClick={handleSync}
            disabled={!isOnline || syncStatus === 'syncing'}
            className={`p-2.5 rounded-xl transition-all duration-300 flex items-center justify-center border border-transparent relative group cursor-pointer
                ${!isOnline 
                    ? 'text-amber-500 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 hover:border-amber-200 dark:hover:border-amber-800' 
                    : syncStatus === 'success'
                        ? 'text-emerald-500 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 hover:border-emerald-200 dark:hover:border-emerald-800'
                        : syncStatus === 'error'
                            ? 'text-rose-500 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 hover:border-rose-200 dark:hover:border-rose-800'
                            : 'text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-200 dark:hover:border-slate-700'
                }`}
            aria-label="Sync Database"
        >
            {!isOnline ? (
                <CloudOff size={18} className="animate-pulse" />
            ) : syncStatus === 'syncing' ? (
                <RefreshCw size={18} className="animate-spin text-blue-500 dark:text-blue-400" />
            ) : syncStatus === 'success' ? (
                <Check size={18} className="scale-110 transition-transform font-bold" />
            ) : syncStatus === 'error' ? (
                <AlertCircle size={18} />
            ) : (
                <Cloud size={18} />
            )}

            {/* Tooltip */}
            <span className="pointer-events-none absolute top-full mt-2 hidden group-hover:block bg-slate-900/95 dark:bg-slate-800/95 text-white text-[11px] py-1.5 px-2.5 rounded-lg shadow-md whitespace-nowrap z-50 animate-in fade-in slide-in-from-top-1">
                {getTooltipText()}
            </span>
        </button>
    );
}
