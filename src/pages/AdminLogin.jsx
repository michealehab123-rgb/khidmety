import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Lock, Mail, ArrowLeft, ShieldCheck, AlertCircle, Sun, Moon } from 'lucide-react';
import { doc, getDoc, db, collection, query, where, getDocs } from '../firebase';

const AdminLogin = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const { login, logout, loginServantByCode, isGeneralAdmin, isStageServant, isClassServant, isServant, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Smart Auto-Redirect: only auto-redirect if session is explicitly remembered
  useEffect(() => {
    if (authLoading) return;
    const isRemembered = localStorage.getItem('rememberMe') === 'true';
    if (isRemembered) {
      if (isGeneralAdmin) {
        navigate('/admin', { replace: true });
      } else if (isStageServant || isClassServant || isServant) {
        navigate('/servant', { replace: true });
      }
    }
  }, [isGeneralAdmin, isStageServant, isClassServant, isServant, authLoading, navigate]);

  const from = location.state?.from?.pathname || "/admin";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const trimmedInput = email.trim().toLowerCase();
    const isServantLogin = trimmedInput.endsWith('@church.com');

    try {
      // ── PATH A: @church.com email → Firestore-direct servant login (no Firebase Auth) ──
      if (isServantLogin) {
        // Clear any existing session without calling Firebase signOut
        await logout();

        // Extract code prefix (e.g. "4001@church.com" -> "4001")
        const servantCode = trimmedInput.split('@')[0];

        // 1. Try fetching by document ID first (fastest path)
        let servantSnap = await getDoc(doc(db, 'servants', servantCode));

        // 2. Fallback: query by a `code` field (could be stored as String or Number)
        if (!servantSnap.exists()) {
          const q = query(
            collection(db, 'servants'),
            where('code', 'in', [servantCode, Number(servantCode)])
          );
          const result = await getDocs(q);
          if (!result.empty) {
            servantSnap = result.docs[0];
          }
        }

        if (!servantSnap.exists()) {
          setError('كود الخادم غير مسجل. يرجى التواصل مع المسؤول.');
          return;
        }

        const servantData = { id: servantSnap.id, ...servantSnap.data() };

        if (servantData.status !== 'approved' || servantData.isActive === false) {
          if (servantData.status === 'pending') {
            setError('هذا الحساب قيد المراجعة والقبول. يرجى الانتظار لحين التفعيل من المسؤول.');
          } else {
            setError('هذا الحساب غير مفعل أو تم رفضه. يرجى التواصل مع المسؤول.');
          }
          return;
        }

        // 3. Password check (plaintext comparison against Firestore field)
        if (servantData.password !== password) {
          setError('كلمة المرور غير صحيحة.');
          return;
        }

        // 4. Inject session into AuthContext and navigate
        await loginServantByCode(servantData, rememberMe);
        navigate('/servant-dashboard', { replace: true });
        return;
      }

      // ── PATH B: Email address → standard Firebase Auth flow (General / Stage Admin) ──
      await logout();
      const userCredential = await login(trimmedInput, password, rememberMe);
      const uid = userCredential.user.uid;

      // Fetch the role document from servants or users collection
      let userDoc = await getDoc(doc(db, 'servants', uid));
      if (!userDoc.exists()) {
        userDoc = await getDoc(doc(db, 'users', uid));
      }

      if (userDoc.exists()) {
        const userData = userDoc.data();
        const role = userData?.role;

        // Block rejected/deleted/pending admins or stage admins
        const isGeneralAdminUser = userData?.isGeneralAdmin === true || 
                                   role === 'أمين عام' || 
                                   role === 'امين عام' || 
                                   trimmedInput === 'michealehab123@gmail.com';

        if (!isGeneralAdminUser && (userData.status !== 'approved' || userData.isActive === false)) {
          await logout();
          if (userData.status === 'pending') {
            setError('هذا الحساب قيد المراجعة. يرجى الانتظار لحين التفعيل من المسؤول.');
          } else {
            setError('هذا الحساب غير مفعل أو تم إيقافه. يرجى التواصل مع المسؤول.');
          }
          return;
        }

        if (isGeneralAdminUser) {
          navigate('/admin', { replace: true });
        } else if (role === 'أمين مرحلة' || role === 'امين مرحله' || role === 'أمين فصل' || role === 'امين فصل') {
          navigate('/servant', { replace: true });
        } else {
          setError('عذراً، لم يتم تحديد صلاحيات لهذا الحساب.');
        }
      } else {
        // Fallback for accounts with no profile document (pure admin)
        navigate('/admin', { replace: true });
      }
    } catch (err) {
      console.error('Login Error:', err);
      setError(`حدث خطأ: ${err.code || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#0f172a] dark:text-slate-50 transition-colors duration-300 flex items-center justify-center p-4 relative" dir="rtl">
      
      {/* Theme Toggle Button */}
      <button
        type="button"
        onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        className="absolute top-4 right-4 p-2.5 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all duration-300 flex items-center justify-center border border-slate-200 dark:border-slate-800"
        aria-label="Toggle Theme"
      >
        {theme === 'light' ? (
          <Moon size={20} className="transition-transform duration-500 rotate-0" />
        ) : (
          <Sun size={20} className="transition-transform duration-500 rotate-180 text-amber-500" />
        )}
      </button>

      <div className="w-full max-w-md bg-white dark:bg-[#1e293b] p-8 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200">
        <div className="text-center mb-8">
          <div className="bg-blue-650 dark:bg-blue-500/10 w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-md">
            <ShieldCheck size={32} className="text-blue-600 dark:text-blue-400" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">لوحة التحكم</h1>
          <p className="text-slate-550 dark:text-slate-400 font-bold">تسجيل دخول المشرفين</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="dark:text-slate-300 text-base font-medium mb-1.5 block mr-1">البريد الإلكتروني</label>
            <input
              type="text"
              inputMode="email"
              dir="ltr"
              className="bg-slate-50 dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-blue-500 rounded-xl py-3 px-4 text-base w-full outline-none focus:border-blue-500 transition-all font-bold text-right"
              placeholder="admin@church.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="dark:text-slate-300 text-base font-medium mb-1.5 block mr-1">كلمة المرور</label>
            <input
              type="password"
              className="bg-slate-50 dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-blue-500 rounded-xl py-3 px-4 text-base w-full outline-none focus:border-blue-500 transition-all font-bold"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {/* Remember Me Checkbox */}
          <div className="flex items-center gap-2 mr-1">
            <input
              type="checkbox"
              id="rememberMe"
              className="w-4 h-4 text-blue-600 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded focus:ring-blue-500 dark:focus:ring-blue-600 focus:ring-2 accent-blue-600 dark:accent-blue-500 cursor-pointer"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            <label htmlFor="rememberMe" className="text-sm font-medium text-slate-600 dark:text-slate-300 cursor-pointer select-none">
              تذكرني
            </label>
          </div>

          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-955/25 text-rose-600 dark:text-rose-450 rounded-lg text-sm font-bold border border-rose-100 dark:border-rose-900/30">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 dark:bg-blue-500 dark:hover:bg-blue-400 text-white font-bold rounded-xl py-3 text-lg transition-all shadow-md w-full disabled:opacity-50"
          >
            {loading ? 'جاري الدخول...' : 'دخول المشرفين'}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-150 dark:border-slate-800 text-center flex flex-col gap-3">
            <Link to="/servant/register" className="text-blue-600 dark:text-blue-450 font-black hover:underline text-base">خادم جديد؟ سجل هنا</Link>
            <Link to="/login" className="text-slate-500 dark:text-slate-400 font-bold underline hover:text-blue-500 dark:hover:text-blue-300">دخول المخدومين</Link>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
