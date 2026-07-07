import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { collection, query, where, getDocs, updateDoc, doc, getDoc, db } from '../firebase';
import { User, Lock, ArrowRight, Star, AlertCircle, Sun, Moon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function StudentLogin() {
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [rememberMe, setRememberMe] = useState(false);
    const navigate = useNavigate();
    const { logout, setStudentSession, setServantSession, isStudent, loading: authLoading } = useAuth();
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
        if (isRemembered && isStudent) {
            navigate('/student/dashboard', { replace: true });
        }
    }, [isStudent, authLoading, navigate]);

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            // First, sign out any existing Firebase session (Admin)
            await logout();

            const trimmedCode = code.trim();

            // Strictly query the 'students' collection
            const userRef = collection(db, 'students');
            const q = query(userRef, where('code', '==', trimmedCode));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                // If not found in students, check if this is a servant trying to log in
                // 1. Check if doc ID exists in servants
                let servantDoc = await getDoc(doc(db, 'servants', trimmedCode));
                let isServant = servantDoc.exists();

                // 2. Fallback: check by 'code' field in servants
                if (!isServant) {
                    const servantQ = query(
                        collection(db, 'servants'),
                        where('code', 'in', [trimmedCode, Number(trimmedCode)])
                    );
                    const servantSnapshot = await getDocs(servantQ);
                    isServant = !servantSnapshot.empty;
                }

                if (isServant) {
                    setError("عذراً، هذه الصفحة مخصصة للمخدومين فقط. يرجى تسجيل الدخول من بوابة المشرفين والخدام.");
                } else {
                    setError("الكود غير صحيح، تأكد من الكود المطبوع على الكارنيه 🔎");
                }
            } else {
                const userDoc = querySnapshot.docs[0];
                const data = userDoc.data();

                // Extra guard: if this document somehow has a servant/admin role field
                const role = data?.role;
                if (role === 'أمين فصل' || role === 'أمين مرحلة' || role === 'أمين عام' || role === 'امين فصل' || role === 'امين مرحله' || role === 'امين عام') {
                    setError("عذراً، هذه الصفحة مخصصة للمخدومين فقط. يرجى تسجيل الدخول من بوابة المشرفين والخدام.");
                    setLoading(false);
                    return;
                }

                let isValid = false;
                if (data.password !== undefined) {
                    isValid = data.password === password;
                } else {
                    isValid = trimmedCode === password;
                    if (isValid) {
                        try {
                            await updateDoc(doc(db, 'students', userDoc.id), {
                                password: trimmedCode,
                                isPasswordChanged: false
                            });
                        } catch (e) {
                            console.error("Failed to migrate password", e);
                        }
                    }
                }

                if (isValid) {
                    const lastUpdate = data.lastPasswordUpdate ? 
                        (data.lastPasswordUpdate.toMillis ? data.lastPasswordUpdate.toMillis() : data.lastPasswordUpdate) 
                        : 0;
                    await setStudentSession(userDoc.id, lastUpdate, rememberMe);
                    navigate('/student/dashboard');
                } else {
                    setError('كلمة المرور غير صحيحة، حاول مرة أخرى 🔒');
                }
            }
        } catch (err) {
            console.error("Login Error:", err);
            setError('حدث خطأ في الاتصال، تأكد من الإنترنت 🌐');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#0f172a] dark:text-slate-550 transition-colors duration-300 flex items-center justify-center p-4 relative" dir="rtl">
            
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

            <div className="w-full max-w-md bg-white dark:bg-[#1e293b] p-8 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                <div className="text-center mb-8">
                    <div className="bg-amber-100 dark:bg-amber-500/10 w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-sm">
                        <Star size={32} className="text-amber-500 fill-amber-500" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white">مدارس الأحد</h1>
                    <p className="text-slate-500 dark:text-slate-400 font-bold">تسجيل دخول المخدومين</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                        <label className="block text-base font-medium text-slate-500 dark:text-slate-350 mb-1 mr-1">كود المخدوم</label>
                        <input
                            type="text"
                            dir="ltr"
                            className="w-full p-3 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-base text-right"
                            placeholder="مثلاً: 100234"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-base font-medium text-slate-500 dark:text-slate-350 mb-1 mr-1">كلمة المرور</label>
                        <input
                            type="password"
                            className="w-full p-3 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-base"
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
                            className="w-4 h-4 text-blue-600 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded focus:ring-blue-500 dark:focus:ring-blue-650/20 focus:ring-2 accent-blue-600 dark:accent-blue-550 cursor-pointer"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                        />
                        <label htmlFor="rememberMe" className="text-sm font-medium text-slate-500 dark:text-slate-350 cursor-pointer select-none">
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
                        className="w-full bg-blue-600 hover:bg-blue-550 dark:bg-blue-500 dark:hover:bg-blue-400 text-white py-3 rounded-xl font-semibold text-lg shadow-md transition-colors disabled:opacity-50"
                    >
                        {loading ? 'جاري الدخول...' : 'دخول المخدوم'}
                    </button>
                </form>

                <div className="mt-8 pt-6 border-t border-slate-150 dark:border-slate-800 text-center">
                    <Link to="/admin/login" className="text-slate-400 dark:text-slate-500 font-bold underline hover:text-blue-500 dark:hover:text-blue-400">دخول المشرفين</Link>
                </div>
            </div>
        </div>
    );
}
