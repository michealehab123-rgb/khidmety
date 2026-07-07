import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { CartProvider } from './context/CartContext';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Navbar from './components/Navbar';

// Auth Pages
import StudentLogin from './pages/StudentLogin';
import AdminLogin from './pages/AdminLogin';
import ServantRegister from './pages/ServantRegister';

// ── Student Portal (completely independent) ──────────────────────────────────
import StudentDashboard from './pages/StudentDashboard';
import StudentVirtues from './pages/StudentVirtues';
import StudentStore from './pages/StudentStore';
import StudentProduct from './pages/StudentProduct';
import Cart from './pages/Cart';

// ── Servant Portal ───────────────────────────────────────────────────────────
import ServantDashboard from './pages/ServantDashboard';
import ServantProfile from './pages/ServantProfile';
import AdminAttendance from './pages/AdminAttendance';
import Visitation from './pages/Visitation';
import AdminOrders from './pages/AdminOrders';
import AdminStudentProfile from './pages/AdminStudentProfile';
import QrScannerPage from './pages/QrScannerPage';
import SendReports from './pages/SendReports';

// ── General Admin Portal ─────────────────────────────────────────────────────
import AdminDashboard from './pages/AdminDashboard';
import AdminStore from './pages/AdminStore';
import AdminServants from './pages/AdminServants';
import AdminServantProfile from './pages/AdminServantProfile';
import AdminGifts from './pages/AdminGifts';
import AdminSettings from './pages/AdminSettings';

// ── Shared / Legacy Tool Pages ────────────────────────────────────────────────
import MyClass from './pages/MyClass';
import ClassServants from './pages/ClassServants';

import { useEffect, useRef } from 'react';
import { useAuth } from './context/AuthContext';
import { useNavigate } from 'react-router-dom';

// ── استيرادات الفايربيز الخاصة بالإشعارات ────────────────────────────────────────
import { getMessaging, getToken } from 'firebase/messaging';
import { db, doc, updateDoc, arrayUnion, arrayRemove, deleteField, setDoc, getDoc } from './firebase'; 

function RootRedirect() {
  const { isGeneralAdmin, isStageServant, isClassServant, isServant, isStudent, loading, servant } = useAuth();
  const navigate = useNavigate();

  // الـ Logic بتاع التوجيه للوحات التحكم
  useEffect(() => {
    if (loading || servant === undefined) return;

    const isRemembered = localStorage.getItem('rememberMe') === 'true' || localStorage.getItem('remember_me') === 'true';
    if (isRemembered) {
      if (isGeneralAdmin) {
        navigate('/admin', { replace: true });
        return;
      } else if (isStageServant || isClassServant || isServant) {
        navigate('/servant', { replace: true });
        return;
      } else if (isStudent) {
        navigate('/student/dashboard', { replace: true });
        return;
      }
    }
    
    navigate('/login', { replace: true });
  }, [isGeneralAdmin, isStageServant, isClassServant, isServant, isStudent, loading, servant, navigate]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600 dark:border-blue-400"></div>
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400 font-bold">جاري تحميل الجلسة...</p>
    </div>
  );
}

// ── كود تفعيل الإشعارات بداخل الـ Main Layout ليبقى نشطاً ──
function NotificationTracker() {
  const { 
    loading, 
    user, 
    servant, 
    student, 
    isGeneralAdmin, 
    isStageServant, 
    isClassServant, 
    isServant, 
    isStudent 
  } = useAuth();

  const hasRegisteredToken = useRef(false);

  useEffect(() => {
    const pending = localStorage.getItem('pendingTokenRemoval');
    if (pending) {
      try {
        const { collectionName, currentUserId, token } = JSON.parse(pending);
        if (collectionName && currentUserId && token) {
          console.log('[FCM Cleanup] Processing pending token removal from previous session...');
          const userRef = doc(db, collectionName, currentUserId);
          getDoc(userRef)
            .then((snap) => {
              if (snap.exists() && snap.data().fcmToken === token) {
                updateDoc(userRef, { 
                  fcmToken: deleteField(),
                  fcmTokens: deleteField() // تنظيف الحقل القديم أيضاً بالمرة
                })
                .then(() => console.log('[FCM Cleanup ✅] Pending token removed successfully.'))
                .catch((e) => console.warn('[FCM Cleanup ❌] Failed to remove pending token:', e));
              } else {
                console.log('[FCM Cleanup] Token in database does not match pending token, skipping removal.');
              }
            })
            .catch((e) => console.warn('[FCM Cleanup ❌] Failed to fetch user doc for cleanup:', e));
        }
      } catch (e) {
        console.warn('[FCM Cleanup] Failed to parse pending removal data:', e);
      }
      localStorage.removeItem('pendingTokenRemoval');
    }
  }, []); // runs once on mount

  useEffect(() => {
    console.log('[FCM Tracker] Triggered. Loading:', loading, 'User:', user?.uid, 'Servant:', servant?.id, 'Student:', student?.id);
    
    if (loading || servant === undefined) {
      console.log('[FCM Tracker] Auth state is loading or servant is undefined, skipping...');
      return;
    }

    // فحص شامل وذكي جداً للامساك بالـ ID تحت أي مسمى جوة الـ Context
    const currentUserId = 
      user?.uid || 
      user?.id || 
      servant?.id || 
      servant?.uid || 
      student?.id ||
      student?.uid;

    console.log('[FCM Tracker] Resolved currentUserId:', currentUserId);

    if (!currentUserId) {
      console.log('[FCM Tracker] No active user ID found, resetting flag and skipping...');
      hasRegisteredToken.current = false;
      return;
    }

    // تحقق من خيار "تذكرني" - لا نسجل توكن الإشعارات إلا إذا تم تفعيل تذكرني
    const isRemembered = localStorage.getItem('rememberMe') === 'true';
    if (!isRemembered) {
      console.log('[FCM Tracker] rememberMe is false/null. Skipping token registration.');
      return;
    }

    if (hasRegisteredToken.current) {
      console.log('[FCM Tracker] Token already registered in this session, skipping...');
      return;
    }

    // تحديد الجدول بناءً على الصلاحيات أو الإيميل/الكود المتاح
    let collectionName = '';
    if (isGeneralAdmin || isStageServant || isClassServant || isServant) {
      collectionName = 'servants';
    } else if (isStudent) {
      collectionName = 'students';
    } else {
      // Fallback هندسي ذكي جداً: لو المتغيرات مجتش، نفتش في بيانات الحساب نفسه
      const targetUser = user || servant || student;
      if (targetUser?.email && targetUser.email.includes('church.com')) {
        collectionName = 'servants';
      } else if (targetUser?.code) {
        collectionName = 'students';
      }
    }

    console.log('[FCM Tracker] Resolved collectionName:', collectionName);

    if (collectionName && currentUserId) {
      try {
        const messaging = getMessaging();
        console.log('[FCM Tracker] Requesting notification permission...');
        
        Notification.requestPermission().then((permission) => {
          console.log('[FCM Tracker] Notification permission result:', permission);
          if (permission === 'granted') {
            // ✅ نستخدم الـ SW اللي اتسجل بالفعل في main.jsx (firebase-messaging-sw.js)
            // مش بنسجله تاني عشان منسببش تعارض
            if ('serviceWorker' in navigator) {
              console.log('[FCM Tracker] Waiting for existing firebase SW to be ready...');
              
              // نستنى الـ SW اللي اتسجل مسبقاً في main.jsx
              navigator.serviceWorker.ready
                .then((registration) => {
                  console.log('[FCM Tracker] SW ready. Controller:', registration.active?.scriptURL);
                  
                  const activeWorker = registration.active || registration.waiting || registration.installing;
                  const swUrl = activeWorker?.scriptURL || '';
                  if (!swUrl.includes('sw.js') && !swUrl.includes('firebase-messaging-sw')) {
                    console.warn('[FCM Tracker] Active SW is not sw.js, trying to register it...');
                    return navigator.serviceWorker.register('/sw.js', { scope: '/' })
                      .then(() => navigator.serviceWorker.ready);
                  }
                  return registration;
                })
                .then((registration) => {
                  console.log('[FCM Tracker] Requesting FCM Token with VAPID key...');
                  return getToken(messaging, { 
                    vapidKey: 'BDnkjGySbQVnoSQXpcJB5YafONwklqK5edNUoEuyTJqOdYz2PvQby40zDrT5303ukwxwa_sIBDUqLZ43LUE6L-g',
                    serviceWorkerRegistration: registration
                  });
                })
                .then((currentToken) => {
                  if (currentToken) {
                    console.log('[FCM Tracker] Token retrieved successfully:', currentToken.substring(0, 20) + '...');
                    fetch('https://server-ochre-one-17.vercel.app/api/register-token', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        userId: currentUserId,
                        collectionName,
                        token: currentToken
                      })
                    })
                    .then(res => res.json())
                    .then((data) => {
                      if (data.success) {
                        console.log(`[FCM ✅] Token registered and cleaned up via Vercel server for: ${collectionName}/${currentUserId}`);
                        hasRegisteredToken.current = true;
                      } else {
                        console.error(`[FCM ❌] Token registration error:`, data.error);
                      }

                      // ── حذف التوكن تلقائياً عند إغلاق التاب لو لم يكن rememberMe مفعلاً ──
                      const isRemembered = localStorage.getItem('rememberMe') === 'true';
                      if (!isRemembered) {
                        const cleanupOnClose = () => {
                          // Beacon API للإرسال بعد إغلاق الصفحة
                          // بستخدم منطق اللوجاوت بدلاًمن هنا لأن beforeunload لا يقدر يكمل async operations
                          console.log('[FCM Cleanup] Tab closing, non-persistent session — removing token...');
                          // نستخدم localStorage كإشارة للـ NotificationTracker بعد الفتح التالي
                          localStorage.setItem('pendingTokenRemoval', JSON.stringify({ collectionName, currentUserId, token: currentToken }));
                        };
                        window.addEventListener('beforeunload', cleanupOnClose);
                        // تنظيف الـ listener لو تغير الـ Effect
                        return () => window.removeEventListener('beforeunload', cleanupOnClose);
                      }
                    })
                    .catch((err) => console.error('[FCM ❌] Firestore write failed:', err));
                  } else {
                    console.warn('[FCM Tracker] getToken() returned null - check VAPID key and SW registration.');
                  }
                })
                .catch((err) => {
                  console.error('[FCM ❌] Token retrieval failed:', err.code, err.message);
                });
            } else {
              console.warn('[FCM Tracker] Service Worker not supported in this browser.');
            }
          }
        });
      } catch (error) {
        console.error('[FCM Error] Initialization failed:', error);
      }
    }
  }, [loading, user, servant, student, isGeneralAdmin, isStageServant, isClassServant, isServant, isStudent]);

  return null;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NotificationTracker />
        <CartProvider>
          <div className="min-h-screen bg-slate-50 dark:bg-[#0f172a] text-slate-900 dark:text-slate-50 font-sans transition-colors duration-300">
            <Navbar />
            <main className="container mx-auto pb-10">
              <Routes>

                {/* ── Splash ─────────────────────────────────────────────── */}
                <Route path="/" element={<RootRedirect />} />

                {/* ── Auth Pages ─────────────────────────────────────────── */}
                <Route path="/login"       element={<StudentLogin />} />
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/servant/register" element={<ServantRegister />} />
                <Route path="/admin-dashboard" element={<Navigate to="/admin" replace />} />
                <Route path="/servant-dashboard" element={<Navigate to="/servant" replace />} />

                {/* STUDENT PORTAL */}
                <Route path="/student/dashboard"   element={<ProtectedRoute><StudentDashboard /></ProtectedRoute>} />
                <Route path="/student/store"       element={<ProtectedRoute><StudentStore /></ProtectedRoute>} />
                <Route path="/student/product/:id" element={<ProtectedRoute><StudentProduct /></ProtectedRoute>} />
                <Route path="/student/cart"        element={<ProtectedRoute><Cart /></ProtectedRoute>} />
                <Route path="/student"             element={<Navigate to="/student/dashboard" replace />} />

                {/* SERVANT PORTAL */}
                <Route path="/servant/dashboard"  element={<ProtectedRoute><ServantDashboard /></ProtectedRoute>} />
                <Route path="/servant/profile"    element={<ProtectedRoute><ServantProfile /></ProtectedRoute>} />
                <Route path="/servant/attendance" element={<ProtectedRoute><AdminAttendance /></ProtectedRoute>} />
                <Route path="/servant/visitation" element={<ProtectedRoute><Visitation /></ProtectedRoute>} />
                <Route path="/servant/orders"     element={<ProtectedRoute><AdminOrders /></ProtectedRoute>} />
                <Route path="/servant/student/:id" element={<ProtectedRoute><AdminStudentProfile /></ProtectedRoute>} />
                <Route path="/servant/scanner"     element={<ProtectedRoute><QrScannerPage /></ProtectedRoute>} />
                <Route path="/servant/send-reports" element={<ProtectedRoute><SendReports /></ProtectedRoute>} />
                <Route path="/servant"             element={<Navigate to="/servant/profile" replace />} />

                {/* Shared routes */}
                <Route path="/admin/store"  element={<ProtectedRoute><AdminStore /></ProtectedRoute>} />
                <Route path="/admin/orders" element={<ProtectedRoute><AdminOrders /></ProtectedRoute>} />
                <Route path="/admin/gifts"  element={<ProtectedRoute><AdminGifts /></ProtectedRoute>} />
                <Route path="/servant/gifts" element={<ProtectedRoute><AdminGifts /></ProtectedRoute>} />

                {/* GENERAL ADMIN PORTAL */}
                <Route path="/admin"                element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
                <Route path="/admin/settings"       element={<ProtectedRoute><AdminSettings /></ProtectedRoute>} />
                <Route path="/admin/servants"       element={<ProtectedRoute><AdminServants /></ProtectedRoute>} />
                <Route path="/admin/servant/:id"    element={<ProtectedRoute><AdminServantProfile /></ProtectedRoute>} />
                <Route path="/admin/attendance"     element={<ProtectedRoute><AdminAttendance /></ProtectedRoute>} />
                <Route path="/admin/visitation"     element={<ProtectedRoute><Visitation /></ProtectedRoute>} />
                <Route path="/admin/student/:id"    element={<ProtectedRoute><AdminStudentProfile /></ProtectedRoute>} />
                <Route path="/admin/scanner"        element={<ProtectedRoute><QrScannerPage /></ProtectedRoute>} />

                {/* Shared Tool Routes */}
                <Route path="/my-class"       element={<ProtectedRoute><MyClass /></ProtectedRoute>} />
                <Route path="/class-servants" element={<ProtectedRoute><ClassServants /></ProtectedRoute>} />

                {/* Catch-all */}
                <Route path="/server/*" element={<Navigate to="/admin" replace />} />

              </Routes>
            </main>
          </div>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;