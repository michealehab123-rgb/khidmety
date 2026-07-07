import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { useAuth } from '../context/AuthContext';
import { isStoreVisibleForStudent } from '../utils/storeConfig';
import { 
  db, 
  doc, 
  getDoc, 
  getDocFromCache,
  runTransaction, 
  collection, 
  serverTimestamp,
  onSnapshot,
  writeBatch
} from '../firebase';
import { Camera, Check, X, ShieldAlert, Star, Loader2, Sparkles, ArrowRight, Church } from 'lucide-react';

const normalizeArabic = (str) => {
  if (!str) return '';
  return str
    .replace(/[أإآا]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/[ةه]/g, 'ه')
    .trim();
};

export default function QrScannerPage() {
  const { servant, isGeneralAdmin, isServant, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [scannerStarted, setScannerStarted] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [isScanningPaused, setIsScanningPaused] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleStatusChange = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', handleStatusChange);
    window.addEventListener('offline', handleStatusChange);
    return () => {
      window.removeEventListener('online', handleStatusChange);
      window.removeEventListener('offline', handleStatusChange);
    };
  }, []);

  // Student details loaded from scanned QR code
  const [scannedStudent, setScannedStudent] = useState(null);
  const [todayAttendanceData, setTodayAttendanceData] = useState(null);
  const [loadingStudent, setLoadingStudent] = useState(false);
  const [attendedLiturgy, setAttendedLiturgy] = useState(false);

  // Points input value
  const [pointsInput, setPointsInput] = useState('');
  const [storeConfigs, setStoreConfigs] = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'store_config'), (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStoreConfigs(list);
    });
    return () => unsub();
  }, []);

  const storeVisible = scannedStudent ? isStoreVisibleForStudent(scannedStudent, storeConfigs) : true;
  const isPointsValid = storeVisible === false
    ? /^\d*$/.test(pointsInput)
    : /^\d+$/.test(pointsInput) && Number(pointsInput) >= 0;

  // Saved configs (specifically for streak gifts & class shortcuts)
  const [attendanceConfigs, setAttendanceConfigs] = useState({});
  const [classShortcuts, setClassShortcuts] = useState({});

  // Feedback notifications
  const [notification, setNotification] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const scannerRef = useRef(null);

  // Load configs
  useEffect(() => {
    const unsubConfigs = onSnapshot(collection(db, 'attendance_config'), (snapshot) => {
      const configMap = {};
      snapshot.docs.forEach(doc => {
        configMap[doc.id] = doc.data();
      });
      setAttendanceConfigs(configMap);
    });

    const unsubShortcuts = onSnapshot(collection(db, 'class_shortcuts_config'), (snapshot) => {
      const configMap = {};
      snapshot.docs.forEach(doc => {
        if (doc.exists()) {
          configMap[doc.id] = doc.data().buttons || [5, 10, 20];
        }
      });
      setClassShortcuts(configMap);
    });

    return () => {
      unsubConfigs();
      unsubShortcuts();
    };
  }, []);

  // Determine if student is under the logged in servant's responsibility
  const isStudentUnderResponsibility = (studentData) => {
    if (isGeneralAdmin) return true; // General admin has full church access
    if (!servant) return false;

    const roleNorm = servant.role ? normalizeArabic(servant.role) : '';
    const isStageServant = roleNorm.includes('مرحله');
    
    const studentClass = studentData.assignedClass || '';
    const normStudentClass = normalizeArabic(studentClass);
    
    if (isStageServant) {
      // Stage Servant: matches managed classes or stage
      const managedClasses = (servant.managedClasses || []).map(c => normalizeArabic(c));
      if (managedClasses.length > 0) {
        return managedClasses.includes(normStudentClass);
      }
      const servantStage = servant.assignedStage || servant.grade || '';
      return normalizeArabic(studentData.schoolGrade) === normalizeArabic(servantStage);
    } else {
      // Class Servant: matches assigned class or list of classes
      const myClass = servant.assignedClass || servant.assignment || '';
      const myClasses = servant.myClasses && servant.myClasses.length > 0
        ? servant.myClasses
        : (myClass ? [myClass] : []);
      const normalizedMyClasses = myClasses.map(c => normalizeArabic(c));
      return normalizedMyClasses.includes(normStudentClass);
    }
  };

  // Get shortcuts configured for a class
  const getShortcutsForClass = (clsName) => {
    const key = clsName ? clsName.replace(/\//g, '-') : 'عام';
    const config = classShortcuts[key];
    return Array.isArray(config) && config.length > 0 ? config : [5, 10, 20];
  };

  // Initialize camera scanner
  useEffect(() => {
    if (authLoading) return;
    if (!isServant && !isGeneralAdmin) {
      navigate('/login');
      return;
    }

    const html5QrCode = new Html5Qrcode("qr-reader");
    scannerRef.current = html5QrCode;

    const startScanner = async () => {
      const isFriday = new Date().getDay() === 5;
      if (!isFriday) {
        setCameraError("عذراً، تسجيل الحضور السريع بالـ QR متاح فقط يوم الجمعة ⚠️");
        return;
      }
      try {
        await html5QrCode.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: (width, height) => {
              const size = Math.min(width, height) * 0.75;
              return { width: size, height: size };
            }
          },
          (qrCodeMessage) => {
            handleQrScanned(qrCodeMessage);
          },
          (errorMessage) => {
            // Quietly ignore scan frame errors
          }
        );
        setScannerStarted(true);
        setCameraError(null);
      } catch (err) {
        console.error("Failed to start scanner:", err);
        setCameraError("عذراً، لم نتمكن من تشغيل الكاميرا. يرجى التأكد من إعطاء صلاحية الكاميرا للمتصفح.");
      }
    };

    // Delay camera start slightly to ensure element is in DOM
    const timer = setTimeout(() => {
      startScanner();
    }, 500);

    return () => {
      clearTimeout(timer);
      if (html5QrCode.isScanning) {
        html5QrCode.stop().catch(err => console.error("Failed to stop scanner on cleanup:", err));
      }
    };
  }, [authLoading, isServant, isGeneralAdmin, navigate]);

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

  const pauseScanning = () => {
    setIsScanningPaused(true);
    try {
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.pause();
      }
    } catch (err) {
      console.warn("Failed to pause scanner hardware:", err);
    }
  };

  const resumeScanning = () => {
    setIsScanningPaused(false);
    setScannedStudent(null);
    setTodayAttendanceData(null);
    setPointsInput('');
    try {
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.resume();
      }
    } catch (err) {
      console.warn("Failed to resume scanner hardware:", err);
    }
  };

  const handleQrScanned = async (studentDocId) => {
    if (isScanningPaused) return;
    const isFriday = new Date().getDay() === 5;
    if (!isFriday) {
      showNotification("عذراً، تسجيل الحضور متاح فقط يوم الجمعة ⚠️", "error");
      return;
    }
    pauseScanning();
    setLoadingStudent(true);

    try {
      const trimmedId = studentDocId.trim();
      const studentDocRef = doc(db, 'students', trimmedId);
      
      let studentSnap;
      try {
        studentSnap = await getDocFromCache(studentDocRef);
      } catch (cacheError) {
        studentSnap = await getDoc(studentDocRef);
      }

      if (!studentSnap.exists()) {
        showNotification("رمز الاستجابة السريع (QR) غير صالح أو المخدوم غير موجود بالسيستم ⚠️", "error");
        resumeScanning();
        return;
      }

      const studentData = studentSnap.data();
      
      // Enforce responsibility check
      if (!isStudentUnderResponsibility(studentData)) {
        showNotification("عذراً، هذا المخدوم ليس تحت مسؤوليتك أو في نطاق صلاحيتك ⚠️", "error");
        resumeScanning();
        return;
      }

      const studentObj = { id: studentSnap.id, ...studentData };

      // Compute today's date YYYY-MM-DD
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      // Check duplicate in student attendance array (Source of Truth)
      const isAlreadyAttended = studentData.attendance && studentData.attendance.includes(todayStr);
      let attendanceData = null;

      if (isAlreadyAttended) {
        // Fetch today's attendance document from root collection: attendance/{studentId}_{todayStr}
        const attendanceDocId = `${trimmedId}_${todayStr}`;
        const attendanceRef = doc(db, 'attendance', attendanceDocId);
        try {
          let attendanceSnap;
          try {
            attendanceSnap = await getDocFromCache(attendanceRef);
          } catch (e) {
            attendanceSnap = await getDoc(attendanceRef);
          }
          if (attendanceSnap.exists()) {
            attendanceData = attendanceSnap.data();
          }
        } catch (error) {
          console.warn("Error fetching duplicate check-in details (might be offline):", error);
        }
        
        // Fallback placeholder if offline or details doc not found, ensuring modal blocks scan
        if (!attendanceData) {
          attendanceData = {
            date: todayStr,
            attended: true,
            dayPoints: 0,
            lastUpdatedBy: 'غير معروف (أوفلاين/تم الحذف)'
          };
        }
      }

      setTodayAttendanceData(attendanceData);
      setPointsInput('');
      const isLiturgyAlreadyAttended = studentData.liturgyAttendance && studentData.liturgyAttendance.includes(todayStr);
      setAttendedLiturgy(!!isLiturgyAlreadyAttended);
      setScannedStudent(studentObj);
    } catch (error) {
      console.error("Error fetching scanned student details:", error);
      showNotification("حدث خطأ أثناء جلب بيانات المخدوم ❌", "error");
      resumeScanning();
    } finally {
      setLoadingStudent(false);
    }
  };

  const handleConfirmAttendance = async () => {
    if (!scannedStudent || submitting || !isPointsValid) return;
    if (todayAttendanceData) return; // Block double check-in

    const isFriday = new Date().getDay() === 5;
    if (!isFriday) {
      showNotification("عذراً، تسجيل الحضور متاح فقط يوم الجمعة ⚠️", "error");
      return;
    }

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const servantName = servant?.name || 'خادم غير معروف';
    const pointsToAdd = Number(pointsInput);

    setSubmitting(true);

    try {
      const studentId = scannedStudent.id;
      const studentRef = doc(db, 'students', studentId);
      const attendanceDocId = `${studentId}_${todayStr}`;
      const todayAttendanceRef = doc(db, 'attendance', attendanceDocId);

      // 1. Read student document (from cache or network)
      let transStudentSnap;
      try {
        transStudentSnap = await getDocFromCache(studentRef);
      } catch (cacheError) {
        transStudentSnap = await getDoc(studentRef);
      }

      if (!transStudentSnap.exists()) {
        throw new Error('المخدوم غير موجود بقاعدة البيانات');
      }
      const currentStudentData = transStudentSnap.data();

      // Check duplicate in student attendance array
      const currentAttendanceArray = currentStudentData.attendance || [];
      if (currentAttendanceArray.includes(todayStr)) {
        throw new Error('تم تحضير هذا المخدوم بالفعل اليوم!');
      }

      // Backward compatibility updates
      let newAttendanceArray = [...currentAttendanceArray];
      if (!newAttendanceArray.includes(todayStr)) {
        newAttendanceArray.push(todayStr);
      }

      // Liturgy attendance updates
      let newLiturgyArray = [...(currentStudentData.liturgyAttendance || [])];
      if (attendedLiturgy && !newLiturgyArray.includes(todayStr)) {
        newLiturgyArray.push(todayStr);
      } else if (!attendedLiturgy && newLiturgyArray.includes(todayStr)) {
        newLiturgyArray = newLiturgyArray.filter(d => d !== todayStr);
      }

      const newPoints = (currentStudentData.points || 0) + pointsToAdd;

      const studentUpdates = {
        attendance: newAttendanceArray,
        points: newPoints,
        liturgyAttendance: newLiturgyArray
      };

      // Streak updates (only when registering attendance for the first time today)
      const safeClassId = currentStudentData.assignedClass ? currentStudentData.assignedClass.replace(/\//g, '-') : '';
      const consecutiveGiftEnabled = !!attendanceConfigs[safeClassId]?.consecutiveGiftEnabled;
      
      if (consecutiveGiftEnabled) {
        const newStreak = (currentStudentData.attendanceStreak || 0) + 1;
        let newGifts = currentStudentData.pendingGifts || 0;
        if (newStreak > 0 && newStreak % 4 === 0) {
          newGifts += 1;
        }
        studentUpdates.attendanceStreak = newStreak;
        studentUpdates.pendingGifts = newGifts;
      }

      const batch = writeBatch(db);

      // 1. Update/set daily attendance doc in root collection
      batch.set(todayAttendanceRef, {
        studentId: studentId,
        date: todayStr,
        stage: currentStudentData.schoolGrade || '',
        class: currentStudentData.assignedClass || '',
        status: 'present',
        servantName: servantName,
        pointsAdded: pointsToAdd,
        updatedAt: new Date(),
        attendedLiturgy: attendedLiturgy,
        // Legacy keys for QR check-in page fallback compatibility:
        attended: true,
        dayPoints: pointsToAdd,
        timestamp: new Date(),
        lastUpdatedBy: servantName
      }, { merge: true });

      // 2. Update student document
      batch.update(studentRef, studentUpdates);

      // 3. Log into pointsHistory
      const historyRef = doc(collection(db, 'pointsHistory'));
      batch.set(historyRef, {
        studentId: studentId,
        amount: pointsToAdd,
        points: pointsToAdd,
        reason: `حضور ذكي QR (+${pointsToAdd} نقاط) - خادم: ${servantName}`,
        createdAt: new Date()
      });

      // Commit batch (supported offline, won't block UI if slow/offline)
      const commitPromise = batch.commit();
      
      // Prevent unhandled promise rejection warnings in the background
      commitPromise.catch(error => {
        console.error("Background Firestore sync failed:", error);
      });

      const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 150, 'timeout'));
      const result = await Promise.race([
        commitPromise.then(() => 'success'),
        timeoutPromise
      ]);

      if (result === 'timeout') {
        console.log("Batch commit is taking longer than 150ms (likely offline). Proceeding with UI.");
      }

      showNotification(`تم تسجيل حضور المخدوم (${scannedStudent.name}) وإضافة +${pointsToAdd} نقاط بنجاح! 🎉`, 'success');
      resumeScanning();
    } catch (error) {
      console.error("Attendance confirmation failed: ", error);
      showNotification(error.message || "حدث خطأ أثناء الحفظ، يرجى المحاولة مرة أخرى ❌", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    if (isGeneralAdmin) {
      navigate('/admin');
    } else {
      navigate('/servant/dashboard');
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return 'ساعة غير معروفة';
    const dateObj = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return dateObj.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-4">
        <Loader2 className="animate-spin text-blue-600 dark:text-blue-400" size={48} />
        <p className="text-lg font-black text-slate-400">جاري التحقق من الصلاحيات...</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-8" dir="rtl">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <button 
          onClick={handleBack} 
          className="p-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-200 rounded-2xl transition-all shadow-sm flex items-center justify-center cursor-pointer select-none active:scale-95 border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
          title="العودة للوحة التحكم"
        >
          <ArrowRight size={20} className="stroke-[2.5]" />
        </button>
        <div className="text-center flex-1">
          <h1 className="text-2xl font-black text-slate-800 dark:text-white flex items-center justify-center gap-2 mr-2">
            <Camera className="text-blue-500" />
            التحضير السريع بالـ QR
          </h1>
        </div>
        <div className="w-10"></div> {/* Spacer to center title */}
      </header>
      
      <p className="text-slate-500 dark:text-slate-400 font-bold text-center mt-[-16px] mb-6 text-sm leading-relaxed">
        وجّه كاميرا الموبايل لكود الكارنيه لتسجيل الحضور واحتساب النقاط فوراً
      </p>

      {/* Network Status Badge */}
      <div className="flex justify-center mb-6">
        {isOnline ? (
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-black bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            متصل - يتم المزامنة سحابياً فوراً 🟢
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-black bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25 shadow-sm animate-pulse">
            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            أوفلاين - يتم الحفظ محلياً والمزامنة تلقائياً عند توفر شبكة 🟡
          </span>
        )}
      </div>

      {/* Main Scanner Container */}
      <div className="bg-white dark:bg-[#1e293b] p-6 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-xl relative">
        {/* Camera Preview Area */}
        <div 
          id="qr-reader" 
          className="w-full aspect-square bg-slate-900 dark:bg-slate-950 rounded-2xl border-2 border-slate-200 dark:border-slate-800 overflow-hidden shadow-inner relative"
        >
          {/* Custom Scanner Overlay overlay */}
          <div className="absolute inset-0 border-[24px] md:border-[32px] border-slate-900/60 pointer-events-none z-10 flex items-center justify-center">
            <div className="w-full h-full border border-dashed border-blue-400/80 rounded-lg relative">
              {/* Corner brackets */}
              <div className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-amber-500 rounded-tl-sm"></div>
              <div className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 border-amber-500 rounded-tr-sm"></div>
              <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 border-amber-500 rounded-bl-sm"></div>
              <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-amber-500 rounded-br-sm"></div>
            </div>
          </div>

          {/* Scanning Line Animation */}
          {scannerStarted && !isScanningPaused && (
            <div className="absolute left-[32px] right-[32px] h-0.5 bg-gradient-to-r from-blue-500 via-amber-400 to-blue-500 animate-scanner z-10 pointer-events-none"></div>
          )}

          {/* Loading Student Detail Overlay */}
          {loadingStudent && (
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center gap-3 text-white">
              <Loader2 className="animate-spin text-amber-500" size={40} />
              <span className="font-black text-sm">جاري جلب ملف الطالب...</span>
            </div>
          )}

          {/* Camera Error / Idle Message */}
          {cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 text-red-500 z-20 bg-slate-100 dark:bg-slate-900">
              <ShieldAlert size={48} className="mb-2" />
              <p className="font-bold text-sm leading-relaxed">{cameraError}</p>
            </div>
          )}
        </div>

        {/* Scanner Status */}
        <div className="mt-4 text-center">
          {isScanningPaused ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-500/10 text-amber-500 border border-amber-500/20">
              تم إيقاف المسح مؤقتاً
            </span>
          ) : scannerStarted ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 animate-pulse">
              جاري مسح الرموز بنشاط...
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-slate-500/10 text-slate-400 border border-slate-550/20">
              بانتظار تشغيل الكاميرا...
            </span>
          )}
        </div>
      </div>

      {/* Glassmorphism Popup Modal for Attendance Details */}
      {scannedStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-slate-950/60 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1e293b] w-full max-w-md rounded-3xl border border-slate-100 dark:border-slate-800 shadow-2xl p-6 relative overflow-hidden animate-in zoom-in duration-300">
            {/* Header info */}
            <div className="border-b border-slate-100 dark:border-slate-800 pb-4 mb-5 text-right">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-xl font-black text-slate-800 dark:text-white">{scannedStudent.name}</h3>
                  <p className="text-xs font-bold text-slate-450 dark:text-slate-400 mt-1">
                    فصل: <span className="text-blue-500">{scannedStudent.assignedClass || 'غير محدد'}</span> | مرحلة: <span className="text-teal-500">{scannedStudent.schoolGrade || 'غير محدد'}</span>
                  </p>
                </div>
                <div className="bg-slate-100 dark:bg-slate-800/80 px-2.5 py-1 rounded-xl font-mono text-xs font-black text-slate-600 dark:text-slate-300">
                  كود: {scannedStudent.code}
                </div>
              </div>
            </div>

            {/* Check-in warning for double scanning - Blocks checking in again */}
            {todayAttendanceData ? (
              <div className="space-y-6 text-center py-4">
                <div className="w-16 h-16 bg-rose-50 dark:bg-rose-955/20 border border-rose-100 dark:border-rose-800 text-rose-500 rounded-full flex items-center justify-center mx-auto animate-bounce">
                  <ShieldAlert size={32} />
                </div>
                
                <div className="space-y-2">
                  <h4 className="text-lg font-black text-rose-600 dark:text-rose-455">حضور مسجل بالفعل ⚠️</h4>
                  <p className="text-sm font-bold text-slate-600 dark:text-slate-350 leading-relaxed px-2">
                    تم تسجيل حضور هذا المخدوم اليوم بالفعل بنقاط <span className="font-black text-lg text-slate-800 dark:text-white px-1">({todayAttendanceData.dayPoints})</span>.
                    {todayAttendanceData.lastUpdatedBy && (
                      <>
                        <br />
                        بواسطة الخادم: <span className="font-black text-blue-600 dark:text-blue-400">{todayAttendanceData.lastUpdatedBy}</span>
                      </>
                    )}
                    {todayAttendanceData.timestamp && (
                      <>
                        <br />
                        في تمام الساعة: <span className="font-black font-mono text-blue-650 dark:text-blue-405">{formatTime(todayAttendanceData.timestamp)}</span>
                      </>
                    )}
                  </p>
                </div>

                <button
                  onClick={resumeScanning}
                  className="w-full bg-slate-900 text-white dark:bg-slate-850 dark:hover:bg-slate-800 py-3.5 rounded-2xl font-black text-sm transition-all hover:bg-black active:scale-95 cursor-pointer mt-4"
                >
                  إغلاق ومتابعة المسح 📸
                </button>
              </div>
            ) : (
              <>
                {/* Points Entry Area */}
                {storeVisible === false ? (
                  <div className="bg-amber-500/10 border border-amber-500/25 rounded-2xl p-4 text-center space-y-2 mb-6">
                    <div className="w-10 h-10 bg-amber-500/10 text-amber-500 rounded-full flex items-center justify-center mx-auto">
                      <Star size={20} className="fill-current" />
                    </div>
                    <div className="space-y-1">
                      <span className="text-amber-600 dark:text-amber-400 text-sm font-black block">⚠️ إضافة النقاط معطلة حالياً</span>
                      <p className="text-xs text-slate-550 dark:text-slate-400 font-bold leading-relaxed px-2">
                        تم تجميد تبويب معرض الصفات للمخدوم (تجميد البيانات مؤقتاً). سيتم تسجيل الحضور فقط بدون إضافة نقاط.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 mb-6">
                    <label className="block text-sm font-black text-slate-500 dark:text-slate-400 mr-1">
                      نقاط الحضور والصفات المكتسبة اليوم:
                    </label>
                    
                    {/* Custom Number Input */}
                    <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 border-2 border-slate-150 dark:border-slate-800 focus-within:border-blue-500 rounded-2xl shadow-inner transition-all">
                      <button 
                        type="button"
                        onClick={() => setPointsInput(String(Math.max(0, (Number(pointsInput) || 0) - 1)))}
                        className="w-10 h-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 rounded-xl font-black text-lg text-slate-750 dark:text-slate-300 flex items-center justify-center cursor-pointer select-none active:scale-90 transition-all shadow-sm"
                      >
                        -
                      </button>
                      <input 
                        type="text"
                        pattern="\d*"
                        value={pointsInput}
                        onChange={(e) => setPointsInput(e.target.value.replace(/\D/g, ''))}
                        placeholder="حدد النقاط..."
                        className="flex-1 text-center bg-transparent border-none outline-none font-black text-2xl text-slate-800 dark:text-slate-100 focus:ring-0 focus:outline-none"
                      />
                      <button 
                        type="button"
                        onClick={() => setPointsInput(String((Number(pointsInput) || 0) + 1))}
                        className="w-10 h-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 rounded-xl font-black text-lg text-slate-755 dark:text-slate-300 flex items-center justify-center cursor-pointer select-none active:scale-90 transition-all shadow-sm"
                      >
                        +
                      </button>
                    </div>

                    {/* Ready Shortcuts */}
                    <div className="flex flex-wrap gap-2 items-center justify-center pt-2">
                      {getShortcutsForClass(scannedStudent.assignedClass).map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setPointsInput(String(val))}
                          className="px-4 py-2 bg-purple-50 hover:bg-purple-100/50 dark:bg-purple-950/30 dark:hover:bg-purple-900/30 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800 rounded-lg text-xs font-black transition-all active:scale-95 cursor-pointer shadow-sm"
                        >
                          {val}+
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Liturgy attendance checkbox */}
                <div className="mt-4 mb-6">
                  <label className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl cursor-pointer select-none active:scale-[0.99] transition-all">
                    <div className="flex items-center gap-3">
                      <div className="bg-purple-100 dark:bg-purple-955/15 p-2.5 rounded-xl text-purple-600 dark:text-purple-400">
                        <Church size={20} />
                      </div>
                      <div className="text-right">
                        <span className="block text-sm font-black text-slate-850 dark:text-white">حضور القداس اليوم</span>
                        <span className="block text-xs text-slate-400 dark:text-slate-505 font-bold mt-0.5">تحديد حضور القداس للمخدوم اليوم</span>
                      </div>
                    </div>
                    <input 
                      type="checkbox"
                      checked={attendedLiturgy}
                      onChange={(e) => setAttendedLiturgy(e.target.checked)}
                      className="w-6 h-6 text-purple-600 border-slate-300 dark:border-slate-700 rounded-lg focus:ring-purple-500 cursor-pointer"
                    />
                  </label>
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                  <button
                    onClick={handleConfirmAttendance}
                    disabled={submitting || !isPointsValid}
                    className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-l from-blue-600 to-teal-500 hover:from-blue-700 hover:to-teal-600 disabled:from-slate-300 disabled:to-slate-400 dark:disabled:from-slate-800 dark:disabled:to-slate-900 text-white font-black py-3 px-4 rounded-xl transition-all shadow-md active:scale-95 disabled:scale-100 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="animate-spin" size={16} />
                        <span>جاري الحفظ...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} />
                        <span>{storeVisible === false ? "تسجيل الحضور فقط (بدون نقاط)" : "تأكيد وتسجيل الحضور"}</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={resumeScanning}
                    disabled={submitting}
                    className="px-4 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl transition-colors cursor-pointer"
                  >
                    إلغاء
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Floating Notifications */}
      {notification && (
        <div className={`fixed bottom-5 left-5 z-50 flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl border max-w-sm transition-all duration-300 animate-in fade-in slide-in-from-bottom-5 ${
          notification.type === 'error' 
          ? 'bg-rose-50 dark:bg-rose-955/90 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200' 
          : notification.type === 'warning'
          ? 'bg-amber-50 dark:bg-amber-955/90 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
          : 'bg-emerald-50 dark:bg-emerald-950/90 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
        }`}>
          {notification.type === 'error' ? (
            <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0" />
          ) : (
            <Check className="w-5 h-5 text-emerald-500 shrink-0 stroke-[3]" />
          )}
          <span className="font-bold text-sm leading-relaxed">{notification.message}</span>
        </div>
      )}

      {/* Scan animation styles */}
      <style>{`
        @keyframes scan {
          0% { top: 24px; }
          50% { top: calc(100% - 24px); }
          100% { top: 24px; }
        }
        @media (min-width: 768px) {
          @keyframes scan {
            0% { top: 32px; }
            50% { top: calc(100% - 32px); }
            100% { top: 32px; }
          }
        }
        .animate-scanner {
          position: absolute;
          animation: scan 2.5s linear infinite;
        }
      `}</style>
    </div>
  );
}
