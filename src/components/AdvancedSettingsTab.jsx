import React, { useState, useEffect, useMemo } from 'react';
import { 
  db, 
  auth, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  writeBatch, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  deleteField
} from '../firebase';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { 
  Settings, 
  Trash2, 
  RotateCcw, 
  ShieldAlert, 
  Users, 
  BookOpen, 
  Heart, 
  Calendar, 
  ShoppingBag, 
  Bell, 
  Lock, 
  CheckCircle, 
  AlertTriangle,
  Loader2,
  Clock
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const STAGE_CLASS_MAP = {
  'ابتدائي': [
    'حضانة/ملائكة',
    'أولى ابتدائى',
    'ثانية ابتدائى',
    'ثالثة ابتدائى',
    'رابعة ابتدائى',
    'خامسة ابتدائى',
    'سادسة ابتدائي'
  ],
  'اعدادي': [
    'اولي اعدادي',
    'تانيه اعدادي',
    'تالته اعدادي'
  ],
  'ثانوي': [
    'اولي ثانوي',
    'تانيه ثانوي',
    'تالته ثانوي'
  ]
};

const LOCKABLE_PAGES = [
  { path: '/student/dashboard', name: 'لوحة تحكم الطالب (المخدومين)' },
  { path: '/student/store', name: 'معرض الهدايا (المخدومين)' },
  { path: '/student/cart', name: 'سلة المشتريات (المخدومين)' },
  { path: '/servant/dashboard', name: 'لوحة تحكم الخادم' },
  { path: '/servant/attendance', name: 'تسجيل الحضور والغياب (الخدام)' },
  { path: '/servant/visitation', name: 'لوحة الافتقاد والمتابعة (الخدام)' },
  { path: '/servant/orders', name: 'طلبات المعرض (الخدام)' },
  { path: '/servant/scanner', name: 'ماسح الـ QR لحضور الطلاب (الخدام)' },
  { path: '/servant/send-reports', name: 'إرسال التقارير (الخدام)' },
  { path: '/my-class', name: 'صفحة فصلي (الخدام)' },
  { path: '/class-servants', name: 'خدام فصلي (الخدام)' }
];

const normalizeArabic = (str) => {
  if (!str) return '';
  return str
    .replace(/[أإآا]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/[ةه]/g, 'ه')
    .trim();
};

// Helper: Check if a date string/Timestamp falls within date range
const isDateInRange = (dateInput, startDateStr, endDateStr) => {
  if (!startDateStr && !endDateStr) return true; // No range filter active (matches all)

  let recordTime = 0;
  if (dateInput instanceof Date) {
    recordTime = dateInput.getTime();
  } else if (typeof dateInput === 'string') {
    if (dateInput.length === 10) {
      recordTime = new Date(dateInput + 'T00:00:00').getTime();
    } else {
      recordTime = new Date(dateInput).getTime();
    }
  } else if (dateInput && dateInput.seconds) {
    recordTime = dateInput.seconds * 1000;
  } else {
    return false;
  }

  if (isNaN(recordTime)) return false;

  const startLimit = startDateStr ? new Date(startDateStr + 'T00:00:00').getTime() : 0;
  const endLimit = endDateStr ? new Date(endDateStr + 'T23:59:59').getTime() : Infinity;

  return recordTime >= startLimit && recordTime <= endLimit;
};

// Helper: Check if a Month key (YYYY-MM) overlaps with a date range
const isMonthInRange = (monthStr, startDateStr, endDateStr) => {
  if (!startDateStr && !endDateStr) return true;

  const [year, month] = monthStr.split('-').map(Number);
  const monthStart = new Date(year, month - 1, 1, 0, 0, 0).getTime();
  const monthEnd = new Date(year, month, 0, 23, 59, 59).getTime();

  const startLimit = startDateStr ? new Date(startDateStr + 'T00:00:00').getTime() : 0;
  const endLimit = endDateStr ? new Date(endDateStr + 'T23:59:59').getTime() : Infinity;

  return monthStart <= endLimit && monthEnd >= startLimit;
};

// Helper to resolve year/month or start/end inputs into unified start and end dates
const resolvePeriod = (mode, year, month, customStart, customEnd) => {
  if (mode === 'quick') {
    if (year === 'all') {
      return { start: '', end: '' };
    }
    const y = parseInt(year, 10);
    if (month === 'all') {
      return {
        start: `${y}-01-01`,
        end: `${y}-12-31`
      };
    }
    const m = parseInt(month, 10);
    const lastDay = new Date(y, m, 0).getDate();
    return {
      start: `${y}-${String(m).padStart(2, '0')}-01`,
      end: `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    };
  } else {
    return {
      start: customStart,
      end: customEnd
    };
  }
};
export default function AdvancedSettingsTab() {
  const { user, isGeneralAdmin, refreshPageLocks } = useAuth();
  
  // States for Page Locks
  const [selectedLockPath, setSelectedLockPath] = useState(LOCKABLE_PAGES[0].path);
  const [lockMessageText, setLockMessageText] = useState('الصفحة تحت الإنشاء وتحديث البيانات حالياً...');
  const [localPageLocks, setLocalPageLocks] = useState({});
  const [pageLocksLoading, setPageLocksLoading] = useState(true);
  
  // States for Soft Deletes History
  const [pendingDeletes, setPendingDeletes] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);

  // States for Granular Reset (Logs)
  const [logType, setLogType] = useState('attendance'); // 'attendance', 'visitation', 'notifications', 'orders', 'servants_followup', 'points_history'
  const [logFilterMode, setLogFilterMode] = useState('quick'); // 'quick', 'custom'
  const [logYear, setLogYear] = useState('all');
  const [logMonth, setLogMonth] = useState('all');
  const [logStartDate, setLogStartDate] = useState('');
  const [logEndDate, setLogEndDate] = useState('');

  // States for Granular Reset (Servants / Students)
  const [sectorType, setSectorType] = useState('students'); // 'students', 'servants'
  const [sectorStage, setSectorStage] = useState('all'); // 'all', 'ابتدائي', 'اعدادي', 'ثانوي'
  const [sectorClass, setSectorClass] = useState('all');
  const [sectorDeleteStageAdmins, setSectorDeleteStageAdmins] = useState(false);

  // States for Granular Reset (Store)
  const [storeResetType, setStoreResetType] = useState('products'); // 'products', 'orders'

  // States for Total Factory Reset Modal
  const [showTotalResetModal, setShowTotalResetModal] = useState(false);
  const [totalResetFilterMode, setTotalResetFilterMode] = useState('quick'); // 'quick', 'custom'
  const [totalResetYear, setTotalResetYear] = useState('all');
  const [totalResetMonth, setTotalResetMonth] = useState('all');
  const [totalResetStartDate, setTotalResetStartDate] = useState('');
  const [totalResetEndDate, setTotalResetEndDate] = useState('');
  const [totalResetDeleteStudents, setTotalResetDeleteStudents] = useState(false);
  const [totalResetDeleteServants, setTotalResetDeleteServants] = useState(false);
  const [totalResetDeleteStageAdmins, setTotalResetDeleteStageAdmins] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [totalResetError, setTotalResetError] = useState('');
  const [totalResetLoading, setTotalResetLoading] = useState(false);

  // Countdown timer trigger
  const [tick, setTick] = useState(0);

  // Dynamic Years List from project start year (2024) to the current year
  const yearsOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const startYear = 2024;
    const list = [];
    for (let y = currentYear; y >= startYear; y--) {
      list.push(y);
    }
    return list;
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 10000); // refresh countdowns every 10s
    return () => clearInterval(timer);
  }, []);

  // Sync class filter based on selected stage
  useEffect(() => {
    setSectorClass('all');
  }, [sectorStage]);

  // ── Fetch Page Locks (One-time on mount to save reads) ──
  useEffect(() => {
    const fetchPageLocks = async () => {
      try {
        const docRef = doc(db, 'settings', 'page_locks');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setLocalPageLocks(docSnap.data() || {});
        }
      } catch (err) {
        console.error("Error loading page locks:", err);
      } finally {
        setPageLocksLoading(false);
      }
    };
    fetchPageLocks();
  }, []);

  const handleLockPage = async () => {
    if (actionLoading) return;
    if (!lockMessageText.trim()) {
      setActionMessage({ type: 'error', text: 'يرجى إدخال رسالة الحظر للصفحة.' });
      return;
    }

    setActionLoading(true);
    try {
      const pageName = LOCKABLE_PAGES.find(p => p.path === selectedLockPath)?.name || selectedLockPath;
      const safeKey = selectedLockPath.replace(/\//g, '_');
      const newLockData = {
        isLocked: true,
        message: lockMessageText.trim(),
        lockedAt: new Date().toISOString(),
        lockedBy: auth.currentUser?.email || 'الأمين العام',
        pageName,
        path: selectedLockPath
      };

      await setDoc(doc(db, 'settings', 'page_locks'), {
        [safeKey]: newLockData
      }, { merge: true });

      // Update local state and context state to avoid extra reads
      setLocalPageLocks(prev => ({
        ...prev,
        [safeKey]: newLockData
      }));
      if (refreshPageLocks) {
        await refreshPageLocks();
      }

      setActionMessage({ type: 'success', text: `تم قفل صفحة (${pageName}) بنجاح! 🔒` });
      setLockMessageText('الصفحة تحت الإنشاء وتحديث البيانات حالياً...');
    } catch (err) {
      console.error("Lock page error:", err);
      setActionMessage({ type: 'error', text: `فشل قفل الصفحة: ${err.message}` });
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnlockPage = async (pathKey) => {
    if (actionLoading) return;
    const pageName = localPageLocks[pathKey]?.pageName || localPageLocks[pathKey]?.path || pathKey;
    const confirmUnlock = window.confirm(`هل أنت متأكد من إلغاء قفل صفحة (${pageName})؟`);
    if (!confirmUnlock) return;

    setActionLoading(true);
    try {
      // لتفادي قيود علامة المائل (/) في updateDoc، نقوم بجلب المستند كاملاً وحذف المفتاح يدوياً بالـ JS ثم إعادة حفظه
      const docRef = doc(db, 'settings', 'page_locks');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const currentData = docSnap.data() || {};
        delete currentData[pathKey];
        await setDoc(docRef, currentData); // كتابة البيانات بعد الحذف بنجاح
      }

      // Update local state and context state to avoid extra reads
      setLocalPageLocks(prev => {
        const next = { ...prev };
        delete next[pathKey];
        return next;
      });
      if (refreshPageLocks) {
        await refreshPageLocks();
      }

      setActionMessage({ type: 'success', text: `تم إلغاء قفل صفحة (${pageName}) بنجاح وإعادة تفعيلها! 🔓` });
    } catch (err) {
      console.error("Unlock page error:", err);
      setActionMessage({ type: 'error', text: `فشل إلغاء قفل الصفحة: ${err.message}` });
    } finally {
      setActionLoading(false);
    }
  };

  // ── 1. Fetch Soft Deletes History ──────────────────────────────────────────
  useEffect(() => {
    if (!isGeneralAdmin) return;

    const q = query(
      collection(db, 'soft_deletes'),
      where('status', '==', 'pending')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      // Sort client-side to prevent Firestore Composite Index requirement!
      list.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
      setPendingDeletes(list);
      setLoadingHistory(false);
    }, (error) => {
      console.error("Error loading soft deletes history:", error);
      setLoadingHistory(false);
    });

    return () => unsubscribe();
  }, [isGeneralAdmin]);

  // Helper for batch chunking (Firestore writeBatch limit is 500)
  const runBatchedOperations = async (operations) => {
    let batch = writeBatch(db);
    let count = 0;
    for (const op of operations) {
      op(batch);
      count++;
      if (count === 400) {
        await batch.commit();
        batch = writeBatch(db);
        count = 0;
      }
    }
    if (count > 0) {
      await batch.commit();
    }
  };

  // ── 2. Soft Delete & Undo Logic ─────────────────────────────────────────────
  const initiateSoftDelete = async (description, type, itemsToRestore, originalDeletionsAndUpdates) => {
    const batchId = `sd_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const deletedAt = new Date();
    const expiresAt = new Date(deletedAt.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    const operations = [];

    // A. Add main soft delete record
    const mainRef = doc(db, 'soft_deletes', batchId);
    operations.push((b) => b.set(mainRef, {
      id: batchId,
      deletedAt: deletedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      deletedBy: auth.currentUser?.email || 'الأمين العام',
      description,
      type,
      status: 'pending'
    }));

    // B. Save items to soft_deleted_items
    itemsToRestore.forEach((item, index) => {
      const itemRef = doc(db, 'soft_deleted_items', `${batchId}_item_${index}`);
      operations.push((b) => b.set(itemRef, {
        batchId,
        collection: item.collection,
        docId: item.docId,
        type: item.type, // 'document' or 'update'
        previousData: item.previousData
      }));
    });

    // C. Perform the actual deletions & updates
    originalDeletionsAndUpdates.forEach(op => {
      operations.push(op);
    });

    await runBatchedOperations(operations);
  };

  const handleUndo = async (batchId) => {
    if (actionLoading) return;
    setActionLoading(true);
    setActionMessage({ type: 'info', text: 'جاري مراجعة واسترجاع البيانات المحذوفة...' });

    try {
      // 1. Fetch restoration items
      const itemsQuery = query(
        collection(db, 'soft_deleted_items'),
        where('batchId', '==', batchId)
      );
      const snap = await getDocs(itemsQuery);
      if (snap.empty) {
        throw new Error('لم يتم العثور على ملفات استرجاع لهذه العملية.');
      }

      const operations = [];

      // 2. Queue restoration actions
      snap.docs.forEach(docSnap => {
        const item = docSnap.data();
        const docRef = doc(db, item.collection, item.docId);

        if (item.type === 'document') {
          operations.push((b) => b.set(docRef, item.previousData));
        } else if (item.type === 'update') {
          operations.push((b) => b.update(docRef, item.previousData));
        }

        // Clean up backup item
        operations.push((b) => b.delete(docSnap.ref));
      });

      // 3. Mark batch as restored
      const batchRef = doc(db, 'soft_deletes', batchId);
      operations.push((b) => b.update(batchRef, { status: 'restored' }));

      await runBatchedOperations(operations);
      setActionMessage({ type: 'success', text: 'تم التراجع واسترجاع كافة البيانات بنجاح! ↩️✅' });
    } catch (err) {
      console.error("Undo error:", err);
      setActionMessage({ type: 'error', text: `فشل التراجع: ${err.message}` });
    } finally {
      setActionLoading(false);
    }
  };

  // ── 3. Granular Reset: LOGS ────────────────────────────────────────────────
  const handleLogsReset = async () => {
    if (actionLoading) return;
    
    // Resolve date bounds
    const { start, end } = resolvePeriod(logFilterMode, logYear, logMonth, logStartDate, logEndDate);

    if (start && end && new Date(start) > new Date(end)) {
      setActionMessage({ type: 'error', text: 'تاريخ البدء لا يمكن أن يكون بعد تاريخ الانتهاء.' });
      return;
    }

    const periodDesc = start || end 
      ? `الفترة من ${start || 'البداية'} إلى ${end || 'النهاية'}`
      : 'جميع التواريخ';

    const confirmAction = window.confirm(`هل أنت متأكد من مسح سجلات (${
      logType === 'attendance' ? 'الحضور والغياب' : 
      logType === 'visitation' ? 'الافتقاد' : 
      logType === 'notifications' ? 'الإشعارات' : 
      logType === 'orders' ? 'طلبات المعرض' : 
      logType === 'servants_followup' ? 'متابعة الخدام' : 'رصيد وسجل الصفات'
    }) المحددة خلال: ${periodDesc}؟ (يمكنك التراجع خلال 24 ساعة)`);
    
    if (!confirmAction) return;

    setActionLoading(true);
    setActionMessage({ type: 'info', text: 'جاري تجميع البيانات وتطبيق المسح الآمن...' });

    try {
      const itemsToRestore = [];
      const originalDeletionsAndUpdates = [];

      const isFilteredRange = !!start || !!end;

      if (logType === 'attendance') {
        // Attendance logs reset
        // 1. Fetch students to update their attendance arrays
        const studentsSnap = await getDocs(collection(db, 'students'));
        studentsSnap.docs.forEach(docSnap => {
          const st = docSnap.data();
          const att = st.attendance || [];
          const liturgy = st.liturgyAttendance || [];
          
          const filteredAtt = att.filter(d => !isDateInRange(d, start, end));
          const filteredLiturgy = liturgy.filter(d => !isDateInRange(d, start, end));

          if (filteredAtt.length !== att.length || filteredLiturgy.length !== liturgy.length) {
            itemsToRestore.push({
              collection: 'students',
              docId: docSnap.id,
              type: 'update',
              previousData: {
                attendance: att,
                liturgyAttendance: liturgy
              }
            });
            originalDeletionsAndUpdates.push((b) => b.update(docSnap.ref, {
              attendance: filteredAtt,
              liturgyAttendance: filteredLiturgy
            }));
          }
        });

        // 2. Fetch and delete from attendance collection
        const attDocsSnap = await getDocs(collection(db, 'attendance'));
        attDocsSnap.docs.forEach(docSnap => {
          const id = docSnap.id;
          const dateStr = id.split('_')[1] || ''; // ID is: `${studentId}_YYYY-MM-DD`
          
          if (isDateInRange(dateStr, start, end)) {
            itemsToRestore.push({
              collection: 'attendance',
              docId: id,
              type: 'document',
              previousData: docSnap.data()
            });
            originalDeletionsAndUpdates.push((b) => b.delete(docSnap.ref));
          }
        });

      } else if (logType === 'visitation') {
        // Home and Phone Visitations reset (stored in students doc)
        const studentsSnap = await getDocs(collection(db, 'students'));
        studentsSnap.docs.forEach(docSnap => {
          const st = docSnap.data();
          const hv = st.homeVisitations || {};
          const pv = st.phoneVisitations || {};

          let newHv = { ...hv };
          let newPv = { ...pv };
          let changed = false;

          // Delete home visitations keys matching YYYY-MM
          Object.keys(hv).forEach(k => {
            if (isMonthInRange(k, start, end)) {
              delete newHv[k];
              changed = true;
            }
          });
          // Delete phone visitations keys matching YYYY-MM-DD
          Object.keys(pv).forEach(k => {
            if (isDateInRange(k, start, end)) {
              delete newPv[k];
              changed = true;
            }
          });

          if (changed) {
            itemsToRestore.push({
              collection: 'students',
              docId: docSnap.id,
              type: 'update',
              previousData: {
                homeVisitations: hv,
                phoneVisitations: pv
              }
            });
            originalDeletionsAndUpdates.push((b) => b.update(docSnap.ref, {
              homeVisitations: newHv,
              phoneVisitations: newPv
            }));
          }
        });

      } else if (logType === 'notifications') {
        // Reset Sent and Scheduled Notifications
        const notifSnap = await getDocs(collection(db, 'notifications'));
        notifSnap.docs.forEach(docSnap => {
          const data = docSnap.data();
          const date = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt || Date.now());
          
          if (isDateInRange(date, start, end)) {
            itemsToRestore.push({
              collection: 'notifications',
              docId: docSnap.id,
              type: 'document',
              previousData: data
            });
            originalDeletionsAndUpdates.push((b) => b.delete(docSnap.ref));
          }
        });

        // Scheduled notifications
        const schedSnap = await getDocs(collection(db, 'scheduled_notifications'));
        schedSnap.docs.forEach(docSnap => {
          const data = docSnap.data();
          const dateStr = data.scheduledAtLocal || ''; // YYYY-MM-DD HH:MM
          const dateOnly = dateStr.split(' ')[0] || '';
          
          if (isDateInRange(dateOnly, start, end)) {
            itemsToRestore.push({
              collection: 'scheduled_notifications',
              docId: docSnap.id,
              type: 'document',
              previousData: data
            });
            originalDeletionsAndUpdates.push((b) => b.delete(docSnap.ref));
          }
        });

      } else if (logType === 'orders') {
        // Reset orders
        const ordersSnap = await getDocs(collection(db, 'orders'));
        ordersSnap.docs.forEach(docSnap => {
          const data = docSnap.data();
          const date = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt || Date.now());
          
          if (isDateInRange(date, start, end)) {
            itemsToRestore.push({
              collection: 'orders',
              docId: docSnap.id,
              type: 'document',
              previousData: data
            });
            originalDeletionsAndUpdates.push((b) => b.delete(docSnap.ref));
          }
        });
      } else if (logType === 'servants_followup') {
        // Reset weekly followup for servants (stored inside servants doc)
        const servantsSnap = await getDocs(collection(db, 'servants'));
        servantsSnap.docs.forEach(docSnap => {
          const s = docSnap.data();
          const wfu = s.weeklyFollowUp || {};

          let newWfu = { ...wfu };
          let changed = false;

          // Delete weekly follow-up keys matching YYYY-MM-DD falling within range
          Object.keys(wfu).forEach(k => {
            if (isDateInRange(k, start, end)) {
              delete newWfu[k];
              changed = true;
            }
          });

          if (changed) {
            itemsToRestore.push({
              collection: 'servants',
              docId: docSnap.id,
              type: 'update',
              previousData: {
                weeklyFollowUp: wfu
              }
            });
            originalDeletionsAndUpdates.push((b) => b.update(docSnap.ref, {
              weeklyFollowUp: newWfu
            }));
          }
        });
      } else if (logType === 'points_history') {
        // Reset points log (pointsHistory) and adjust student points accordingly
        const pointsHistorySnap = await getDocs(collection(db, 'pointsHistory'));
        const studentAdjustments = {}; // studentId -> sum of points changes

        pointsHistorySnap.docs.forEach(docSnap => {
          const data = docSnap.data();
          const date = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt || Date.now());
          
          if (isDateInRange(date, start, end)) {
            itemsToRestore.push({
              collection: 'pointsHistory',
              docId: docSnap.id,
              type: 'document',
              previousData: data
            });
            originalDeletionsAndUpdates.push((b) => b.delete(docSnap.ref));

            const stId = data.studentId;
            const amount = Number(data.amount || data.points || 0);
            if (stId) {
              studentAdjustments[stId] = (studentAdjustments[stId] || 0) + amount;
            }
          }
        });

        // Update student points balances
        const studentsSnap = await getDocs(collection(db, 'students'));
        studentsSnap.docs.forEach(docSnap => {
          const st = docSnap.data();
          const currentPts = st.points || 0;

          let newPts = 0;
          let changed = false;

          if (isFilteredRange) {
            const adj = studentAdjustments[docSnap.id] || 0;
            if (adj !== 0) {
              newPts = Math.max(0, currentPts - adj);
              changed = true;
            }
          } else {
            if (currentPts !== 0) {
              newPts = 0;
              changed = true;
            }
          }

          if (changed) {
            itemsToRestore.push({
              collection: 'students',
              docId: docSnap.id,
              type: 'update',
              previousData: {
                points: currentPts
              }
            });
            originalDeletionsAndUpdates.push((b) => b.update(docSnap.ref, {
              points: newPts
            }));
          }
        });
      }

      if (originalDeletionsAndUpdates.length === 0) {
        setActionMessage({ type: 'info', text: 'لا توجد بيانات مطابقة للفترة المحددة لمسحها.' });
        setActionLoading(false);
        return;
      }

      const desc = `مسح سجلات (${
        logType === 'attendance' ? 'الحضور والغياب' : 
        logType === 'visitation' ? 'الافتقاد' : 
        logType === 'notifications' ? 'الإشعارات' : 
        logType === 'orders' ? 'طلبات المعرض' : 
        logType === 'servants_followup' ? 'متابعة الخدام الأسبوعية' : 'رصيد وسجل الصفات للطلاب'
      }) خلال (${periodDesc})`;

      await initiateSoftDelete(desc, 'granular_logs', itemsToRestore, originalDeletionsAndUpdates);
      setActionMessage({ type: 'success', text: 'تمت عملية المسح بنجاح! تذكر أنك تستطيع التراجع عنها من التاريخ أعلاه خلال 24 ساعة. 🚀🗑️' });
    } catch (err) {
      console.error(err);
      setActionMessage({ type: 'error', text: `حدث خطأ أثناء المسح: ${err.message}` });
    } finally {
      setActionLoading(false);
    }
  };

  // ── 4. Granular Reset: SERVANTS / STUDENTS ──────────────────────────────────
  const handleSectorReset = async () => {
    if (actionLoading) return;

    const confirmAction = window.confirm(`هل أنت متأكد من مسح (${
      sectorType === 'students' ? 'المخدومين' : 'الخدام (ما عدا الأمناء العموم)'
    }) المحددين؟ (يمكنك التراجع خلال 24 ساعة)`);

    if (!confirmAction) return;

    setActionLoading(true);
    setActionMessage({ type: 'info', text: 'جاري تجميع بيانات القطاع وتطبيق المسح الآمن...' });

    try {
      const itemsToRestore = [];
      const originalDeletionsAndUpdates = [];

      if (sectorType === 'students') {
        const snap = await getDocs(collection(db, 'students'));
        snap.docs.forEach(docSnap => {
          const st = docSnap.data();
          
          let matchesStage = sectorStage === 'all' || normalizeArabic(st.stage || '') === normalizeArabic(sectorStage);
          let matchesClass = sectorClass === 'all' || (st.class === sectorClass || st.assignedClass === sectorClass);

          if (matchesStage && matchesClass) {
            itemsToRestore.push({
              collection: 'students',
              docId: docSnap.id,
              type: 'document',
              previousData: { id: docSnap.id, ...st }
            });
            originalDeletionsAndUpdates.push((b) => b.delete(docSnap.ref));
          }
        });
      } else {
        // Servants
        const snap = await getDocs(collection(db, 'servants'));
        snap.docs.forEach(docSnap => {
          const s = docSnap.data();
          const isGenAdmin = s.isGeneralAdmin === true || 
                             normalizeArabic(s.role || '') === 'امين عام' || 
                             normalizeArabic(s.role || '') === 'خادم عام' ||
                             normalizeArabic(s.role || '') === 'عام' ||
                             docSnap.id === auth.currentUser?.uid;
          
          if (isGenAdmin) return;

          const isStageAdmin = normalizeArabic(s.role || '') === 'امين مرحله';
          if (isStageAdmin && !sectorDeleteStageAdmins) return; // Protect stage coordinator if checkbox unchecked

          let matchesStage = sectorStage === 'all' || normalizeArabic(s.assignedStage || s.grade || '') === normalizeArabic(sectorStage);
          
          const servantClasses = [
            ...(s.myClasses || []),
            ...(s.managedClasses || []),
            ...(s.assignedClass ? [s.assignedClass] : []),
            ...(s.assignment ? [s.assignment] : [])
          ];
          let matchesClass = sectorClass === 'all' || servantClasses.includes(sectorClass);

          if (matchesStage && matchesClass) {
            itemsToRestore.push({
              collection: 'servants',
              docId: docSnap.id,
              type: 'document',
              previousData: { id: docSnap.id, ...s }
            });
            originalDeletionsAndUpdates.push((b) => b.delete(docSnap.ref));
          }
        });
      }

      if (originalDeletionsAndUpdates.length === 0) {
        setActionMessage({ type: 'info', text: 'لا يوجد مخدومين/خدام مطابقين للفلتر المحدد.' });
        setActionLoading(false);
        return;
      }

      const desc = `مسح قطاع (${sectorType === 'students' ? 'المخدومين' : 'الخدام'}) لمرحلة (${sectorStage}) فصل (${sectorClass})`;

      await initiateSoftDelete(desc, 'granular_servants_students', itemsToRestore, originalDeletionsAndUpdates);
      setActionMessage({ type: 'success', text: 'تم مسح القطاع بنجاح! متاح للتراجع خلال 24 ساعة. 🚀🗑️' });
    } catch (err) {
      console.error(err);
      setActionMessage({ type: 'error', text: `حدث خطأ أثناء المسح: ${err.message}` });
    } finally {
      setActionLoading(false);
    }
  };

  // ── 5. Granular Reset: GALLERY ─────────────────────────────────────────────
  const handleStoreReset = async () => {
    if (actionLoading) return;

    const confirmAction = window.confirm(`هل أنت متأكد من تصفير (${
      storeResetType === 'products' ? 'هدايا ومنتجات المعرض بالكامل' : 'جميع طلبات الشراء بالكامل'
    })؟ (يمكنك التراجع خلال 24 ساعة)`);

    if (!confirmAction) return;

    setActionLoading(true);
    setActionMessage({ type: 'info', text: 'جاري تصفير محتويات المعرض وتأمين التراجع...' });

    try {
      const itemsToRestore = [];
      const originalDeletionsAndUpdates = [];
      const targetCollection = storeResetType === 'products' ? 'products' : 'orders';

      const snap = await getDocs(collection(db, targetCollection));
      snap.docs.forEach(docSnap => {
        itemsToRestore.push({
          collection: targetCollection,
          docId: docSnap.id,
          type: 'document',
          previousData: { id: docSnap.id, ...docSnap.data() }
        });
        originalDeletionsAndUpdates.push((b) => b.delete(docSnap.ref));
      });

      if (originalDeletionsAndUpdates.length === 0) {
        setActionMessage({ type: 'info', text: 'الجدول المحدد مفرغ بالفعل.' });
        setActionLoading(false);
        return;
      }

      const desc = `تصفير (${storeResetType === 'products' ? 'هدايا ومنتجات المعرض' : 'طلبات شراء معرض الصفات'}) بالكامل`;

      await initiateSoftDelete(desc, 'store_reset', itemsToRestore, originalDeletionsAndUpdates);
      setActionMessage({ type: 'success', text: 'تم تصفير معرض الصفات بنجاح ومتاح للتراجع. 🛍️✅' });
    } catch (err) {
      console.error(err);
      setActionMessage({ type: 'error', text: `حدث خطأ أثناء المسح: ${err.message}` });
    } finally {
      setActionLoading(false);
    }
  };

  // ── 6. Total Factory Reset (ضبط المصنع بالكامل) ────────────────────────────
  const handleTotalFactoryReset = async (e) => {
    e.preventDefault();

    // Resolve date bounds
    const { start, end } = resolvePeriod(totalResetFilterMode, totalResetYear, totalResetMonth, totalResetStartDate, totalResetEndDate);

    if (start && end && new Date(start) > new Date(end)) {
      setTotalResetError('تاريخ البدء لا يمكن أن يكون بعد تاريخ الانتهاء.');
      return;
    }

    if (confirmText !== 'CONFIRM RESET') {
      setTotalResetError('يرجى كتابة نص التأكيد النصي المكتوب بالإنجليزية بدقة.');
      return;
    }
    if (!adminPassword) {
      setTotalResetError('يرجى كتابة الباسورد الخاص بالأدمن للتحقق.');
      return;
    }

    setTotalResetLoading(true);
    setTotalResetError('');

    try {
      // 1. Re-authenticate user via Firebase Auth
      const currentUser = auth.currentUser;
      if (!currentUser || !currentUser.email) {
        throw new Error('لم يتم العثور على مستخدم أدمن مسجل الجلسة.');
      }

      const credential = EmailAuthProvider.credential(currentUser.email, adminPassword);
      await reauthenticateWithCredential(currentUser, credential);

      // Re-authentication success! Proceeding to wipe transactional collections
      const collectionsToWipe = [
        'attendance',
        'attendance_config',
        'class_shortcuts_config',
        'store_config',
        'pointsHistory',
        'notifications',
        'scheduled_notifications',
        'products',
        'orders',
        'carts',
        'users',
        'settings',
        'system_counters',
        'metadata',
        'store_status_config'
      ];

      const itemsToRestore = [];
      const originalDeletionsAndUpdates = [];

      const isFilteredRange = !!start || !!end;

      // A. Fetch all servants to identify General Admins and Stage Admins
      const servantsSnap = await getDocs(collection(db, 'servants'));
      const genAdminIds = new Set();
      const stageAdminIds = new Set();
      
      servantsSnap.docs.forEach(docSnap => {
        const s = docSnap.data();
        const isGenAdmin = s.isGeneralAdmin === true || 
                           normalizeArabic(s.role || '') === 'امين عام' || 
                           normalizeArabic(s.role || '') === 'خادم عام' ||
                           normalizeArabic(s.role || '') === 'عام' ||
                           docSnap.id === currentUser.uid;
        const isStageAdmin = normalizeArabic(s.role || '') === 'امين مرحله';
        if (isGenAdmin) {
          genAdminIds.add(docSnap.id);
        } else if (isStageAdmin) {
          stageAdminIds.add(docSnap.id);
        }
      });

      // B. Wiping transactional collections (respecting resolved date range filter)
      for (const colName of collectionsToWipe) {
        const isConfigTable = colName.includes('config') || 
                              colName === 'settings' || 
                              colName === 'system_counters' || 
                              colName === 'metadata';
        if (isConfigTable && isFilteredRange) {
          continue;
        }

        const snap = await getDocs(collection(db, colName));
        snap.docs.forEach(docSnap => {
          // If it is 'users' collection:
          if (colName === 'users') {
            // General admins are always protected from user deletion
            if (genAdminIds.has(docSnap.id)) return;

            // Stage coordinator check
            if (stageAdminIds.has(docSnap.id)) {
              if (!totalResetDeleteStageAdmins) return;
            } else {
              // Class servants / student logins
              if (!totalResetDeleteServants) return;
            }
          }

          const data = docSnap.data();
          let recordDate = data.createdAt || data.date || data.updatedAt || null;
          
          if (colName === 'attendance' && !recordDate) {
            recordDate = docSnap.id.split('_')[1] || null;
          }

          if (isDateInRange(recordDate, start, end)) {
            itemsToRestore.push({
              collection: colName,
              docId: docSnap.id,
              type: 'document',
              previousData: { id: docSnap.id, ...data }
            });
            originalDeletionsAndUpdates.push((b) => b.delete(docSnap.ref));
          }
        });
      }

      // C. Process students (either delete profiles completely, or clear log/transaction fields)
      const studentsSnap = await getDocs(collection(db, 'students'));
      studentsSnap.docs.forEach(docSnap => {
        const st = docSnap.data();

        if (totalResetDeleteStudents) {
          // Wipe students completely!
          if (isDateInRange(st.createdAt, start, end)) {
            itemsToRestore.push({
              collection: 'students',
              docId: docSnap.id,
              type: 'document',
              previousData: { id: docSnap.id, ...st }
            });
            originalDeletionsAndUpdates.push((b) => b.delete(docSnap.ref));
          }
        } else {
          // Preserve students, just clear logs
          const att = st.attendance || [];
          const liturgy = st.liturgyAttendance || [];
          const hv = st.homeVisitations || {};
          const pv = st.phoneVisitations || {};
          const pts = st.points || 0;

          const filteredAtt = att.filter(d => !isDateInRange(d, start, end));
          const filteredLiturgy = liturgy.filter(d => !isDateInRange(d, start, end));
          
          let newHv = { ...hv };
          let newPv = { ...pv };
          let changed = false;

          Object.keys(hv).forEach(k => {
            if (isMonthInRange(k, start, end)) {
              delete newHv[k];
              changed = true;
            }
          });
          Object.keys(pv).forEach(k => {
            if (isDateInRange(k, start, end)) {
              delete newPv[k];
              changed = true;
            }
          });

          let newPts = pts;
          if (!isFilteredRange) {
            newPts = 0;
            changed = true;
          }

          if (filteredAtt.length !== att.length || filteredLiturgy.length !== liturgy.length || changed) {
            itemsToRestore.push({
              collection: 'students',
              docId: docSnap.id,
              type: 'update',
              previousData: {
                attendance: att,
                liturgyAttendance: liturgy,
                homeVisitations: hv,
                phoneVisitations: pv,
                points: pts
              }
            });
            originalDeletionsAndUpdates.push((b) => b.update(docSnap.ref, {
              attendance: filteredAtt,
              liturgyAttendance: filteredLiturgy,
              homeVisitations: newHv,
              phoneVisitations: newPv,
              points: newPts
            }));
          }
        }
      });

      // D. Process servants (either delete profiles completely, or clear weeklyFollowUp)
      servantsSnap.docs.forEach(docSnap => {
        const s = docSnap.data();
        const isGenAdmin = genAdminIds.has(docSnap.id);
        const isStageAdmin = stageAdminIds.has(docSnap.id);

        if (isGenAdmin) {
          // General Admins are always preserved. Filter weeklyFollowUp if range active.
          const wfu = s.weeklyFollowUp || {};
          let newWfu = { ...wfu };
          let changed = false;

          Object.keys(wfu).forEach(k => {
            if (isDateInRange(k, start, end)) {
              delete newWfu[k];
              changed = true;
            }
          });

          if (changed) {
            itemsToRestore.push({
              collection: 'servants',
              docId: docSnap.id,
              type: 'update',
              previousData: {
                weeklyFollowUp: wfu
              }
            });
            originalDeletionsAndUpdates.push((b) => b.update(docSnap.ref, {
              weeklyFollowUp: newWfu
            }));
          }
          return;
        }

        const shouldDeleteProfile = isStageAdmin ? totalResetDeleteStageAdmins : totalResetDeleteServants;

        if (shouldDeleteProfile) {
          // Wipe servant completely!
          if (isDateInRange(s.createdAt, start, end)) {
            itemsToRestore.push({
              collection: 'servants',
              docId: docSnap.id,
              type: 'document',
              previousData: { id: docSnap.id, ...s }
            });
            originalDeletionsAndUpdates.push((b) => b.delete(docSnap.ref));
          }
        } else {
          // Preserve servant, just clear weekly followup
          const wfu = s.weeklyFollowUp || {};
          let newWfu = { ...wfu };
          let changed = false;

          Object.keys(wfu).forEach(k => {
            if (isDateInRange(k, start, end)) {
              delete newWfu[k];
              changed = true;
            }
          });

          if (changed) {
            itemsToRestore.push({
              collection: 'servants',
              docId: docSnap.id,
              type: 'update',
              previousData: {
                weeklyFollowUp: wfu
              }
            });
            originalDeletionsAndUpdates.push((b) => b.update(docSnap.ref, {
              weeklyFollowUp: newWfu
            }));
          }
        }
      });

      // E. Run soft delete and execute
      const periodDesc = isFilteredRange 
        ? `للفترة من ${start || 'البداية'} إلى ${end || 'النهاية'}`
        : 'بالكامل';

      const desc = `ضبط المصنع للمنصة ${periodDesc} (مع حماية الحسابات الأساسية)`;
      await initiateSoftDelete(desc, 'total_reset', itemsToRestore, originalDeletionsAndUpdates);

      setShowTotalResetModal(false);
      setConfirmText('');
      setAdminPassword('');
      setTotalResetStartDate('');
      setTotalResetEndDate('');
      setTotalResetYear('all');
      setTotalResetMonth('all');
      setTotalResetDeleteStudents(false);
      setTotalResetDeleteServants(false);
      setTotalResetDeleteStageAdmins(false);
      
      setActionMessage({ 
        type: 'success', 
        text: `تم عمل ضبط مصنع للمنصة ${periodDesc} بنجاح! تم حفظ نسخة احتياطية صالحة للتراجع عنها بالكامل خلال 24 ساعة القادمة. 🚨🔥` 
      });
    } catch (err) {
      console.error(err);
      setTotalResetError(`فشل التحقق أو المسح: ${err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential' ? 'كلمة المرور غير صحيحة' : err.message}`);
    } finally {
      setTotalResetLoading(false);
    }
  };

  // Helper: Format countdown remaining text
  const getRemainingTime = (expiresAtStr) => {
    const expiresAt = new Date(expiresAtStr);
    const diff = expiresAt.getTime() - Date.now();
    if (diff <= 0) return 'منتهي الصلاحية';
    const hrs = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `متبقي ${hrs} ساعة و ${mins} دقيقة للتراجع`;
  };

  // Class mapping selection list
  const classesOptions = useMemo(() => {
    if (sectorStage === 'all') return [];
    return STAGE_CLASS_MAP[sectorStage] || [];
  }, [sectorStage]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-3 duration-300" dir="rtl">
      
      {/* ── Action Messages Alerts ── */}
      {actionMessage && (
        <div className={`p-4 rounded-xl border flex items-start gap-3 shadow-md transition-all ${
          actionMessage.type === 'success' 
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400' 
            : actionMessage.type === 'error'
            ? 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-455'
            : 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400'
        }`}>
          <div className="mt-0.5 shrink-0">
            {actionMessage.type === 'success' && <CheckCircle size={20} />}
            {actionMessage.type === 'error' && <AlertTriangle size={20} />}
            {actionMessage.type === 'info' && <Loader2 size={20} className="animate-spin" />}
          </div>
          <div className="flex-1 text-sm font-bold leading-relaxed">
            {actionMessage.text}
          </div>
          <button 
            onClick={() => setActionMessage(null)}
            className="text-xs font-black opacity-75 hover:opacity-100 cursor-pointer px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            إغلاق
          </button>
        </div>
      )}

      {/* ── 1. Soft Delete & Recovery Console (تاريخ عمليات الحذف والتراجع) ── */}
      <div className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm">
        <div className="flex items-center gap-2 mb-6 border-b border-slate-100 dark:border-slate-800 pb-3">
          <RotateCcw className="text-teal-500" size={22} />
          <h2 className="text-lg font-black text-slate-900 dark:text-white">سجل العمليات المعلقة للتراجع (آخر 24 ساعة)</h2>
        </div>

        {loadingHistory ? (
          <div className="flex items-center justify-center gap-2 py-8 text-slate-550 dark:text-slate-400">
            <Loader2 size={20} className="animate-spin text-blue-500" />
            <span className="text-sm font-bold">جاري تحميل سجل عمليات ضبط البيانات...</span>
          </div>
        ) : pendingDeletes.length === 0 ? (
          <div className="text-center py-8 text-slate-400 dark:text-slate-500 text-sm font-medium border border-dashed border-slate-250 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-950/20">
            لا توجد عمليات حذف أو ضبط معلقة للتراجع حالياً. جميع البيانات مستقرة ومؤمنة.
          </div>
        ) : (
          <div className="space-y-4">
            {pendingDeletes.map((item) => {
              const isExpired = new Date(item.expiresAt).getTime() <= Date.now();
              return (
                <div 
                  key={item.id}
                  className="bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition-all"
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                        {item.type === 'total_reset' ? 'ضبط مصنع كلي' : 'ضبط جزئي'}
                      </span>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{item.description}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400 font-bold">
                      <span className="flex items-center gap-1"><Clock size={14} />{getRemainingTime(item.expiresAt)}</span>
                      <span>بواسطة: {item.deletedBy}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleUndo(item.id)}
                    disabled={actionLoading || isExpired}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400 text-white font-bold text-xs rounded-xl shadow-sm hover:shadow transition-all disabled:opacity-50 cursor-pointer shrink-0 border-none"
                  >
                    <RotateCcw size={14} />
                    <span>تراجع واستعادة البيانات ↩️</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 2. Page Locks Management Console (إدارة قفل وحظر الصفحات المؤقت) ── */}
      <div className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm space-y-6">
        <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <Lock className="text-amber-500" size={22} />
          <h2 className="text-lg font-black text-slate-900 dark:text-white">إدارة قفل وحظر الصفحات المؤقت 🔒</h2>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400 font-bold leading-relaxed">
          يمكنك قفل صفحات معينة مؤقتاً لعرض شاشة "تحت الإنشاء أو الإصلاح" للخدام والمخدومين عند تصفحهم لها، مع السماح للأمين العام فقط بتخطي الحجب ومتابعة العمل على الصفحة لإصلاحها.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Form to Lock a Page */}
          <div className="bg-slate-50 dark:bg-[#0f172a]/40 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-black text-slate-800 dark:text-slate-200 border-b border-slate-150 dark:border-slate-850 pb-2">
              قفل صفحة جديدة 🔒
            </h3>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">اختر الصفحة المراد قفلها</label>
              <select
                value={selectedLockPath}
                onChange={(e) => setSelectedLockPath(e.target.value)}
                className="w-full bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white rounded-xl p-2.5 outline-none focus:border-blue-500 text-xs font-bold"
              >
                {LOCKABLE_PAGES.map(page => (
                  <option key={page.path} value={page.path}>{page.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">رسالة الحظر (تظهر للمستخدمين)</label>
              <textarea
                value={lockMessageText}
                onChange={(e) => setLockMessageText(e.target.value)}
                rows={3}
                placeholder="مثال: الصفحة في وضع الإصلاح لتحديث البيانات..."
                className="w-full bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white rounded-xl p-3 outline-none focus:border-blue-500 text-xs font-bold resize-none"
              />
            </div>

            <button
              onClick={handleLockPage}
              disabled={actionLoading}
              className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl shadow-md hover:shadow-amber-500/10 transition-all cursor-pointer flex items-center justify-center gap-1.5 border-none"
            >
              <Lock size={14} />
              <span>تأكيد قفل الصفحة وحجبها 🔒</span>
            </button>
          </div>

          {/* List of Locked Pages */}
          <div className="bg-slate-50 dark:bg-[#0f172a]/40 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-black text-slate-800 dark:text-slate-200 border-b border-slate-150 dark:border-slate-850 pb-2">
              الصفحات المغلقة حالياً 📋
            </h3>

            {pageLocksLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-slate-550 dark:text-slate-400">
                <Loader2 size={16} className="animate-spin text-blue-500" />
                <span className="text-xs font-bold">جاري تحميل حالة قفل الصفحات...</span>
              </div>
            ) : Object.keys(localPageLocks).length === 0 ? (
              <div className="text-center py-12 text-slate-400 dark:text-slate-500 text-xs font-bold border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#1e293b]/20">
                لا توجد أي صفحات مغلقة حالياً. جميع صفحات المنصة مفتوحة للجميع. 🔓✨
              </div>
            ) : (
              <div className="space-y-3 max-h-[250px] overflow-y-auto pr-1">
                {Object.keys(localPageLocks).map(pathKey => {
                  const lock = localPageLocks[pathKey];
                  return (
                    <div
                      key={pathKey}
                      className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shadow-sm"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                          <span className="text-xs font-black text-slate-800 dark:text-white">
                            {lock.pageName || pathKey}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-bold">
                          الرسالة: {lock.message}
                        </p>
                      </div>

                      <button
                        onClick={() => handleUnlockPage(pathKey)}
                        disabled={actionLoading}
                        className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-600 text-emerald-600 hover:text-white border border-emerald-500/20 hover:border-transparent font-bold text-[11px] rounded-lg transition-all cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        <span>إلغاء الحجب 🔓</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 3. Danger Zone (منطقة الخطر والضبط الجزئي/الكلي للبيانات) ── */}
      <div className="bg-rose-500/[0.02] border-2 border-rose-500/30 p-6 rounded-3xl shadow-sm space-y-8">
        
        <div className="flex items-center gap-2 pb-3 border-b border-rose-500/20">
          <ShieldAlert className="text-rose-600 dark:text-rose-500 animate-pulse" size={26} />
          <h2 className="text-xl font-black text-rose-600 dark:text-rose-500">منطقة الخطر: إدارة وتصفير البيانات</h2>
        </div>

        <p className="text-sm text-slate-550 dark:text-slate-405 font-bold leading-relaxed">
          ⚠️ **تنبيه هام جداً للأمين العام:** جميع العمليات في هذه المنطقة تؤثر بشكل مباشر وكبير على قاعدة البيانات والمنصة. تم تصميم هذه الواجهة لمسح وتصفير السجلات والبيانات بشكل آمن. أي عملية مسح هنا سيتم حفظها في لوحة التراجع أعلاه لمدة 24 ساعة كحظر مؤقت قبل الحذف النهائي والتام عبر السيرفر.
        </p>

        {/* Option cards grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* 2.1 Granular Reset - Logs (تصفير السجلات والافتقاد) */}
          <div className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800 pb-2">
                <Calendar size={18} className="text-blue-500" />
                <h3 className="font-black text-sm">تصفير سجلات الخدمة</h3>
              </div>

              {/* Log Type */}
              <div className="space-y-1">
                <label className="block text-sm font-bold text-black dark:text-white">نوع السجل المطلوب مسحه</label>
                <select 
                  value={logType} 
                  onChange={(e) => setLogType(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 text-slate-850 dark:text-white rounded-xl p-2.5 outline-none focus:border-blue-500 text-xs font-bold"
                >
                  <option value="attendance">حضور الخدمة والقداس والصفات (المخدومين)</option>
                  <option value="visitation">سجلات الافتقاد (تليفوني ومنزلي)</option>
                  <option value="notifications">سجل الإشعارات المرسلة والمجدولة</option>
                  <option value="servants_followup">سجلات متابعة خدام مدارس الأحد (التحضير والاجتماع)</option>
                  <option value="points_history">رصيد الصفات وسجل النقاط للطلاب 🌟</option>
                </select>
              </div>

              {/* Dynamic Description Box */}
              <div className="p-3 bg-blue-500/5 dark:bg-blue-500/10 border border-blue-500/20 rounded-xl space-y-1">
                <h4 className="text-xs font-black text-blue-600 dark:text-blue-400 flex items-center gap-1">💡 تفاصيل ما سيتم حذفه:</h4>
                <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 leading-relaxed">
                  {logType === 'attendance' && "سيتم مسح تواريخ حضور القداس والإفتقاد الأسبوعي بالكامل للفترة المحددة من ملفات المخدومين، وحذف مستندات الغياب والحضور التفصيلية المسجلة بجدول الحضور العام (attendance) لهذه الفترة. (كشوف وبيانات الطلاب والخدام وحساباتهم آمنة تماماً ولن تُحذف)."}
                  {logType === 'visitation' && "سيتم مسح كافه لوجات الافتقاد التليفوني والمنزلي المسجلة للطلاب خلال النطاق الزمني المحدد. (بيانات المخدومين الشخصية وهواتفهم وفصولهم آمنة تماماً ولن تُحذف)."}
                  {logType === 'notifications' && "سيتم مسح تاريخ وحقيبة الإشعارات المرسلة سابقاً لهواتف أولياء الأمور والخدام للفترة المحددة، وحذف جميع الإشعارات المجدولة مستقبلاً المندرجة في هذه الفترة."}
                  {/* Option moved to Store Reset Panel */}
                  {logType === 'servants_followup' && "سيتم مسح سجلات تحضير الدروس الأسبوعية وحضور اجتماع الخدمة المسجلة بداخل وثائق الخدام للفترة المحددة. (حسابات الخدام وصلاحيات دخولهم وفصولهم آمنة تماماً ولن تتأثر)."}
                  {logType === 'points_history' && "سيتم مسح وحذف سجل تاريخ كسب وخصم النقاط بالكامل (pointsHistory) للفترة المحددة. في حال عدم تحديد تواريخ، سيتم تصفير أرصدة الصفات/النقاط لجميع الطلاب لتصبح 0. وفي حال تحديد تواريخ، سيتم إرجاع/خصم التعديلات المسجلة في هذه الفترة من رصيدهم الحالي تلقائياً."}
                </p>
              </div>

              {/* Filter Mode Switcher */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-black font-black dark:text-white">نوع التحديد الزمني</label>
                <div className="flex bg-slate-100 dark:bg-[#0f172a] p-1 rounded-xl gap-1">
                  <button
                    type="button"
                    onClick={() => setLogFilterMode('quick')}
                    className={`flex-1 py-1.5 px-2 rounded-lg font-bold text-xs transition-all cursor-pointer border-none ${logFilterMode === 'quick' ? 'bg-white dark:bg-[#1e293b] text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-505 dark:text-slate-400 hover:text-slate-700'}`}
                  >
                    السنة والشهر 📅
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogFilterMode('custom')}
                    className={`flex-1 py-1.5 px-2 rounded-lg font-bold text-xs transition-all cursor-pointer border-none ${logFilterMode === 'custom' ? 'bg-white dark:bg-[#1e293b] text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-505 dark:text-slate-400 hover:text-slate-700'}`}
                  >
                    فترة مخصصة ⏱️
                  </button>
                </div>
              </div>

              {logFilterMode === 'quick' ? (
                /* Year / Month Selector */
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-[11px] font-bold text-slate-400">السنة</label>
                    <select 
                      value={logYear} 
                      onChange={(e) => setLogYear(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 text-slate-855 dark:text-white rounded-xl p-2 outline-none focus:border-blue-500 text-xs font-bold"
                    >
                      <option value="all">كل السنين</option>
                      {yearsOptions.map(y => (
                        <option key={y} value={String(y)}>{y}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[11px] font-bold text-slate-400">الشهر</label>
                    <select 
                      value={logMonth} 
                      disabled={logYear === 'all'}
                      onChange={(e) => setLogMonth(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 text-slate-855 dark:text-white rounded-xl p-2 outline-none focus:border-blue-500 text-xs font-bold disabled:opacity-50"
                    >
                      <option value="all">كل الشهور</option>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                        <option key={m} value={m}>{m} ({new Date(2000, m - 1).toLocaleString('ar-EG', { month: 'long' })})</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                /* Date Range Selector */
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-[11px] font-bold text-slate-400">من تاريخ</label>
                    <input
                      type="date"
                      value={logStartDate}
                      onChange={(e) => setLogStartDate(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 text-slate-855 dark:text-white rounded-xl p-2 outline-none focus:border-blue-500 text-xs font-bold"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[11px] font-bold text-slate-400">إلى تاريخ</label>
                    <input
                      type="date"
                      value={logEndDate}
                      onChange={(e) => setLogEndDate(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 text-slate-855 dark:text-white rounded-xl p-2 outline-none focus:border-blue-500 text-xs font-bold"
                    />
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={handleLogsReset}
              disabled={actionLoading}
              className="w-full py-3 bg-rose-600/10 hover:bg-rose-600 text-rose-650 dark:text-rose-455 hover:text-white border border-rose-500/20 hover:border-transparent font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Trash2 size={14} />
              <span>مسح السجلات المحددة 🗑️</span>
            </button>
          </div>

          {/* 2.2 Granular Reset - Servants and Students (حذف الخدام والمخدومين) */}
          <div className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800 pb-2">
                <Users size={18} className="text-teal-500" />
                <h3 className="font-black text-sm">مسح الخدام والمخدومين قطاعياً</h3>
              </div>

              {/* Servants or Students Toggle */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-400">الفئة المستهدفة بالمسح</label>
                <select 
                  value={sectorType} 
                  onChange={(e) => setSectorType(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 text-slate-850 dark:text-white rounded-xl p-2.5 outline-none focus:border-blue-500 text-xs font-bold"
                >
                  <option value="students">المخدومين (كشوف الطلاب بالكامل)</option>
                  <option value="servants">الخدام (ما عدا الأمناء العموم)</option>
                </select>
              </div>

              {sectorType === 'servants' && (
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-355 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={sectorDeleteStageAdmins}
                    onChange={(e) => setSectorDeleteStageAdmins(e.target.checked)}
                    className="rounded border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                  />
                  <span>حذف أمناء المراحل أيضاً 🏫</span>
                </label>
              )}

              {/* Dynamic Description Box */}
              <div className="p-3 bg-blue-500/5 dark:bg-blue-500/10 border border-blue-500/20 rounded-xl space-y-1">
                <h4 className="text-xs font-black text-blue-600 dark:text-blue-400 flex items-center gap-1">💡 تفاصيل ما سيتم حذفه:</h4>
                <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 leading-relaxed">
                  {sectorType === 'students' && "سيتم مسح وحذف وثائق وملفات المخدومين (الطلاب) بالكامل من الفصول والمراحل المحددة، وسيتعين عليهم إعادة تسجيل بياناتهم مجدداً أو إضافتهم يدوياً من جديد. (يمكنك التراجع واستعادتهم بالكامل خلال 24 ساعة)."}
                  {sectorType === 'servants' && `سيتم مسح وحذف وثائق وحسابات الخدام بالكامل للمرحلة أو الفصل الدراسي المحدد، وحذف حسابات دخولهم من المنصة. ${sectorDeleteStageAdmins ? '(تم تضمين أمناء المراحل في عملية الحذف).' : '(أمناء المراحل محصنون ومحفوظون تلقائياً من الحذف لحماية هيكلية الخدمة).'}`}
                </p>
              </div>



              {/* Stage Filter */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-400">المرحلة الدراسية</label>
                  <select 
                    value={sectorStage} 
                    onChange={(e) => setSectorStage(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 text-slate-850 dark:text-white rounded-xl p-2.5 outline-none focus:border-blue-500 text-xs font-bold"
                  >
                    <option value="all">كل المراحل</option>
                    <option value="ابتدائي">ابتدائي</option>
                    <option value="اعدادي">اعدادي</option>
                    <option value="ثانوي">ثانوي</option>
                  </select>
                </div>

                {/* Class Filter */}
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-400">الفصل</label>
                  <select 
                    value={sectorClass} 
                    disabled={sectorStage === 'all'}
                    onChange={(e) => setSectorClass(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 text-slate-850 dark:text-white rounded-xl p-2.5 outline-none focus:border-blue-500 text-xs font-bold disabled:opacity-50"
                  >
                    <option value="all">كل الفصول</option>
                    {classesOptions.map(cls => (
                      <option key={cls} value={cls}>{cls}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <button
              onClick={handleSectorReset}
              disabled={actionLoading}
              className="w-full py-3 bg-rose-600/10 hover:bg-rose-600 text-rose-650 dark:text-rose-455 hover:text-white border border-rose-500/20 hover:border-transparent font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Trash2 size={14} />
              <span>مسح الفئة المحددة 🗑️</span>
            </button>
          </div>

          {/* 2.3 Granular Reset - Store (تصفير المعرض والطلبات) */}
          <div className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800 pb-2">
                <ShoppingBag size={18} className="text-amber-500" />
                <h3 className="font-black text-sm">تصفير معرض الصفات والهدايا</h3>
              </div>

              {/* Store reset option */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-400">قسم المعرض المطلوب تصفيره</label>
                <select 
                  value={storeResetType} 
                  onChange={(e) => setStoreResetType(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 text-slate-850 dark:text-white rounded-xl p-2.5 outline-none focus:border-blue-500 text-xs font-bold"
                >
                  <option value="products">تصفير الهدايا والمنتجات المعروضة بالكامل</option>
                  <option value="orders">تصفير وحذف جميع طلبات شراء الهدايا</option>
                </select>
              </div>

              {/* Dynamic Description Box */}
              <div className="p-3 bg-blue-500/5 dark:bg-blue-500/10 border border-blue-500/20 rounded-xl space-y-1">
                <h4 className="text-xs font-black text-blue-600 dark:text-blue-400 flex items-center gap-1">💡 تفاصيل ما سيتم حذفه:</h4>
                <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 leading-relaxed">
                  {storeResetType === 'products' && "سيتم مسح وحذف كافة المنتجات والهدايا المعروضة للبيع بداخل معرض الصفات بالكامل، وسيصبح المعرض خالياً تماماً من الألعاب والهدايا."}
                  {storeResetType === 'orders' && "سيتم تصفير وحذف جميع وثائق طلبات شراء الهدايا (قيد الانتظار، تم الاستلام، الأرشيف) بالكامل. (لن يتم تعديل أرصدة نقاط المخدومين الحالية أو إرجاع نقاط هذه الطلبات لهم)."}
                </p>
              </div>
            </div>

            <button
              onClick={handleStoreReset}
              disabled={actionLoading}
              className="w-full py-3 bg-rose-600/10 hover:bg-rose-600 text-rose-650 dark:text-rose-455 hover:text-white border border-rose-500/20 hover:border-transparent font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Trash2 size={14} />
              <span>تصفير المعرض المالي 🗑️</span>
            </button>
          </div>

        </div>

        {/* 2.4 Total Factory Reset Button (ضبط المصنع الكلي) */}
        <div className="pt-6 border-t border-rose-500/20 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="space-y-1">
            <h3 className="text-base font-black text-rose-600 dark:text-rose-500 flex items-center gap-1.5">
              <ShieldAlert size={18} />
              <span>الضبط الشامل للمنصة (Total Factory Reset)</span>
            </h3>
            <p className="text-xs text-slate-505 dark:text-slate-400 font-bold">
              سيقوم هذا الإجراء بتصفير ومسح كافة لوجات النشاط والبيانات والإعدادات (مع إتاحة خيار حذف الكشوف احتياطياً).
            </p>
          </div>

          <button
            onClick={() => setShowTotalResetModal(true)}
            disabled={actionLoading}
            className="px-6 py-3.5 bg-rose-600 hover:bg-rose-700 text-white font-black text-sm rounded-xl shadow-lg hover:shadow-rose-600/20 transition-all active:scale-95 cursor-pointer shrink-0 border-none flex items-center gap-2"
          >
            <ShieldAlert size={18} />
            <span>بدء تصفير المنصة بالكامل 🚨</span>
          </button>
        </div>

      </div>

      {/* ── 3. Total Factory Reset Confirmation Modal ── */}
      {showTotalResetModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" dir="rtl">
          <div className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl p-6 space-y-5 text-slate-800 dark:text-slate-100 overflow-y-auto max-h-[90vh] animate-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 pb-3 text-rose-650 dark:text-rose-500">
              <ShieldAlert size={30} className="animate-bounce" />
              <div>
                <h3 className="text-lg font-black">تحذير أمني خطير: ضبط المصنع للمنصة</h3>
                <p className="text-xs text-slate-505 dark:text-slate-400 font-bold">أنت على وشك مسح وإفراغ قاعدة البيانات كلياً كأنك تفتح المنصة لأول مرة!</p>
              </div>
            </div>

            {/* Warning text */}
            <p className="text-xs font-bold text-slate-550 dark:text-slate-400 leading-relaxed bg-rose-500/5 p-4 rounded-xl border border-rose-500/10">
              يرجى العلم أن هذا الإجراء سيمسح سجلات حضور مدرسة الأحد والقداس والافتقاد ونقاط البونص، والطلبات، والهدايا، والإشعارات، والإعدادات بالكامل. **سيبقى كشف المخدومين والخدام محفوظاً بشكل افتراضي**، ويمكنك تفعيل خيارات حذفهما نهائياً أدناه. العملية تدعم التراجع خلال 24 ساعة.
            </p>

            <form onSubmit={handleTotalFactoryReset} className="space-y-4">
              
              {/* Optional Date Range Filter for Total Reset */}
              <div className="bg-slate-50 dark:bg-[#0f172a]/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                <h4 className="text-xs font-black text-slate-700 dark:text-slate-350">تحديد فترة زمنية للتصفير الكلي (اختياري):</h4>
                
                {/* Switcher */}
                <div className="flex bg-white dark:bg-[#1e293b] p-1 rounded-lg gap-1 border border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setTotalResetFilterMode('quick')}
                    className={`flex-1 py-1 px-1.5 rounded font-bold text-[10px] transition-all cursor-pointer border-none ${totalResetFilterMode === 'quick' ? 'bg-slate-100 dark:bg-[#0f172a] text-blue-650 dark:text-blue-455 shadow-sm' : 'text-slate-500 hover:text-slate-750'}`}
                  >
                    السنة والشهر 📅
                  </button>
                  <button
                    type="button"
                    onClick={() => setTotalResetFilterMode('custom')}
                    className={`flex-1 py-1 px-1.5 rounded font-bold text-[10px] transition-all cursor-pointer border-none ${totalResetFilterMode === 'custom' ? 'bg-slate-100 dark:bg-[#0f172a] text-blue-650 dark:text-blue-455 shadow-sm' : 'text-slate-500 hover:text-slate-750'}`}
                  >
                    فترة مخصصة ⏱️
                  </button>
                </div>

                {totalResetFilterMode === 'quick' ? (
                  /* Quick year/month selection */
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-400">السنة</label>
                      <select 
                        value={totalResetYear} 
                        onChange={(e) => setTotalResetYear(e.target.value)}
                        className="w-full bg-white dark:bg-[#1e293b] border border-slate-255 dark:border-slate-850 text-slate-855 dark:text-white rounded-lg p-2 outline-none focus:border-blue-500 text-xs font-bold"
                      >
                        <option value="all">كل السنين</option>
                        {yearsOptions.map(y => (
                          <option key={y} value={String(y)}>{y}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-400">الشهر</label>
                      <select 
                        value={totalResetMonth} 
                        disabled={totalResetYear === 'all'}
                        onChange={(e) => setTotalResetMonth(e.target.value)}
                        className="w-full bg-white dark:bg-[#1e293b] border border-slate-255 dark:border-slate-850 text-slate-855 dark:text-white rounded-lg p-2 outline-none focus:border-blue-500 text-xs font-bold disabled:opacity-50"
                      >
                        <option value="all">كل الشهور</option>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                          <option key={m} value={m}>{m} ({new Date(2000, m - 1).toLocaleString('ar-EG', { month: 'long' })})</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  /* Custom Start/End Range selection */
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-400">من تاريخ</label>
                      <input
                        type="date"
                        value={totalResetStartDate}
                        onChange={(e) => setTotalResetStartDate(e.target.value)}
                        className="w-full bg-white dark:bg-[#1e293b] border border-slate-255 dark:border-slate-850 text-slate-855 dark:text-white rounded-lg p-2 outline-none focus:border-blue-500 text-xs font-bold"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-400">إلى تاريخ</label>
                      <input
                        type="date"
                        value={totalResetEndDate}
                        onChange={(e) => setTotalResetEndDate(e.target.value)}
                        className="w-full bg-white dark:bg-[#1e293b] border border-slate-255 dark:border-slate-850 text-slate-855 dark:text-white rounded-lg p-2 outline-none focus:border-blue-500 text-xs font-bold"
                      />
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">
                  * اترك الفترات فارغة لتصفير قاعدة البيانات كاملة منذ البداية كأن الموقع افتتح الآن.
                </p>
              </div>

              {/* Optional Checklist for Deleting Profiles */}
              <div className="bg-slate-50 dark:bg-[#0f172a]/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                <h4 className="text-xs font-black text-slate-700 dark:text-slate-300">خيارات حذف الحسابات والكشوف (احتياطي):</h4>
                
                <div className="space-y-2.5">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-305 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={totalResetDeleteStudents}
                      onChange={(e) => setTotalResetDeleteStudents(e.target.checked)}
                      className="rounded border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4"
                    />
                    <span>حذف جميع كشوف وحسابات المخدومين (الطلاب) بالكامل 🗑️</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-305 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={totalResetDeleteServants}
                      onChange={(e) => setTotalResetDeleteServants(e.target.checked)}
                      className="rounded border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                    />
                    <span>حذف جميع كشوف وحسابات الخدام بالكامل (ما عدا الأمناء العموم وأمناء المراحل) 🔒</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-305 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={totalResetDeleteStageAdmins}
                      onChange={(e) => setTotalResetDeleteStageAdmins(e.target.checked)}
                      className="rounded border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                    />
                    <span>حذف جميع كشوف وحسابات أمناء المراحل أيضاً 🏫</span>
                  </label>
                </div>
                
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold leading-normal">
                  * في حال عدم تحديد أي خيار (الوضع الافتراضي الآمن)، سيتم الحفاظ على كشوف وحسابات الخدام والمخدومين مع تصفير سجلات حضورهم وغيابهم ونقاطهم ومتابعاتهم فقط.
                </p>
              </div>

              {/* Text confirmation check */}
              <div className="space-y-1.5">
                <label className="block text-xs font-black text-slate-655 dark:text-slate-355">
                  لتأكيد رغبتك، يرجى كتابة <span className="font-black text-rose-600 dark:text-rose-455 select-all font-mono tracking-wider">CONFIRM RESET</span> في المربع أدناه:
                </label>
                <input
                  type="text"
                  dir="ltr"
                  className="w-full bg-slate-50 dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-855 rounded-xl p-3 focus:ring-2 focus:ring-rose-500 outline-none text-center font-black tracking-widest text-sm"
                  placeholder="CONFIRM RESET"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  required
                />
              </div>

              {/* Password Verification check */}
              <div className="space-y-1.5">
                <label className="block text-xs font-black text-slate-655 dark:text-slate-355">
                  الرجاء إدخال كلمة مرور حساب الأدمن الحالي للتحقق الأمني:
                </label>
                <input
                  type="password"
                  className="w-full bg-slate-50 dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-855 rounded-xl p-3 focus:ring-2 focus:ring-rose-500 outline-none font-bold text-center"
                  placeholder="••••••••"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  required
                />
              </div>

              {/* Error messages */}
              {totalResetError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-455 rounded-xl text-xs font-bold">
                  ⚠️ {totalResetError}
                </div>
              )}

              {/* Modal Buttons */}
              <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowTotalResetModal(false);
                    setConfirmText('');
                    setAdminPassword('');
                    setTotalResetError('');
                    setTotalResetStartDate('');
                    setTotalResetEndDate('');
                    setTotalResetYear('all');
                    setTotalResetMonth('all');
                    setTotalResetDeleteStudents(false);
                    setTotalResetDeleteServants(false);
                    setTotalResetDeleteStageAdmins(false);
                  }}
                  className="px-5 py-2.5 bg-slate-100 dark:bg-slate-850 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl cursor-pointer transition-all border-none"
                >
                  إلغاء الأمر
                </button>
                <button
                  type="submit"
                  disabled={totalResetLoading}
                  className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs rounded-xl cursor-pointer shadow-md hover:shadow-rose-600/10 transition-all flex items-center gap-1.5 border-none"
                >
                  {totalResetLoading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>جاري تصفير المنصة...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} />
                      <span>تأكيد ضبط المصنع 🗑️</span>
                    </>
                  )}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
}
