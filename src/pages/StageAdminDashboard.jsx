import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, updateDoc, setDoc, db, query, where, getDocs } from '../firebase';
import { useNavigate } from 'react-router-dom';
import { 
    Users, LayoutDashboard, UserPlus, Shield, CalendarDays, 
    Home, ArrowRight, UserCog, Edit, Ban, CheckCircle, ShoppingCart,
    ShoppingBag, ClipboardList
} from 'lucide-react';

const STAGE_CLASS_MAP = {
    'ابتدائي': ['حضانة/ملائكة', 'أولى ابتدائى', 'ثانية ابتدائى', 'ثالثة ابتدائى', 'رابعة ابتدائى', 'خامسة ابتدائى', 'سادسة ابتدائي'],
    'اعدادي': ['اولي اعدادي', 'تانيه اعدادي', 'تالته اعدادي'],
    'ثانوي': ['اولي ثانوي', 'تانيه ثانوي', 'تالته ثانوي'],
};

export default function StageAdminDashboard({ servant, formData }) {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('overview');
    
    // Data States
    const [allStudents, setAllStudents] = useState([]);
    const [allServants, setAllServants] = useState([]);
    
    const [selectedStage, setSelectedStage] = useState(() => localStorage.getItem('selectedStageFilter') || servant.assignedStage || '');
    // Classes Tab State
    const [selectedClass, setSelectedClass] = useState(() => localStorage.getItem('selectedClassFilter') || '');
    const [attendanceConfigs, setAttendanceConfigs] = useState({});
    
    // Servant Management States
    const [showServantModal, setShowServantModal] = useState(false);
    const [editingServant, setEditingServant] = useState(null);
    const [servantForm, setServantForm] = useState({
        name: '', code: '', phone: '', address: '', role: 'خادم فصل', assignedClass: ''
    });

    const stageClasses = STAGE_CLASS_MAP[servant.assignedStage] || [];

    // 🛠️ الخطوة الثانية: جلب الخدام مرة واحدة فقط وتحديثهم عند الأكشنز المحلية
    const fetchServants = async () => {
        if (!servant.assignedStage) return;
        try {
            const snap = await getDocs(collection(db, 'servants'));
            const list = snap.docs.map(d => ({id: d.id, ...d.data()}));
            const stageServs = list.filter(s => {
                if (s.id === servant.id) return false;
                if (s.status !== 'approved' || s.isActive === false) return false;
                return stageClasses.includes(s.assignedClass) || s.assignedStage === servant.assignedStage;
            });
            setAllServants(stageServs);
        } catch (err) {
            console.error("Error fetching servants:", err);
        }
    };

    useEffect(() => {
        if (!servant.assignedStage) return;

        // 🛠️ الخطوة الأولى: الفلترة من السيرفر (Server-side Filtering) للطلاب
        const gradesToFilter = [servant.assignedStage, ...stageClasses].filter(Boolean);
        const qStudents = query(collection(db, 'students'), where('schoolGrade', 'in', gradesToFilter));
        const unsubStudents = onSnapshot(qStudents, (snap) => {
            const stageStudents = snap.docs.map(d => ({id: d.id, ...d.data()}));
            setAllStudents(stageStudents);
        });

        // جلب الخدام عند تحميل المكون
        fetchServants();

        return () => {
            unsubStudents();
        };
    }, [servant.assignedStage, servant.id]);

    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'attendance_config'), (snapshot) => {
            const configMap = {};
            snapshot.docs.forEach(doc => {
                configMap[doc.id] = doc.data();
            });
            setAttendanceConfigs(configMap);
        });
        return () => unsub();
    }, []);


    // Derived Stats
    const getLastFridayStr = () => {
        const d = new Date();
        d.setDate(d.getDate() - ((d.getDay() + 2) % 7));
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    const getCurrentMonthKey = () => `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    const getCleanCreatedAtTime = (st) => {
        if (!st) return 0;
        if (st.createdAt === null) return Date.now(); // الكاش المحلي للطلبة الجدد فوراً
        if (typeof st.createdAt === 'undefined') return 0; // الطلاب القدامى المسجلين بدون حقل
        
        // إذا كان كائن فايرستور تيمستامب نقي
        if (typeof st.createdAt.toDate === 'function') return st.createdAt.toDate().getTime();
        
        // حل مشكلة السيرياليزيشن (إذا تحول لكائن يحتوي على ثواني)
        if (st.createdAt && typeof st.createdAt.seconds === 'number') {
            return st.createdAt.seconds * 1000;
        }
        
        // كابل تراجع أخير
        const t = new Date(st.createdAt).getTime();
        return isNaN(t) ? 0 : t;
    };

    const calculateOverviewStats = () => {
        let attended = 0;
        let visited = 0;
        const lastFriday = getLastFridayStr();
        const curMonth = getCurrentMonthKey();

        // FORCE to pure number once at declaration
        const lastFridayParts = lastFriday.split('-');
        const lastFridayEndTime = new Date(parseInt(lastFridayParts[0], 10), parseInt(lastFridayParts[1], 10) - 1, parseInt(lastFridayParts[2], 10), 23, 59, 59).getTime();
        const curMonthEndTime = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59).getTime();

        let totalStudentsForAttendance = 0;
        let totalStudentsForMonthly = 0;
        let absentCount = 0;
        let phoneCalledCount = 0;

        const filteredStudents = selectedClass
            ? allStudents.filter(st => st.assignedClass === selectedClass)
            : allStudents;

        filteredStudents.forEach(st => {
            const createdAtTime = getCleanCreatedAtTime(st);

            const isAttended = st.attendance?.some(d => d.startsWith(lastFriday));
            const isLiturgyAttended = st.liturgyAttendance?.some(d => d.startsWith(lastFriday));

            // CRITICAL EXCLUSION: Only count student for attendance if they existed on last Friday
            const existedLastFriday = (lastFridayEndTime >= createdAtTime) || isAttended || isLiturgyAttended;
            if (existedLastFriday) {
                totalStudentsForAttendance++;
                if (isAttended) {
                    attended++;
                } else {
                    absentCount++;
                    const phoneStatus = st.phoneVisitations?.[lastFriday]?.status;
                    if (phoneStatus === 'called' || phoneStatus === 'visited' || phoneStatus === 'late_attended') {
                        phoneCalledCount++;
                    }
                }
            }

            // CRITICAL EXCLUSION: Only count student for monthly stats if they existed in this month
            const existedInMonth = curMonthEndTime >= createdAtTime;
            if (existedInMonth) {
                totalStudentsForMonthly++;
                if (st.homeVisitations?.[curMonth]?.status === 'visited') {
                    visited++;
                }
            }
        });

        const homeRate = totalStudentsForMonthly ? Math.round((visited / totalStudentsForMonthly) * 100) : 0;
        const phoneRate = absentCount > 0 ? Math.round((phoneCalledCount / absentCount) * 100) : 100;

        const filteredServants = selectedClass
            ? allServants.filter(s => s.assignedClass === selectedClass)
            : allServants;

        return {
            totalStudents: filteredStudents.length,
            attended,
            totalStudentsForAttendance,
            homeRate,
            phoneRate,
            visitedRatio: homeRate, // keep for backward compatibility
            totalServants: filteredServants.length + (selectedClass ? 0 : 1) // including self only when showing all classes
        };
    };

    const stats = calculateOverviewStats();

    const handleSaveServant = async () => {
        try {
            const isNew = !editingServant;
            const servantData = {
                name: servantForm.name,
                code: servantForm.code,
                phone: servantForm.phone,
                address: servantForm.address,
                role: servantForm.role,
                assignedClass: servantForm.assignedClass,
                isActive: true
            };

            if (isNew) {
                // Create logic
                if (!servantData.code) return alert("كود الخادم مطلوب للإنشاء");
                servantData.password = servantData.code; // Default password
                servantData.status = 'approved';
                servantData.assignedStage = servant.assignedStage || '';
                servantData.createdAt = new Date().toISOString();
                
                await setDoc(doc(db, 'servants', servantData.code), servantData);
            } else {
                // Update logic
                await updateDoc(doc(db, 'servants', editingServant.id), servantData);
            }

            setShowServantModal(false);
            setEditingServant(null);
            alert("تم حفظ بيانات الخادم بنجاح");
            fetchServants();
        } catch (e) {
            console.error(e);
            alert("حدث خطأ أثناء الحفظ");
        }
    };

    const handleToggleServantActive = async (s) => {
        if (!window.confirm(`هل أنت متأكد من ${s.isActive === false ? 'تفعيل' : 'تعطيل'} حساب الخادم؟`)) return;
        try {
            await updateDoc(doc(db, 'servants', s.id), { isActive: s.isActive === false ? true : false });
            fetchServants();
        } catch(e) { console.error(e); }
    };

    return (
        <div className="max-w-6xl mx-auto px-4 py-8" dir="rtl">
            <header className="mb-8 p-6 bg-slate-800 text-white rounded-2xl shadow-lg flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                    <h1 className="text-3xl font-black mb-2 flex items-center gap-3">
                        <Shield className="text-amber-400" size={32} />
                        أمانة المرحلة
                    </h1>
                    <p className="text-slate-300 font-bold">مرحباً أمين المرحلة {formData.name || servant.name}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <select
                        value={selectedStage}
                        onChange={(e) => {
                            const val = e.target.value;
                            setSelectedStage(val);
                            localStorage.setItem('selectedStageFilter', val);
                        }}
                        className="bg-slate-800 border border-slate-700 text-white rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-blue-500 cursor-pointer outline-none font-bold"
                    >
                        <option value={servant.assignedStage}>{servant.assignedStage}</option>
                    </select>
                    <select
                        value={selectedClass}
                        onChange={(e) => {
                            const val = e.target.value;
                            setSelectedClass(val);
                            localStorage.setItem('selectedClassFilter', val);
                        }}
                        className="bg-slate-800 border border-slate-700 text-white rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-blue-500 cursor-pointer outline-none font-bold"
                    >
                        <option value="">كل الفصول</option>
                        {stageClasses.map(cls => (
                            <option key={cls} value={cls}>{cls}</option>
                        ))}
                    </select>
                </div>
            </header>

            {/* TABS */}
            <div className="flex bg-white rounded-xl shadow-sm p-2 mb-8 border border-slate-100 overflow-x-auto">
                <button onClick={() => setActiveTab('overview')} className={`flex-1 py-3 px-6 rounded-lg font-black text-lg transition-all whitespace-nowrap ${activeTab === 'overview' ? 'bg-amber-100 text-amber-800' : 'text-slate-500 hover:bg-slate-50'}`}>
                    نظرة عامة
                </button>
                <button onClick={() => setActiveTab('classes')} className={`flex-1 py-3 px-6 rounded-lg font-black text-lg transition-all whitespace-nowrap ${activeTab === 'classes' ? 'bg-blue-100 text-blue-800' : 'text-slate-500 hover:bg-slate-50'}`}>
                    إدارة الفصول
                </button>
                <button onClick={() => setActiveTab('servants')} className={`flex-1 py-3 px-6 rounded-lg font-black text-lg transition-all whitespace-nowrap ${activeTab === 'servants' ? 'bg-emerald-100 text-emerald-800' : 'text-slate-500 hover:bg-slate-50'}`}>
                    إدارة الكادر وإدارة خدام مدارس الأحد
                </button>
            </div>

            {/* QUICK ACTIONS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-10">
                <button 
                    onClick={() => navigate('/servant/attendance')}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white p-8 rounded-2xl shadow-md border border-emerald-700 dark:border-emerald-800 text-center transition-all group scale-100 hover:scale-[1.02] flex flex-col items-center justify-center gap-3 cursor-pointer"
                >
                    <CheckCircle size={48} strokeWidth={2.5} className="mx-auto text-emerald-200 group-hover:-translate-y-1 transition-transform" />
                    <h3 className="text-xl font-black">كشوف حضور المخدومين</h3>
                    <p className="text-emerald-100 text-sm font-bold">تسجيل ومتابعة غياب مخدومي المرحلة وطباعة الكشوف</p>
                </button>

                <button 
                    onClick={() => navigate('/servant/visitation')}
                    className="bg-blue-600 hover:bg-blue-700 text-white p-8 rounded-2xl shadow-md border border-blue-700 dark:border-blue-800 text-center transition-all group scale-100 hover:scale-[1.02] flex flex-col items-center justify-center gap-3 cursor-pointer"
                >
                    <Home size={48} strokeWidth={2.5} className="mx-auto text-blue-200 group-hover:-translate-y-1 transition-transform" />
                    <h3 className="text-xl font-black">الافتقاد و المتابعه</h3>
                    <p className="text-blue-100 text-sm font-bold">متابعة الافتقاد المنزلي والهاتفي وتدارك الغُياب</p>
                </button>

                <button 
                    onClick={() => navigate('/admin/servants', { state: { prefilledStage: selectedStage || servant.assignedStage, prefilledClass: selectedClass } })}
                    className="bg-white dark:bg-[#1e293b] hover:bg-slate-50 dark:hover:bg-[#1e293b]/80 text-slate-805 dark:text-slate-200 p-8 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 text-center transition-all group scale-100 hover:scale-[1.02] flex flex-col items-center justify-center gap-3 cursor-pointer"
                >
                    <Users size={48} strokeWidth={2.5} className="mx-auto text-blue-600 dark:text-blue-400 group-hover:-translate-y-1 transition-transform" />
                    <h3 className="text-xl font-black text-slate-900 dark:text-white">إدارة خدام مدارس الأحد</h3>
                    <p className="text-slate-505 dark:text-slate-400 text-sm font-bold">متابعة بيانات خدام مدارس الأحد والمسؤوليات</p>
                </button>

                <button 
                    onClick={() => navigate('/admin/store')}
                    className="bg-white dark:bg-[#1e293b] hover:bg-slate-50 dark:hover:bg-[#1e293b]/80 text-slate-805 dark:text-slate-200 p-8 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 text-center transition-all group scale-100 hover:scale-[1.02] flex flex-col items-center justify-center gap-3 cursor-pointer"
                >
                    <div className="bg-amber-100 dark:bg-amber-900/30 p-4 rounded-xl text-amber-600 dark:text-amber-400 transition-colors">
                        <ShoppingBag size={48} strokeWidth={2.5} className="mx-auto group-hover:-translate-y-1 transition-transform" />
                    </div>
                    <h3 className="text-xl font-black text-slate-900 dark:text-white">إدارة معرض الصفات</h3>
                    <p className="text-sm text-slate-400 dark:text-slate-505 font-medium mt-1">إدارة الهدايا والمخزن والطلبات</p>
                </button>

                <button 
                    onClick={() => navigate('/admin/orders')}
                    className="bg-slate-800 hover:bg-slate-700 dark:bg-[#1e293b] dark:hover:bg-[#1e293b]/80 text-white p-8 rounded-2xl shadow-md border border-slate-700 dark:border-slate-805 text-center transition-all group scale-100 hover:scale-[1.02] flex flex-col items-center justify-center gap-3 cursor-pointer"
                >
                    <div className="bg-slate-750 dark:bg-slate-800 p-4 rounded-xl text-white transition-colors">
                        <ClipboardList size={48} strokeWidth={2.5} className="mx-auto group-hover:-translate-y-1 transition-transform" />
                    </div>
                    <h3 className="text-xl font-black text-white">طلبات معرض الصفات</h3>
                    <p className="text-sm text-slate-300 dark:text-slate-400 font-bold mt-1">متابعة الطلبات المستلمة والأرشيف</p>
                </button>
            </div>

            {/* TAB CONTENT: OVERVIEW */}
            {activeTab === 'overview' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
                            <div className="bg-blue-100 p-4 rounded-xl text-blue-600"><Users size={32} /></div>
                            <div>
                                <p className="text-sm font-bold text-slate-500 mb-1">إجمالي القطيع</p>
                                <p className="text-3xl font-black text-slate-800">{stats.totalStudents}</p>
                            </div>
                        </div>
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-emerald-100 flex items-center gap-4">
                            <div className="bg-emerald-100 p-4 rounded-xl text-emerald-600"><CalendarDays size={32} /></div>
                            <div>
                                <p className="text-sm font-bold text-slate-500 mb-1">حضور جمعة (مرحلة)</p>
                                <p className="text-3xl font-black text-emerald-600">{stats.attended} <span className="text-base text-slate-400">من {stats.totalStudentsForAttendance}</span></p>
                            </div>
                        </div>
                        <div className="bg-white p-3 rounded-2xl shadow-sm border border-amber-100 flex items-center gap-4">
                            <div className="bg-amber-100 p-3 rounded-xl text-amber-600 shrink-0"><Home size={28} /></div>
                            <div className="w-full">
                                <div className="flex justify-between items-center mb-1 pb-1 border-b border-slate-100">
                                    <span className="text-xs text-slate-500 font-bold">نسبة الافتقاد</span>
                                </div>
                                <div className="flex flex-col gap-1 text-right mt-1">
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-slate-500 font-medium">الافتقاد المنزلي:</span>
                                        <span className="font-black text-slate-800 text-sm">{stats.homeRate}%</span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-slate-500 font-medium">الافتقاد الأسبوعي:</span>
                                        <span className="font-black text-slate-800 text-sm">{stats.phoneRate}%</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-purple-100 flex items-center gap-4">
                            <div className="bg-purple-100 p-4 rounded-xl text-purple-600"><UserCog size={32} /></div>
                            <div>
                                <p className="text-sm font-bold text-slate-500 mb-1">كادر الخدمة</p>
                                <p className="text-3xl font-black text-purple-600">{stats.totalServants} <span className="text-base text-slate-400">خادم</span></p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB CONTENT: CLASSES */}
            {activeTab === 'classes' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 animate-in fade-in slide-in-from-bottom-4">
                    <h2 className="text-2xl font-black mb-6 text-slate-800">بيانات الفصول التفصيلية</h2>
                    
                    <div className="mb-8">
                        <label className="block font-bold text-slate-500 mb-2">اختر فصلاً لعرض بياناته الأساسية</label>
                        <select 
                            className="p-4 border border-slate-200 rounded-xl w-full md:w-1/2 font-bold focus:ring-2 focus:ring-blue-500 dark:bg-[#1e293b] dark:border-slate-800 dark:text-white"
                            value={selectedClass} 
                            onChange={e => {
                                const val = e.target.value;
                                setSelectedClass(val);
                                localStorage.setItem('selectedClassFilter', val);
                            }}
                        >
                            <option value="">-- اختر الفصل --</option>
                            {stageClasses.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>

                    {selectedClass && (
                        <div className="space-y-6 animate-in fade-in duration-300">

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                <div className="border border-slate-200 rounded-xl p-6">
                                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-blue-600 border-b pb-2"><Users /> طلاب {selectedClass}</h3>
                                    <div className="max-h-96 overflow-y-auto">
                                        {allStudents.filter(s => s.schoolGrade === selectedClass || s.assignedClass === selectedClass).map((st, i) => (
                                            <div key={st.id} className="py-2 border-b border-slate-50 flex justify-between">
                                                <span className="font-bold text-slate-700">{i+1}. {st.name}</span>
                                                <span className="text-sm text-slate-400">{st.phones?.[0]}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="border border-slate-200 rounded-xl p-6">
                                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-emerald-600 border-b pb-2"><UserCog /> خدام {selectedClass}</h3>
                                    <div className="max-h-96 overflow-y-auto">
                                        {allServants.filter(s => s.assignedClass === selectedClass).map(sv => (
                                            <div key={sv.id} className="py-2 border-b border-slate-50 flex justify-between items-center">
                                                <div>
                                                    <span className="font-bold text-slate-700 block">{sv.name} {sv.isActive === false && <span className="text-xs text-red-500 bg-red-100 px-2 rounded">معطل</span>}</span>
                                                    <span className="text-sm text-slate-500">{sv.role}</span>
                                                </div>
                                                <span className="text-sm text-slate-400 font-mono bg-slate-100 px-2 py-1 rounded">{sv.code}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* TAB CONTENT: SERVANTS */}
            {activeTab === 'servants' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 animate-in fade-in slide-in-from-bottom-4">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-black text-slate-800">إدارة כادر الخدمة بالمرحلة</h2>
                        <button 
                            onClick={() => {
                                setEditingServant(null);
                                setServantForm({ name: '', code: '', phone: '', address: '', role: 'خادم فصل', assignedClass: '' });
                                setShowServantModal(true);
                            }}
                            className="bg-emerald-600 text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 hover:bg-emerald-700"
                        >
                            <UserPlus size={20} /> إضافة خادم جديد
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                                    <th className="p-4 text-right">م</th>
                                    <th className="p-4 text-right">الاسم</th>
                                    <th className="p-4 text-right">الكود</th>
                                    <th className="p-4 text-right">الدور</th>
                                    <th className="p-4 text-right">الفصل المعين</th>
                                    <th className="p-4 text-center">الحالة</th>
                                    <th className="p-4 text-center">إجراءات</th>
                                </tr>
                            </thead>
                            <tbody>
                                {allServants.map((s, idx) => (
                                    <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                                        <td className="p-4 font-bold text-slate-400">{idx + 1}</td>
                                        <td className="p-4 font-black text-slate-800">{s.name}</td>
                                        <td className="p-4 font-mono font-bold text-slate-500 bg-slate-100 px-2 rounded inline-block mt-2">{s.code}</td>
                                        <td className="p-4 font-bold text-blue-600">{s.role}</td>
                                        <td className="p-4 font-bold text-slate-600">{s.assignedClass || '—'}</td>
                                        <td className="p-4 text-center">
                                            {s.isActive === false ? 
                                                <span className="text-xs bg-red-100 text-red-700 px-3 py-1 rounded-full font-bold">معطل</span> 
                                                : <span className="text-xs bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full font-bold">نشط</span>}
                                        </td>
                                        <td className="p-4 text-center flex items-center justify-center gap-2">
                                            <button 
                                                onClick={() => {
                                                    setEditingServant(s);
                                                    setServantForm({
                                                        name: s.name || '', code: s.code || '', phone: s.phone || '', 
                                                        address: s.address || '', role: s.role || 'خادم فصل', assignedClass: s.assignedClass || ''
                                                    });
                                                    setShowServantModal(true);
                                                }}
                                                className="p-2 text-blue-600 bg-blue-50 rounded hover:bg-blue-100" title="تعديل"
                                            >
                                                <Edit size={18} />
                                            </button>
                                            <button 
                                                onClick={() => handleToggleServantActive(s)}
                                                className={`p-2 rounded ${s.isActive === false ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100' : 'text-red-600 bg-red-50 hover:bg-red-100'}`} 
                                                title={s.isActive === false ? "تفعيل الحساب" : "تعطيل الحساب"}
                                            >
                                                {s.isActive === false ? <CheckCircle size={18} /> : <Ban size={18} />}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* SERVANT MODAL */}
            {showServantModal && (
                <div className="fixed inset-0 bg-slate-900/50 flex flex-col justify-center items-center z-50 p-4">
                    <div className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl">
                        <div className="bg-slate-800 text-white p-6 flex justify-between items-center">
                            <h3 className="text-2xl font-black">{editingServant ? 'تعديل بيانات الخادم' : 'إضافة خادم جديد للمرحلة'}</h3>
                            <button onClick={() => setShowServantModal(false)} className="text-slate-400 hover:text-white">✕</button>
                        </div>
                        <div className="p-8 space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-bold text-slate-500 mb-2">اسم الخادم</label>
                                    <input className="w-full p-3 bg-slate-50 border rounded-lg font-bold outline-none focus:ring-blue-500" value={servantForm.name} onChange={e => setServantForm({...servantForm, name: e.target.value})} placeholder="الاسم رباعي" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-500 mb-2">كود الخادم (لتسجيل الدخول)</label>
                                    <input className="w-full p-3 bg-slate-50 border rounded-lg font-mono font-bold outline-none focus:ring-blue-500 text-left" dir="ltr" value={servantForm.code} onChange={e => setServantForm({...servantForm, code: e.target.value})} placeholder="مثال: 4001" disabled={!!editingServant} />
                                    {!!editingServant && <p className="text-xs text-slate-400 mt-1">لا يمكن تغيير الكود بعد الإنشاء</p>}
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-500 mb-2">رقم التليفون (اختياري)</label>
                                    <input className="w-full p-3 bg-slate-50 border rounded-lg font-bold outline-none focus:ring-blue-500 text-left" dir="ltr" value={servantForm.phone} onChange={e => setServantForm({...servantForm, phone: e.target.value})} />
                                </div>
                                <div className="md:col-span-2 border-t pt-4">
                                    <label className="block text-sm font-bold text-slate-500 mb-2">الدور في الخدمة</label>
                                    <select className="w-full p-3 bg-slate-50 border rounded-lg font-bold outline-none focus:ring-blue-500" value={servantForm.role} onChange={e => setServantForm({...servantForm, role: e.target.value})}>
                                        <option value="خادم فصل">خادم فصل</option>
                                        <option value="أمين أسرة">أمين أسرة</option>
                                        <option value="أمين مرحلة">أمين مرحلة مساعد</option>
                                    </select>
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-bold text-amber-600 mb-2">تعيين في فصل (من فصول المرحلة)</label>
                                    <select className="w-full p-3 bg-amber-50 border-amber-200 rounded-lg font-bold outline-none focus:ring-amber-500" value={servantForm.assignedClass} onChange={e => setServantForm({...servantForm, assignedClass: e.target.value})}>
                                        <option value="">-- اضغط لاختيار فصل --</option>
                                        {stageClasses.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div className="bg-slate-50 p-6 flex justify-end gap-4 border-t border-slate-100">
                            <button onClick={() => setShowServantModal(false)} className="px-6 py-3 font-bold text-slate-500 hover:bg-slate-200 rounded-lg">إلغاء</button>
                            <button onClick={handleSaveServant} className="px-6 py-3 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-2">
                                <CheckCircle size={20} /> حفظ خادم المرحلة
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
