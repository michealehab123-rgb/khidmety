import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  db, 
  collection, 
  query, 
  orderBy, 
  onSnapshot 
} from '../firebase';
import { 
  X, 
  Bell, 
  Loader2, 
  Calendar, 
  User 
} from 'lucide-react';

export default function NotificationModal({ isOpen, onClose }) {
  const { servant, student, isGeneralAdmin, isServant, isStudent } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);
  
  const currentUserId = servant?.id || student?.id || 'admin';
  const [deletedIds, setDeletedIds] = useState([]);

  // Load deleted notifications on mount or user change
  useEffect(() => {
    if (currentUserId) {
      try {
        const list = localStorage.getItem(`deletedNotifications_${currentUserId}`);
        setDeletedIds(list ? JSON.parse(list) : []);
      } catch (e) {
        setDeletedIds([]);
      }
    }
  }, [currentUserId]);

  const handleDeleteNotification = (id) => {
    const updated = [...deletedIds, id];
    setDeletedIds(updated);
    localStorage.setItem(`deletedNotifications_${currentUserId}`, JSON.stringify(updated));
  };

  // Real-time listener for incoming notifications
  useEffect(() => {
    if (!isOpen) return;
    
    setLoading(true);
    const q = query(collection(db, 'notifications'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allNotifications = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate() : new Date(),
        publishAt: doc.data().publishAt?.toDate ? doc.data().publishAt.toDate() : null
      }));

      const now = new Date();
      // Filter out scheduled notifications that are set for the future
      const publishedNotifications = allNotifications.filter(n => {
        // A notification is scheduled for the future only if publishAt is set and is later than createdAt (with 1s tolerance)
        const isScheduledForFuture = n.publishAt && n.createdAt && (n.publishAt.getTime() > n.createdAt.getTime() + 1000);
        if (isScheduledForFuture && n.publishAt > now) return false;
        return true;
      });

      // Filter client-side based on role
      const currentUserId = servant?.id || student?.id || 'admin';
      let filtered = [];

      if (isStudent && student) {
        // Students receive messages targeting students or both, where their ID is included
        filtered = publishedNotifications.filter(n => 
          (n.recipientType === 'students' || n.recipientType === 'both') && 
          n.recipientIds?.includes(student.id)
        );
      } else if (isServant && servant) {
        // Servants receive messages targeting servants or both, where their ID is included
        filtered = publishedNotifications.filter(n => 
          (n.recipientType === 'servants' || n.recipientType === 'both') && 
          n.recipientIds?.includes(servant.id)
        );
      } else if (isGeneralAdmin) {
        // General admin sees announcements sent to servants or those they created
        filtered = publishedNotifications.filter(n => 
          n.recipientType === 'servants' || 
          n.recipientType === 'both' || 
          n.senderId === 'admin' || 
          n.senderId === (servant?.id || '')
        );
      }

      // 24-hour read countdown logic
      const storageKey = `openedNotifications_${currentUserId}`;
      let openedMap = {};
      try {
        openedMap = JSON.parse(localStorage.getItem(storageKey) || '{}');
      } catch (e) {
        console.error("Error parsing opened notifications", e);
      }

      const nowMs = Date.now();
      let updatedMap = { ...openedMap };
      let changed = false;

      // 1. Filter out notifications opened > 24 hours ago or deleted by the user
      const visibleNotifications = filtered.filter(n => {
        if (deletedIds.includes(n.id)) {
          return false;
        }
        const openedTime = openedMap[n.id];
        if (openedTime && (nowMs - openedTime > 24 * 60 * 60 * 1000)) {
          return false;
        }
        return true;
      });

      // 2. Since the modal is open (isOpen is true), record the opened time for all currently visible notifications if they don't have one
      visibleNotifications.forEach(n => {
        if (!updatedMap[n.id]) {
          updatedMap[n.id] = nowMs;
          changed = true;
        }
      });

      // Clean up old entries from updatedMap (older than 7 days) to save space
      const sevenDaysAgo = nowMs - 7 * 24 * 60 * 60 * 1000;
      Object.keys(updatedMap).forEach(key => {
        if (updatedMap[key] < sevenDaysAgo) {
          delete updatedMap[key];
          changed = true;
        }
      });

      if (changed) {
        localStorage.setItem(storageKey, JSON.stringify(updatedMap));
      }

      setNotifications(visibleNotifications);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching incoming notifications:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isOpen, servant, student, isGeneralAdmin, isServant, isStudent, deletedIds]);

  const formatText = (text) => {
    if (!text) return '';
    const currentName = isStudent 
      ? (student?.name || '') 
      : (isServant || isGeneralAdmin ? (servant?.name || '') : '');
    return text.replace(/\(name\)/gi, currentName);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#1e293b] w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden border border-slate-100 dark:border-slate-800 flex flex-col max-h-[95vh] sm:max-h-[90vh] animate-in zoom-in-95 duration-200 text-right" dir="rtl">
        
        {/* Header */}
        <div className="bg-[#271e48] text-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 rounded-xl">
              <Bell className="text-teal-400 animate-swing" size={24} />
            </div>
            <div>
              <h3 className="font-black text-xl">مركز الإشعارات</h3>
              <p className="text-sm text-slate-300">استقبل التنبيهات والرسائل المهمة الموجهة لك.</p>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-4">
            <button 
              onClick={onClose} 
              className="p-2 hover:bg-white/10 rounded-xl transition-all cursor-pointer border-none text-white/80 hover:text-white"
            >
              <X size={22} />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto flex-1 bg-slate-50 dark:bg-[#0f172a]/20">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200/60 dark:border-slate-800">
              <h4 className="font-black text-base text-slate-700 dark:text-slate-300">الرسائل الواردة ({notifications.length})</h4>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
                <Loader2 className="animate-spin text-[#271e48] dark:text-teal-400" size={36} />
                <span className="text-sm font-bold">جاري تحميل إشعاراتك...</span>
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400 dark:text-slate-500">
                <Bell size={54} className="opacity-30" />
                <span className="text-base font-bold">صندوق الوارد فارغ. لا توجد إشعارات حالياً!</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {notifications.map((notif) => (
                  <div 
                    key={notif.id}
                    className="p-5 rounded-2xl bg-white dark:bg-[#1e293b]/70 border border-slate-100 dark:border-slate-800/80 shadow-sm hover:shadow transition-all duration-350 flex flex-col gap-3 relative overflow-hidden"
                  >
                    {/* Decorative colored strip */}
                    <div className="absolute top-0 right-0 left-0 h-1 bg-[#271e48]"></div>
                    
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDeleteNotification(notif.id)}
                          className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-red-500 transition-all border-none bg-transparent cursor-pointer"
                          title="مسح الإشعار"
                        >
                          <X size={16} />
                        </button>
                        <h5 className="font-black text-base text-[#271e48] dark:text-white leading-tight">{formatText(notif.title)}</h5>
                      </div>
                      <span className="text-xs text-slate-400 font-bold flex items-center gap-1.5">
                        <Calendar size={14} />
                        {notif.createdAt.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>

                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed font-medium whitespace-pre-line">
                      {formatText(notif.body)}
                    </p>

                    <div className="pt-2 border-t border-slate-50 dark:border-slate-800/60 flex items-center justify-between text-xs text-slate-450 dark:text-slate-400">
                      <div className="flex items-center gap-1.5 font-bold">
                        <User size={14} className="text-slate-400" />
                        <span>المرسل: {notif.senderName}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
