import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { db, doc, onSnapshot, getDocs, collection, setDoc } from '../firebase';
import { User, Lock, Phone, MapPin, Shield, ArrowLeft, Sun, Moon, AlertCircle, CheckCircle, ShieldAlert, Calendar } from 'lucide-react';

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

const normalizeArabic = (str) => {
    if (!str) return '';
    return str
        .replace(/[أإآا]/g, 'ا')
        .replace(/[ىي]/g, 'ي')
        .replace(/[ةه]/g, 'ه')
        .trim();
};

const calculateFirstAvailableCode = (servantsList) => {
    let newCode = 4001;
    const existingCodes = servantsList
        .filter(s => s.status !== 'rejected' && s.status !== 'deleted')
        .map(s => Number(s.code || s.servantCode))
        .filter(Boolean);
    while (existingCodes.includes(newCode)) {
        newCode++;
    }
    return String(newCode);
};

export default function ServantRegister() {
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [address, setAddress] = useState('');
    const [birthDate, setBirthDate] = useState('');
    const [stage, setStage] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('امين فصل'); // 'امين فصل' or 'امين مرحله'
    const [selectedClasses, setSelectedClasses] = useState([]);
    
    const [isRegOpen, setIsRegOpen] = useState(null); // loading state initially
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [registeredCode, setRegisteredCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');

    const navigate = useNavigate();

    // Theme monitor
    useEffect(() => {
        const root = window.document.documentElement;
        if (theme === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
        localStorage.setItem('theme', theme);
    }, [theme]);

    // Check if registration is open
    useEffect(() => {
        const docRef = doc(db, 'settings', 'registration');
        const unsub = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setIsRegOpen(data.isRegistrationOpen !== false); // default to true if undefined
            } else {
                setIsRegOpen(true); // default to true if document doesn't exist
            }
        }, (err) => {
            console.error("Error fetching settings:", err);
            setIsRegOpen(true); // fallback to open if error
        });

        return () => unsub();
    }, []);

    const handleRegister = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setLoading(true);

        if (!name.trim()) {
            setError('برجاء كتابة الاسم الثلاثي');
            setLoading(false);
            return;
        }

        if (!phone.trim() || phone.trim().length < 11) {
            setError('برجاء كتابة رقم تليفون صحيح (11 رقم على الأقل) 📱');
            setLoading(false);
            return;
        }

        if (!stage) {
            setError('برجاء اختيار المرحلة الدراسية 🎓');
            setLoading(false);
            return;
        }

        if (!selectedClasses || selectedClasses.length === 0) {
            setError('برجاء اختيار فصل واحد على الأقل 🏫');
            setLoading(false);
            return;
        }

        if (!password || password.length < 4) {
            setError('كلمة المرور يجب أن تكون 4 أحرف أو أرقام على الأقل 🔒');
            setLoading(false);
            return;
        }

        try {
            // 1. Fetch current servants to calculate code
            const querySnapshot = await getDocs(collection(db, 'servants'));
            const servantsList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const nextCode = calculateFirstAvailableCode(servantsList, stage);

            let nextCodeNum = Number(nextCode);
            let successState = false;
            let currentTryCode = nextCode;
            let currentTryEmail = `${nextCode}@church.com`;
            let attempts = 0;

            while (!successState && attempts < 100) {
                // Check if currentTryCode is already in use in Firestore by an active servant
                const codeInUseInFirestore = servantsList.some(s => 
                    String(s.code || s.servantCode) === String(currentTryCode) && 
                    s.status !== 'rejected' && s.status !== 'deleted'
                );

                if (codeInUseInFirestore) {
                    console.log(`Code ${currentTryCode} is already in use in Firestore. Skipping...`);
                    nextCodeNum++;
                    currentTryCode = String(nextCodeNum);
                    currentTryEmail = `${currentTryCode}@church.com`;
                    attempts++;
                    continue;
                }

                successState = true;
            }

            if (!successState) {
                throw new Error("عذراً، تعذر العثور على كود متاح في النظام. يرجى المحاولة مرة أخرى.");
            }

            // 2. Add to Firestore collection 'servants' using code as document ID
            const payload = {
                name: name.trim(),
                phone: phone.trim(),
                address: address.trim(),
                birthDate: birthDate,
                code: currentTryCode,
                email: currentTryEmail,
                password: password, // plain text for PATH A login compatibility
                status: 'pending',
                role: role,
                assignedStage: stage,
                grade: stage, // backward compatibility
                createdAt: new Date().toISOString()
            };

            if (role === 'امين مرحله') {
                payload.managedClasses = selectedClasses;
                payload.assignedClass = '';
                payload.assignment = '';
                payload.myClasses = [];
            } else {
                payload.myClasses = selectedClasses;
                payload.assignedClass = selectedClasses[0] || '';
                payload.assignment = selectedClasses[0] || '';
                payload.managedClasses = [];
            }

            await setDoc(doc(db, 'servants', currentTryCode), payload);

            // 3. Success states
            setRegisteredCode(currentTryCode);
            setSuccess('تم إرسال طلبك بنجاح، في انتظار موافقة أمين الخدمة.');
            
            // 4. Reset form
            setName('');
            setPhone('');
            setAddress('');
            setBirthDate('');
            setStage('');
            setRole('امين فصل');
            setSelectedClasses([]);
            setPassword('');

        } catch (err) {
            console.error("Registration error:", err);
            setError(`حدث خطأ أثناء التسجيل: ${err.message || 'برجاء التحقق من الإنترنت'}`);
        } finally {
            setLoading(false);
        }
    };

    if (isRegOpen === null) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-[#0f172a] gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600 dark:border-blue-400"></div>
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">جاري التحقق من إعدادات التسجيل...</p>
            </div>
        );
    }

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

            <div className="w-full max-w-lg bg-white dark:bg-[#1e293b] p-8 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 transition-all duration-300">
                
                {!isRegOpen ? (
                    // Registration Closed View
                    <div className="text-center py-6 space-y-6">
                        <div className="bg-rose-50 dark:bg-rose-955/20 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto shadow-inner text-rose-500 dark:text-rose-400">
                            <ShieldAlert size={48} />
                        </div>
                        <div className="space-y-2">
                            <h1 className="text-2xl font-black text-slate-900 dark:text-white">التسجيل مغلق حالياً</h1>
                            <p className="text-slate-550 dark:text-slate-400 font-bold text-lg leading-relaxed">
                                عذراً، التسجيل مغلق حالياً، راجع أمين الخدمة.
                            </p>
                        </div>
                        <div className="pt-4">
                            <Link
                                to="/admin/login"
                                className="inline-flex items-center justify-center gap-2 w-full px-6 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg transition-all active:scale-[0.98]"
                            >
                                <ArrowLeft size={18} />
                                العودة لصفحة الدخول
                            </Link>
                        </div>
                    </div>
                ) : success ? (
                    // Success View
                    <div className="text-center py-8 space-y-6">
                        <div className="bg-emerald-55/10 dark:bg-emerald-500/10 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto shadow-inner text-emerald-500 dark:text-emerald-400 animate-bounce">
                            <CheckCircle size={48} />
                        </div>
                        <div className="space-y-3">
                            <h1 className="text-2xl font-black text-slate-900 dark:text-white">تم إرسال الطلب!</h1>
                            <p className="text-slate-600 dark:text-slate-350 font-bold text-lg px-2">
                                {success}
                            </p>
                            <div className="bg-slate-50 dark:bg-[#0f172a] p-4 rounded-2xl border border-slate-200 dark:border-slate-800 inline-block">
                                <p className="text-sm font-semibold text-slate-400 dark:text-slate-500 mb-1">كود الدخول الخاص بك (احفظه جيداً):</p>
                                <p className="text-3xl font-black text-blue-600 dark:text-blue-400 tracking-wider">{registeredCode}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-bold">البريد الإلكتروني لتسجيل الدخول: <span dir="ltr">{registeredCode}@church.com</span></p>
                            </div>
                        </div>
                        <div className="pt-2">
                            <Link
                                to="/admin/login"
                                className="inline-flex items-center justify-center gap-2 w-full px-6 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg transition-all active:scale-[0.98]"
                            >
                                العودة للدخول فوراً
                            </Link>
                        </div>
                    </div>
                ) : (
                    // Registration Form View
                    <>
                        <div className="text-center mb-8">
                            <div className="bg-blue-600/10 dark:bg-blue-500/10 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm text-blue-600 dark:text-blue-400">
                                <Shield size={32} />
                            </div>
                            <h1 className="text-2xl font-black text-slate-900 dark:text-white">تسجيل خادم جديد</h1>
                            <p className="text-slate-550 dark:text-slate-400 font-bold">انضم لخدمة مدارس الأحد</p>
                        </div>

                        <form onSubmit={handleRegister} className="space-y-5">
                            <div>
                                <label className="block text-sm font-bold text-slate-655 dark:text-slate-400 mb-1.5 mr-1">الاسم الثلاثي</label>
                                <div className="relative">
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                                        <User size={18} />
                                    </div>
                                    <input
                                        type="text"
                                        className="w-full pr-10 pl-4 py-3 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-base"
                                        placeholder="الاسم بالكامل كما في الكارنيه"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        required
                                        disabled={loading}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-655 dark:text-slate-400 mb-1.5 mr-1">رقم التليفون (واتساب)</label>
                                <div className="relative">
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                                        <Phone size={18} />
                                    </div>
                                    <input
                                        type="tel"
                                        className="w-full pr-10 pl-4 py-3 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-base text-right"
                                        placeholder="01xxxxxxxxx"
                                        value={phone}
                                        onChange={(e) => setPhone(e.target.value)}
                                        required
                                        disabled={loading}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-655 dark:text-slate-400 mb-1.5 mr-1">العنوان (اختياري)</label>
                                <div className="relative">
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                                        <MapPin size={18} />
                                    </div>
                                    <input
                                        type="text"
                                        className="w-full pr-10 pl-4 py-3 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-base"
                                        placeholder="عنوان السكن الحالي"
                                        value={address}
                                        onChange={(e) => setAddress(e.target.value)}
                                        disabled={loading}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-655 dark:text-slate-400 mb-1.5 mr-1">تاريخ الميلاد</label>
                                <div className="relative">
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                                        <Calendar size={18} />
                                    </div>
                                    <input
                                        type="date"
                                        className="w-full pr-10 pl-4 py-3 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-base text-right"
                                        value={birthDate}
                                        onChange={(e) => setBirthDate(e.target.value)}
                                        required
                                        disabled={loading}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-655 dark:text-slate-400 mb-1.5 mr-1">المسؤولية</label>
                                <div className="relative">
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none">
                                        <Shield size={18} />
                                    </div>
                                    <select
                                        className="w-full pr-10 pl-4 py-3 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-base cursor-pointer appearance-none"
                                        value={role}
                                        onChange={(e) => { setRole(e.target.value); setSelectedClasses([]); }}
                                        required
                                        disabled={loading}
                                    >
                                        <option value="امين فصل">امين فصل</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-655 dark:text-slate-400 mb-1.5 mr-1">المرحلة الدراسية المراد الخدمة بها</label>
                                <div className="relative">
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none">
                                        <Shield size={18} />
                                    </div>
                                    <select
                                        className="w-full pr-10 pl-4 py-3 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-base cursor-pointer appearance-none"
                                        value={stage}
                                        onChange={(e) => { setStage(e.target.value); setSelectedClasses([]); }}
                                        required
                                        disabled={loading}
                                    >
                                        <option value="">اختر المرحلة</option>
                                        {Object.keys(STAGE_CLASS_MAP).map(stg => (
                                            <option key={stg} value={stg}>{stg}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {stage && (
                                <div className="space-y-3">
                                    <label className="block text-sm font-bold text-slate-655 dark:text-slate-400 mb-1 mr-1">الفصول المسؤول عنها في مرحلة ({stage})</label>
                                    <div className="grid grid-cols-2 gap-3 max-h-48 overflow-y-auto p-3 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded-xl">
                                        {(STAGE_CLASS_MAP[stage] || []).map(cls => {
                                            const isChecked = selectedClasses.includes(cls);
                                            return (
                                                <label
                                                    key={cls}
                                                    className="flex items-center gap-3 p-2.5 bg-white dark:bg-[#1e293b] border border-slate-150 dark:border-slate-800 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-850 transition-colors font-bold text-slate-700 dark:text-slate-250 text-sm"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className="accent-blue-600 rounded w-4.5 h-4.5 cursor-pointer"
                                                        checked={isChecked}
                                                        onChange={() => {
                                                            setSelectedClasses(prev =>
                                                                isChecked ? prev.filter(c => c !== cls) : [...prev, cls]
                                                            );
                                                        }}
                                                    />
                                                    <span>{cls}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-bold text-slate-655 dark:text-slate-400 mb-1.5 mr-1">كلمة المرور</label>
                                <div className="relative">
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                                        <Lock size={18} />
                                    </div>
                                    <input
                                        type="password"
                                        className="w-full pr-10 pl-4 py-3 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-base"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        disabled={loading}
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="p-4 bg-rose-50 dark:bg-rose-955/20 text-rose-600 dark:text-rose-400 rounded-xl text-sm font-bold border border-rose-100 dark:border-rose-900/30 flex items-center gap-2">
                                    <AlertCircle size={18} className="shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full bg-blue-600 hover:bg-blue-500 dark:bg-blue-500 dark:hover:bg-blue-400 text-white py-3.5 rounded-xl font-bold text-lg shadow-md transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                            >
                                {loading ? 'جاري إرسال طلب التسجيل...' : 'تسجيل وإرسال الطلب'}
                            </button>
                        </form>

                        <div className="mt-6 pt-5 border-t border-slate-150 dark:border-slate-800 text-center flex flex-col gap-2">
                            <span className="text-sm text-slate-400 dark:text-slate-500 font-bold">
                                لديك حساب بالفعل؟{' '}
                                <Link to="/admin/login" className="text-blue-600 dark:text-blue-400 font-bold underline hover:text-blue-550 dark:hover:text-blue-300">
                                    تسجيل الدخول هنا
                                </Link>
                            </span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
