import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, doc, onSnapshot, updateDoc, setDoc, db } from '../firebase';
import { Save, Lock, Plus, Users, LayoutDashboard, User, CheckCircle, Clock, Home, CalendarDays, ShoppingBag, Flame, ArrowRight, ClipboardList, Gift, Church,MapPin, Bell } from 'lucide-react';
import StageAdminDashboard from './StageAdminDashboard';

/**
 * Filters the full student list down to only those visible to the given servant.
 * - Stage Admin (أمين مرحلة): sees all classes in their managedClasses list,
 *   or falls back to filtering by assignedStage.
 * - Regular class servant: sees ONLY students in their assignedClass.
 */
const normalizeArabic = (str) => {
    if (!str) return '';
    return str
        .replace(/[أإآا]/g, 'ا')
        .replace(/[ىي]/g, 'ي')
        .replace(/[ةه]/g, 'ه')
        .trim();
};

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

const generateWeeks = (count = 12) => {
    const weeks = [];
    const today = new Date();
    
    // Find the Friday at the end of the current week (from Saturday to Friday)
    const currentFriday = new Date();
    const daysToFriday = (5 - today.getDay() + 7) % 7;
    currentFriday.setDate(today.getDate() + daysToFriday);
    
    const minFriday = new Date(2026, 5, 19); // Friday June 19, 2026
    minFriday.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < 52; i++) { // max 52 weeks
        const friday = new Date(currentFriday);
        friday.setDate(currentFriday.getDate() - (i * 7));
        friday.setHours(0, 0, 0, 0);
        
        if (friday.getTime() < minFriday.getTime()) {
            break;
        }
        
        const saturday = new Date(friday);
        saturday.setDate(friday.getDate() - 6);
        
        const y = friday.getFullYear();
        const m = String(friday.getMonth() + 1).padStart(2, '0');
        const dStr = String(friday.getDate()).padStart(2, '0');
        const fridayStr = `${y}-${m}-${dStr}`;
        
        const options = { month: 'short', day: 'numeric' };
        const label = `الجمعة ${friday.toLocaleDateString('ar-EG', options)} (من السبت ${saturday.toLocaleDateString('ar-EG', options)} إلى الجمعة ${friday.toLocaleDateString('ar-EG', options)})`;
        
        weeks.push({
            key: fridayStr,
            label: label,
            fridayDate: friday,
            saturdayDate: saturday
        });
    }
    return weeks;
};

const weeksList = generateWeeks(12);

const getCleanCreatedAtTime = (s) => {
    if (!s || !s.createdAt) return 0;
    try {
        if (typeof s.createdAt.toDate === 'function') {
            return s.createdAt.toDate().getTime();
        }
        if (typeof s.createdAt.seconds === 'number') {
            return s.createdAt.seconds * 1000;
        }
        return new Date(s.createdAt).getTime();
    } catch (e) {
        console.error("Error parsing createdAt:", e);
        return 0;
    }
};

const isServantActiveInWeek = (s, fridayStr) => {
    const createdTime = getCleanCreatedAtTime(s);
    if (createdTime === 0) return true; // default active for older accounts
    
    const parts = fridayStr.split('-');
    const friday = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    // Set to the end of Friday (23:59:59.999)
    friday.setHours(23, 59, 59, 999);
    
    return createdTime <= friday.getTime();
};

function filterStudentsForServant(list, servantData) {
    if (!servantData) return list;
    const roleNorm = servantData.role ? normalizeArabic(servantData.role) : '';
    if (roleNorm.includes('مرحله')) {
        const managed = servantData.managedClasses || [];
        if (managed.length > 0) {
            return list.filter(s => managed.includes(s.assignedClass));
        }
        const stage = servantData.assignedStage || servantData.grade || '';
        return list.filter(s => s.schoolGrade === stage);
    }
    
    // Class Servant multi-class support
    const myClasses = servantData.myClasses && servantData.myClasses.length > 0
        ? servantData.myClasses
        : (servantData.assignedClass || servantData.assignment ? [servantData.assignedClass || servantData.assignment] : []);

    if (myClasses.length > 0) {
        return list.filter(s => myClasses.includes(s.assignedClass));
    }
    return [];
}

export default function ServantProfile() {
    const [servant, setServant] = useState(null);
    const [loading, setLoading] = useState(true);
    const [formData, setFormData] = useState({ name: '', phone: '', address: '', birthDate: '' });
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [students, setStudents] = useState([]);
    const [attendanceConfigs, setAttendanceConfigs] = useState({});
    const [selectedStage, setSelectedStage] = useState(() => localStorage.getItem('selectedStageFilter') || '');
    const [selectedClass, setSelectedClass] = useState(() => localStorage.getItem('selectedClassFilter') || '');
    const [selectedWeekKey, setSelectedWeekKey] = useState(() => weeksList[0].key);
    const isActive = isServantActiveInWeek(servant, selectedWeekKey);

    const isInit = useRef(false);
    const navigate = useNavigate();

    useEffect(() => {
        const servantId = localStorage.getItem('servantId');
        if (!servantId) {
            navigate('/login');
            return;
        }

        let unsubStudents = () => {};

        const unsub = onSnapshot(doc(db, 'servants', servantId), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setServant({ id: docSnap.id, ...data });
                
                if (!isInit.current) {
                    const sanitizedName = typeof data.name === 'object' ? data.name.name : data.name;
                    setFormData({
                        name: sanitizedName || '',
                        phone: data.phone || '',
                        address: data.address || '',
                        birthDate: data.birthDate || ''
                    });
                    isInit.current = true;
                }

                // Fetch their students to calculate stats — scoped to this servant's class/stage
                unsubStudents(); // clear previous listener
                unsubStudents = onSnapshot(collection(db, 'students'), (snap) => {
                    const stuList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    const visibleStudents = filterStudentsForServant(stuList, data);
                    setStudents(visibleStudents);
                });

            } else {
                navigate('/login');
            }
            setLoading(false);
        }, (error) => {
            console.error("Error fetching servant:", error);
            setLoading(false);
        });

        return () => {
            unsub();
            unsubStudents();
        };
    }, [navigate]);

    // Fetch and sync class-isolated attendance configs
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

    const myClassesList = useMemo(() => {
        if (!servant) return [];
        const roleNorm = servant.role ? normalizeArabic(servant.role) : '';
        if (roleNorm.includes('مرحله')) {
            // Restrict stage admin selection strictly to their managed classes
            const managed = Array.isArray(servant.managedClasses) ? servant.managedClasses : [];
            if (managed.length > 0) return managed;
            
            // Fallback for stage servant if managedClasses is empty
            const rawStage = servant.assignedStage || servant.grade || '';
            let tempStage = '';
            if (rawStage.includes('ابتدائي') || rawStage.includes('ابتدائى')) {
                tempStage = 'ابتدائي';
            } else if (rawStage.includes('اعدادي') || rawStage.includes('اعدادى')) {
                tempStage = 'اعدادي';
            } else if (rawStage.includes('ثانوي') || rawStage.includes('ثانوى')) {
                tempStage = 'ثانوي';
            }
            return STAGE_CLASS_MAP[tempStage] || [];
        }
        
        // Class servant support for myClasses
        return servant.myClasses && servant.myClasses.length > 0
            ? servant.myClasses
            : (servant.assignedClass || servant.assignment ? [servant.assignedClass || servant.assignment] : []);
    }, [servant]);

    const myStage = useMemo(() => {
        if (!servant) return 'الكل';
        const rawStage = servant.assignedStage || servant.grade || '';
        if (rawStage.includes('ابتدائي') || rawStage.includes('ابتدائى')) {
            return 'ابتدائي';
        } else if (rawStage.includes('اعدادي') || rawStage.includes('اعدادى')) {
            return 'اعدادي';
        } else if (rawStage.includes('ثانوي') || rawStage.includes('ثانوى')) {
            return 'ثانوي';
        }
        return 'الكل';
    }, [servant]);

    const streakAvailableClasses = useMemo(() => {
        if (selectedStage === 'الكل') {
            return myClassesList;
        }
        const stageClasses = STAGE_CLASS_MAP[selectedStage] || [];
        return myClassesList.filter(cls => stageClasses.includes(cls));
    }, [selectedStage, myClassesList]);

    // Initialize/Sync filters based on servant role and stage on load
    useEffect(() => {
        if (servant) {
            const storedStage = localStorage.getItem('selectedStageFilter');
            const storedClass = localStorage.getItem('selectedClassFilter');

            setSelectedStage(storedStage || myStage || '');

            if (myClassesList.includes(storedClass)) {
                setSelectedClass(storedClass);
            } else if (myClassesList.length === 1) {
                setSelectedClass(myClassesList[0]);
                localStorage.setItem('selectedClassFilter', myClassesList[0]);
            } else {
                setSelectedClass('');
            }
        }
    }, [servant, myStage, myClassesList]);

    const handleStageFilterChange = (newStage) => {
        setSelectedStage(newStage);
        localStorage.setItem('selectedStageFilter', newStage);
        if (newStage === 'الكل') return;
        const stageClasses = STAGE_CLASS_MAP[newStage] || [];
        if (!stageClasses.includes(selectedClass)) {
            setSelectedClass('');
            localStorage.removeItem('selectedClassFilter');
        }
    };



    const getLastFridayStr = () => {
        const d = new Date();
        d.setDate(d.getDate() - ((d.getDay() + 2) % 7));
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const getCurrentMonthKey = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

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

    const calculateStats = () => {
        const classFilteredStudents = selectedClass
            ? students.filter(s => s.assignedClass === selectedClass)
            : students;

        if (!classFilteredStudents || classFilteredStudents.length === 0) return { total: 0, attended: 0, attendedLiturgy: 0, totalStudentsForAttendance: 0, visitedRatio: 0, visitedCount: 0, homeRate: 0, phoneRate: 100 };
        const lastFriday = getLastFridayStr();
        const curMonth = getCurrentMonthKey();
        
        // FORCE to pure number once at declaration
        const lastFridayParts = lastFriday.split('-');
        const lastFridayEndTime = new Date(parseInt(lastFridayParts[0], 10), parseInt(lastFridayParts[1], 10) - 1, parseInt(lastFridayParts[2], 10), 23, 59, 59).getTime();
        const curMonthEndTime = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59).getTime();

        let attended = 0;
        let attendedLiturgy = 0;
        let visited = 0;
        let totalStudentsForAttendance = 0;
        let totalStudentsForMonthly = 0;
        let absentCount = 0;
        let phoneCalledCount = 0;

        classFilteredStudents.forEach(st => {
            const createdAtTime = getCleanCreatedAtTime(st);

            const isAttended = st.attendance && st.attendance.some(d => d.startsWith(lastFriday));
            const isLiturgyAttended = st.liturgyAttendance && st.liturgyAttendance.some(d => d.startsWith(lastFriday));

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

                if (isLiturgyAttended) {
                    attendedLiturgy++;
                }
            }

            // CRITICAL EXCLUSION: Only count student for monthly stats if they existed in this month
            const existedInMonth = curMonthEndTime >= createdAtTime;
            if (existedInMonth) {
                totalStudentsForMonthly++;
                if (st.homeVisitations && st.homeVisitations[curMonth] && st.homeVisitations[curMonth].status === 'visited') {
                    visited++;
                }
            }
        });

        const homeRate = totalStudentsForMonthly ? Math.round((visited / totalStudentsForMonthly) * 100) : 0;
        const phoneRate = absentCount > 0 ? Math.round((phoneCalledCount / absentCount) * 100) : 100;

        return {
            total: classFilteredStudents.length,
            attended,
            attendedLiturgy,
            totalStudentsForAttendance,
            visitedRatio: homeRate,
            visitedCount: visited,
            homeRate,
            phoneRate
        };
    };

    const handleToggleWeeklyFollowUp = async (weekKey, field, currentValue) => {
        if (!servant?.id) return;
        const updatedWeeklyFollowUp = {
            ...(servant.weeklyFollowUp || {}),
            [weekKey]: {
                ...(servant.weeklyFollowUp?.[weekKey] || {}),
                [field]: !currentValue
            }
        };
        try {
            await updateDoc(doc(db, 'servants', servant.id), {
                weeklyFollowUp: updatedWeeklyFollowUp
            });
        } catch (error) {
            console.error("Error updating weekly follow-up:", error);
            alert('حدث خطأ أثناء حفظ التحديث');
        }
    };

    const handleUpdateInfo = async () => {
        try {
            await updateDoc(doc(db, 'servants', servant.id), {
                name: formData.name,
                phone: formData.phone,
                address: formData.address,
                birthDate: formData.birthDate || ''
            });
            alert('تم تحديث بياناتك بنجاح 🌟');
        } catch (error) {
            console.error("Error updating info:", error);
            alert('حدث خطأ أثناء التحديث');
        }
    };

    const handleUpdatePassword = async () => {
        if (!newPassword || !confirmPassword) {
            alert('الرجاء إدخال كلمة المرور وتأكيدها');
            return;
        }
        if (newPassword !== confirmPassword) {
            alert('كلمتا المرور غير متطابقتين');
            return;
        }

        try {
            await updateDoc(doc(db, 'servants', servant.id), {
                password: newPassword,
                isPasswordChanged: true
            });
            alert('تم تغيير كلمة المرور بنجاح 🔒');
            setNewPassword('');
            setConfirmPassword('');
        } catch (error) {
            console.error("Error updating password:", error);
            alert('حدث خطأ أثناء تغيير كلمة المرور');
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
                <p className="text-lg font-medium text-slate-500 dark:text-slate-400">جاري التحميل...</p>
            </div>
        );
    }
    
    if (!servant) return null;

    const stats = calculateStats();
    const roleNorm = servant?.role ? normalizeArabic(servant.role) : '';

    const renderedServiceResponsibility = servant?.myClasses && servant.myClasses.length > 0
        ? servant.myClasses.join('، ')
        : (servant?.myClass || servant?.assignedClass || servant?.assignedStage || 'عام');

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#0f172a] dark:text-slate-50 transition-colors duration-300 py-8" dir="rtl">
            <div className="max-w-5xl mx-auto px-4">
                <header className="mb-8 text-right w-full flex flex-col gap-4 border-b border-slate-200 dark:border-slate-800 pb-5" dir="rtl">
                    {/* Back Link */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        {/* Header Text */}
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">أهلاً استاذ {formData.name || (typeof servant.name === 'object' ? servant.name.name : servant.name)}</h1>
                            <p className="text-slate-500 dark:text-slate-400 text-s font-bold">وَأَنَا أَشْكُرُ الْمَسِيحَ يَسُوعَ رَبَّنَا الَّذِي قَوَّانِي، أَنَّهُ حَسِبَنِي أَمِينًا، إِذْ جَعَلَنِي لِلْخِدْمَةِ (1 تي 1: 12)</p>
                            <y2 className="text-slate-500 dark:text-slate-400 text-s font-bold">مرحباً بك في لوحة تحكم الخدمة - ({servant.role || 'خادم'})</y2>
                        </div>

                        {/* Interactive Dropdown Selectors */}
                        <div className="flex items-center gap-3 shrink-0">
                            <select
                                value={selectedStage}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setSelectedStage(val);
                                    localStorage.setItem('selectedStageFilter', val);
                                }}
                                className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-805 text-slate-805 dark:text-white rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-blue-500 cursor-pointer outline-none font-bold shadow-sm"
                            >
                                <option value={myStage}>{myStage}</option>
                            </select>
                            <select
                                value={selectedClass}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setSelectedClass(val);
                                    localStorage.setItem('selectedClassFilter', val);
                                }}
                                className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-805 text-slate-805 dark:text-white rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-blue-500 cursor-pointer outline-none font-bold shadow-sm"
                                disabled={myClassesList.length <= 1}
                            >
                                {myClassesList.length > 1 && <option value="">كل الفصول</option>}
                                {myClassesList.map(cls => (
                                    <option key={cls} value={cls}>{cls}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </header>
                    <>
                        {/* Quick Stats Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
                            <div className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-md rounded-2xl p-6 text-slate-800 dark:text-slate-200 flex items-center gap-4">
                                <div className="bg-blue-100 dark:bg-blue-900/30 p-4 rounded-xl text-blue-600 dark:text-blue-400 font-bold shrink-0">
                                    <Users size={32} />
                                </div>
                                <div>
                                    <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold mb-1.5">عدد المخدومين</p>
                                    <p className="text-3xl font-black text-slate-900 dark:text-white">{stats.total} <span className="text-base font-bold text-slate-400 dark:text-slate-500">مخدوم</span></p>
                                </div>
                            </div>

                            <div className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-md rounded-2xl p-4 text-slate-800 dark:text-slate-200 flex items-center gap-4">
                                <div className="bg-emerald-100 dark:bg-emerald-900/30 p-3.5 rounded-xl text-emerald-600 dark:text-emerald-400 font-bold shrink-0">
                                    <CalendarDays size={28} />
                                </div>
                                <div className="w-full">
                                    <div className="flex justify-between items-center mb-1.5 pb-1 border-b border-slate-100 dark:border-slate-800">
                                        <span className="text-xs text-slate-500 dark:text-slate-400 font-bold">حضور آخر جمعة</span>
                                    </div>
                                    <div className="flex flex-col gap-2 text-right mt-1.5">
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-slate-500 dark:text-slate-400 font-bold">حضور الخدمة:</span>
                                            <span className="font-black text-emerald-600 dark:text-emerald-400 text-base">{stats.attended} <span className="text-xs font-bold text-slate-400 dark:text-slate-500">من {stats.totalStudentsForAttendance}</span></span>
                                        </div>
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-slate-500 dark:text-slate-400 font-bold">حضور القداس:</span>
                                            <span className="font-black text-purple-600 dark:text-purple-400 text-base">{stats.attendedLiturgy} <span className="text-xs font-bold text-slate-400 dark:text-slate-500">من {stats.totalStudentsForAttendance}</span></span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-md rounded-2xl p-4 text-slate-800 dark:text-slate-200 flex items-center gap-4">
                                <div className="bg-amber-100 dark:bg-amber-900/30 p-3.5 rounded-xl text-amber-600 dark:text-amber-400 font-bold shrink-0">
                                    <Home size={28} />
                                </div>
                                <div className="w-full">
                                    <div className="flex justify-between items-center mb-1.5 pb-1 border-b border-slate-100 dark:border-slate-800">
                                        <span className="text-xs text-slate-500 dark:text-slate-400 font-bold">نسبة الافتقاد</span>
                                    </div>
                                    <div className="flex flex-col gap-2 text-right mt-1.5">
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-slate-500 dark:text-slate-400 font-bold">الافتقاد المنزلي:</span>
                                            <span className="font-black text-slate-900 dark:text-white text-base">{stats.homeRate}%</span>
                                        </div>
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-slate-500 dark:text-slate-400 font-bold">الافتقاد الأسبوعي:</span>
                                            <span className="font-black text-slate-900 dark:text-white text-base">{stats.phoneRate}%</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Dedicated Clickable Streak stats card */}
                            {myClassesList.length > 0 && (
                                <div className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-md rounded-2xl p-6 text-slate-800 dark:text-slate-200 flex flex-col justify-center gap-4 transition-all duration-200 min-w-0">
                                    <div 
                                        onClick={() => navigate('/servant/gifts', { 
                                            state: { 
                                                activeTab: 'four_weeks', 
                                                prefilledStage: selectedStage || myStage, 
                                                prefilledClass: selectedClass 
                                            } 
                                        })}
                                        className="flex items-center gap-3.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 p-2.5 -mx-2.5 rounded-xl transition-all duration-200 group min-w-0"
                                    >
                                        <div className="bg-orange-100 dark:bg-orange-950/40 p-3 rounded-xl text-orange-600 dark:text-orange-400 font-bold shrink-0">
                                            <Flame size={24} />
                                        </div>
                                        <div className="text-right min-w-0 flex-1">
                                            <p className="text-slate-400 dark:text-slate-500 text-xs font-semibold mb-0.5">استريك</p>
                                            <p className="text-sm md:text-base font-black text-slate-800 dark:text-white group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors truncate" title="نظام متابعة الـ 4 أسابيع">نظام متابعة الـ 4 أسابيع</p>
                                        </div>
                                    </div>
                                    
                                    <hr className="border-slate-200 dark:border-slate-700/80 my-1.5" />
                                    
                                    <div 
                                        onClick={() => navigate('/servant/gifts', { 
                                            state: { 
                                                activeTab: 'birthdays', 
                                                prefilledStage: selectedStage || myStage, 
                                                prefilledClass: selectedClass 
                                            } 
                                        })}
                                        className="flex items-center gap-3.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 p-2.5 -mx-2.5 rounded-xl transition-all duration-200 group min-w-0"
                                    >
                                        <div className="bg-amber-100 dark:bg-amber-950/40 p-3 rounded-xl text-amber-600 dark:text-amber-400 font-bold shrink-0">
                                            <Gift size={24} />
                                        </div>
                                        <div className="text-right min-w-0 flex-1">
                                            <p className="text-slate-400 dark:text-slate-500 text-xs font-semibold mb-0.5">أعياد الميلاد</p>
                                            <p className="text-sm md:text-base font-black text-slate-800 dark:text-white group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors truncate" title="نظام متابعة أعياد الميلاد">نظام متابعة أعياد الميلاد</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Functional Routing Cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
                            <button 
                                onClick={() => navigate('/servant/dashboard', { state: { prefilledClass: selectedClass } })}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white p-8 rounded-2xl shadow-md border border-indigo-700 dark:border-indigo-800 text-center transition-all group scale-100 hover:scale-[1.02] flex flex-col items-center justify-center gap-3 cursor-pointer"
                            >
                                <Users size={48} strokeWidth={2.5} className="mx-auto text-indigo-200 group-hover:-translate-y-1 transition-transform" />
                                <h3 className="text-xl font-black">إدارة المخدومين</h3>
                                <p className="text-indigo-100 text-sm font-bold">تسجيل حضور الخدمة و القداس و اضافه الصفات و اضافة مخدوم جديد و تعديل بيانات المخدومين و طباعة كارنيهات المخدومين</p>
                            </button>

                            <button 
                                onClick={() => navigate('/servant/attendance')}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white p-8 rounded-2xl shadow-md border border-emerald-700 dark:border-emerald-800 text-center transition-all group scale-100 hover:scale-[1.02] flex flex-col items-center justify-center gap-3 cursor-pointer"
                            >
                                <CheckCircle size={48} strokeWidth={2.5} className="mx-auto text-emerald-200 group-hover:-translate-y-1 transition-transform" />
                                <h3 className="text-xl font-black">كشوف حضور المخدومين</h3>
                                <p className="text-white text-sm font-bold">متابعة حضور و غياب مخدومي الفصل وطباعة الكشوف</p>
                            </button>

                            <button 
                                onClick={() => navigate('/servant/visitation')}
                                className="bg-blue-600 hover:bg-blue-700 text-white p-8 rounded-2xl shadow-md border border-blue-700 dark:border-blue-800 text-center transition-all group scale-100 hover:scale-[1.02] flex flex-col items-center justify-center gap-3 cursor-pointer"
                            >
                                <Home size={48} strokeWidth={2.5} className="mx-auto text-blue-200 group-hover:-translate-y-1 transition-transform" />
                                <h3 className="text-xl font-black">الافتقاد و المتابعه</h3>
                                <p className="text-blue-100 text-sm font-bold">متابعة الافتقاد المنزلي والهاتفي و كشوف الغياب</p>
                            </button>



                            {roleNorm.includes('مرحله') ? (
                                <button 
                                    onClick={() => navigate('/admin/servants', { state: { prefilledStage: selectedStage || myStage, prefilledClass: selectedClass } })}
                                    className="bg-white dark:bg-[#1e293b] hover:bg-slate-50 dark:hover:bg-[#1e293b]/80 text-slate-805 dark:text-slate-200 p-8 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 text-center transition-all group scale-100 hover:scale-[1.02] flex flex-col items-center justify-center gap-3 cursor-pointer"
                                >
                                    <Users size={48} strokeWidth={2.5} className="mx-auto text-blue-600 dark:text-blue-400 group-hover:-translate-y-1 transition-transform" />
                                    <h3 className="text-xl font-black">إدارة خدام مدارس الأحد</h3>
                                    <p className="text-slate-505 dark:text-slate-400 text-sm font-bold">متابعة بيانات الخدام و طلبات التسجيل و المتابعة الاسبوعية</p>
                                </button>
                            ) : (
                                <button 
                                    onClick={() => navigate('/class-servants')}
                                    className="bg-white dark:bg-[#1e293b] hover:bg-slate-50 dark:hover:bg-[#1e293b]/80 text-slate-805 dark:text-slate-200 p-8 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 text-center transition-all group scale-100 hover:scale-[1.02] flex flex-col items-center justify-center gap-3 cursor-pointer"
                                >
                                    <Users size={48} strokeWidth={2.5} className="mx-auto text-blue-600 dark:text-blue-400 group-hover:-translate-y-1 transition-transform" />
                                    <h3 className="text-xl font-black">خدام مدارس الأحد في فصلي</h3>
                                    <p className="text-slate-505 dark:text-slate-400 text-sm font-bold">قائمة بيانات التواصل مع خدام نفس فصلي</p>
                                </button>
                            )}

                            <button 
                                onClick={() => navigate('/admin/store')}
                                className="bg-white dark:bg-[#1e293b] hover:bg-slate-50 dark:hover:bg-[#1e293b]/80 text-slate-805 dark:text-slate-200 p-8 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 text-center transition-all group scale-100 hover:scale-[1.02] flex flex-col items-center justify-center gap-3 cursor-pointer"
                            >
                                <div className="bg-amber-100 dark:bg-amber-900/30 p-4 rounded-xl text-amber-600 dark:text-amber-400 transition-colors">
                                    <ShoppingBag size={48} strokeWidth={2.5} className="mx-auto group-hover:-translate-y-1 transition-transform" />
                                </div>
                                <h3 className="text-xl font-black text-slate-900 dark:text-white">إدارة معرض الصفات</h3>
                                <p className="text-sm text-slate-400 dark:text-slate-505 font-medium mt-1">إدارة الهدايا والمخزن وقفل و فتح المتجر</p>
                            </button>

                            <button 
                                onClick={() => navigate('/servant/orders')}
                                className="bg-slate-800 hover:bg-slate-700 dark:bg-[#1e293b] dark:hover:bg-[#1e293b]/80 text-white p-8 rounded-2xl shadow-md border border-slate-700 dark:border-slate-850 text-center transition-all group scale-100 hover:scale-[1.02] flex flex-col items-center justify-center gap-3 cursor-pointer"
                            >
                                <div className="bg-slate-750 dark:bg-slate-800 p-4 rounded-xl text-white transition-colors">
                                    <ClipboardList size={48} strokeWidth={2.5} className="mx-auto group-hover:-translate-y-1 transition-transform" />
                                </div>
                                <h3 className="text-xl font-black text-white">طلبات معرض الصفات</h3>
                                <p className="text-sm text-slate-300 dark:text-slate-400 font-bold mt-1">متابعة طلبات معرض الصفات</p>
                            </button>

                            <button 
                                onClick={() => navigate('/servant/dashboard?tab=notifications')}
                                className="bg-[#271e48] hover:bg-[#34275e] text-white p-8 rounded-2xl shadow-md border border-[#271e48] text-center transition-all group scale-100 hover:scale-[1.02] flex flex-col items-center justify-center gap-3 cursor-pointer"
                            >
                                <div className="bg-white/10 p-4 rounded-xl text-teal-350 transition-colors">
                                    <Bell size={48} strokeWidth={2.5} className="mx-auto group-hover:-translate-y-1 transition-transform" />
                                </div>
                                <h3 className="text-xl font-black text-white">لوحة تحكم الإشعارات</h3>
                                <p className="text-sm text-slate-300 font-bold mt-1">إعدادات الإشعارات التلقائية وأعياد الميلاد وبث الرسائل 🔔</p>
                            </button>
                        </div>

                        <div className="space-y-8">
                            <div className="bg-white dark:bg-[#1e293b] p-8 rounded-2xl shadow-md border border-slate-200 dark:border-slate-800">
                                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
                                    <div className="p-2 bg-amber-50 dark:bg-amber-950/30 text-amber-500 dark:text-amber-400 rounded-lg"><User size={24} /></div>
                                    <h3 className="text-xl font-black text-slate-900 dark:text-white">بيانات خادم الفصل (لا يمكن تعديلها)</h3>
                                </div>
                                
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div className="bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 text-slate-900 dark:text-slate-100 font-medium text-center shadow-inner flex flex-col justify-center">
                                        <label className="block text-slate-500 dark:text-slate-400 text-sm font-semibold mb-1.5">إيميل الخادم</label>
                                        <div className="font-black text-slate-900 dark:text-white text-base tracking-normal text-center" dir="ltr">{(servant.servantCode || servant.code) ? `${servant.servantCode || servant.code}@church.com` : '-'}</div>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 text-slate-900 dark:text-slate-100 font-medium text-center shadow-inner flex flex-col justify-center">
                                        <label className="block text-slate-500 dark:text-slate-400 text-sm font-semibold mb-1.5">المسؤولية</label>
                                        <div className="font-bold text-blue-600 dark:text-blue-400">{servant.role || '-'}</div>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 text-slate-900 dark:text-slate-100 font-medium text-center shadow-inner flex flex-col justify-center">
                                         <label className="block text-slate-500 dark:text-slate-400 text-sm font-semibold mb-1.5">مسئولية الخدمة</label>
                                        <div className="font-bold text-slate-700 dark:text-slate-300 break-words">{renderedServiceResponsibility}</div>
                                    </div>
                                </div>
                            </div>

                            {/* My Weekly Self-Follow-up Card */}
                            <div className="bg-white dark:bg-[#1e293b] p-8 rounded-2xl shadow-md border border-slate-200 dark:border-slate-800">
                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 rounded-lg">
                                            <MapPin size={24} />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black text-slate-900 dark:text-white">انا رايح فين ؟  </h3>
                                            <p className="text-slate-505 dark:text-slate-400 text-xs font-bold mt-0.5">تسجيل التقييم الذاتي الأسبوعي لخدمتك</p>
                                        </div>
                                    </div>
                                    
                                    <select
                                        value={selectedWeekKey}
                                        onChange={(e) => setSelectedWeekKey(e.target.value)}
                                        className="p-2 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors text-sm"
                                    >
                                        {weeksList.map(w => (
                                            <option key={w.key} value={w.key}>{w.label}</option>
                                        ))}
                                    </select>
                                </div>

                                {!isActive ? (
                                    <div className="bg-blue-50 dark:bg-blue-955/20 border border-blue-200 dark:border-blue-900/40 p-5 rounded-2xl text-blue-800 dark:text-blue-400 text-sm font-bold flex items-center gap-2 mb-6">
                                        <span>ℹ️</span>
                                        <span>هذا الأسبوع يسبق تاريخ انضمامك الفعلي للخدمة، ولذلك لا يدخل ضمن متابعتك الأسبوعية.</span>
                                    </div>
                                ) : (
                                    <>
                                        {selectedWeekKey === weeksList[0].key ? (
                                            !(new Date().getDay() === 5) && (
                                                <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-4 rounded-xl mb-6 text-amber-800 dark:text-amber-400 text-sm font-bold flex items-center gap-2">
                                                    <span>⚠️</span>
                                                    <span>تنبيه: تسجيل حضور الخدمة والقداس والاجتماع متاح فقط يوم الجمعة. يمكنك تحديد خانة التحضير في أي وقت.</span>
                                                </div>
                                            )
                                        ) : (
                                            <div className="bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 p-4 rounded-xl mb-6 text-slate-500 dark:text-slate-400 text-sm font-bold flex items-center gap-2">
                                                <span>ℹ️</span>
                                                <span>أنت تستعرض أسبوعاً سابقاً. لا يمكن تعديل البيانات للأسابيع الماضية.</span>
                                            </div>
                                        )}

                                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                                    {/* 1. حضور الخدمة */}
                                    <label className={`flex items-center gap-3 p-4 rounded-xl border transition-all cursor-pointer select-none ${
                                        servant.weeklyFollowUp?.[selectedWeekKey]?.attendanceService
                                        ? 'bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-400'
                                        : 'bg-slate-50 border-slate-200 dark:bg-[#0f172a]/60 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                                    } ${!(selectedWeekKey === weeksList[0].key && new Date().getDay() === 5) ? 'opacity-60 cursor-not-allowed' : 'hover:scale-[1.01]'}`}>
                                        <input 
                                            type="checkbox"
                                            checked={!!servant.weeklyFollowUp?.[selectedWeekKey]?.attendanceService}
                                            onChange={() => (selectedWeekKey === weeksList[0].key && new Date().getDay() === 5) && handleToggleWeeklyFollowUp(selectedWeekKey, 'attendanceService', !!servant.weeklyFollowUp?.[selectedWeekKey]?.attendanceService)}
                                            disabled={!(selectedWeekKey === weeksList[0].key && new Date().getDay() === 5)}
                                            className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-700 cursor-pointer disabled:cursor-not-allowed"
                                        />
                                        <span className="font-bold text-base">حضور الخدمة</span>
                                    </label>

                                    {/* 2. حضور القداس */}
                                    <label className={`flex items-center gap-3 p-4 rounded-xl border transition-all cursor-pointer select-none ${
                                        servant.weeklyFollowUp?.[selectedWeekKey]?.attendanceLiturgy
                                        ? 'bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-400'
                                        : 'bg-slate-50 border-slate-200 dark:bg-[#0f172a]/60 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                                    } ${!(selectedWeekKey === weeksList[0].key && new Date().getDay() === 5) ? 'opacity-60 cursor-not-allowed' : 'hover:scale-[1.01]'}`}>
                                        <input 
                                            type="checkbox"
                                            checked={!!servant.weeklyFollowUp?.[selectedWeekKey]?.attendanceLiturgy}
                                            onChange={() => (selectedWeekKey === weeksList[0].key && new Date().getDay() === 5) && handleToggleWeeklyFollowUp(selectedWeekKey, 'attendanceLiturgy', !!servant.weeklyFollowUp?.[selectedWeekKey]?.attendanceLiturgy)}
                                            disabled={!(selectedWeekKey === weeksList[0].key && new Date().getDay() === 5)}
                                            className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-700 cursor-pointer disabled:cursor-not-allowed"
                                        />
                                        <span className="font-bold text-base">حضور القداس</span>
                                    </label>

                                    {/* 3. حضور اجتماع الخدام */}
                                    <label className={`flex items-center gap-3 p-4 rounded-xl border transition-all cursor-pointer select-none ${
                                        servant.weeklyFollowUp?.[selectedWeekKey]?.attendanceMeeting
                                        ? 'bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-400'
                                        : 'bg-slate-50 border-slate-200 dark:bg-[#0f172a]/60 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                                    } ${!(selectedWeekKey === weeksList[0].key && new Date().getDay() === 5) ? 'opacity-60 cursor-not-allowed' : 'hover:scale-[1.01]'}`}>
                                        <input 
                                            type="checkbox"
                                            checked={!!servant.weeklyFollowUp?.[selectedWeekKey]?.attendanceMeeting}
                                            onChange={() => (selectedWeekKey === weeksList[0].key && new Date().getDay() === 5) && handleToggleWeeklyFollowUp(selectedWeekKey, 'attendanceMeeting', !!servant.weeklyFollowUp?.[selectedWeekKey]?.attendanceMeeting)}
                                            disabled={!(selectedWeekKey === weeksList[0].key && new Date().getDay() === 5)}
                                            className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-700 cursor-pointer disabled:cursor-not-allowed"
                                        />
                                        <span className="font-bold text-base">حضور اجتماع الخدام</span>
                                    </label>

                                    {/* 4. التحضير */}
                                    <label className={`flex items-center gap-3 p-4 rounded-xl border transition-all cursor-pointer select-none ${
                                        servant.weeklyFollowUp?.[selectedWeekKey]?.preparation
                                        ? 'bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-400'
                                        : 'bg-slate-50 border-slate-200 dark:bg-[#0f172a]/60 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                                    } ${!(selectedWeekKey === weeksList[0].key) ? 'opacity-60 cursor-not-allowed' : 'hover:scale-[1.01]'}`}>
                                        <input 
                                            type="checkbox"
                                            checked={!!servant.weeklyFollowUp?.[selectedWeekKey]?.preparation}
                                            onChange={() => (selectedWeekKey === weeksList[0].key) && handleToggleWeeklyFollowUp(selectedWeekKey, 'preparation', !!servant.weeklyFollowUp?.[selectedWeekKey]?.preparation)}
                                            disabled={!(selectedWeekKey === weeksList[0].key)}
                                            className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-700 cursor-pointer disabled:cursor-not-allowed"
                                        />
                                        <span className="font-bold text-base">التحضير للدرس</span>
                                    </label>
                                </div>
                            </>
                        )}
                    </div>

                            <div className="bg-white dark:bg-[#1e293b] p-8 rounded-2xl shadow-md border border-slate-200 dark:border-slate-800">
                                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
                                    <div className="p-2 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 rounded-lg"><Save size={24} /></div>
                                    <h3 className="text-xl font-black text-slate-900 dark:text-white">تحديث البيانات الشخصية للإتصال</h3>
                                </div>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                                    <div className="md:col-span-2">
                                        <label className="block text-slate-500 dark:text-slate-400 text-sm font-semibold mb-1.5">الاسم</label>
                                        <input 
                                            className="w-full py-3 px-4 bg-white dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-blue-500 rounded-xl font-bold" 
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            placeholder="اسم الخادم رباعي"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-slate-500 dark:text-slate-400 text-sm font-semibold mb-1.5">رقم التليفون / الواتساب</label>
                                        <input 
                                            className="w-full py-3 px-4 bg-white dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-blue-500 rounded-xl font-bold text-left" 
                                            dir="ltr"
                                            value={formData.phone}
                                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                            placeholder="01XXXXXXXXX"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-slate-500 dark:text-slate-400 text-sm font-semibold mb-1.5">العنوان</label>
                                        <input 
                                            className="w-full py-3 px-4 bg-white dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-blue-500 rounded-xl font-bold" 
                                            value={formData.address}
                                            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                            placeholder="المنطقة، الشارع، العمارة..."
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-slate-500 dark:text-slate-400 text-sm font-semibold mb-1.5">تاريخ الميلاد</label>
                                        <input 
                                            type="date"
                                            className="w-full py-3 px-4 bg-white dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-blue-500 rounded-xl font-bold text-right" 
                                            value={formData.birthDate || ''}
                                            onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })}
                                        />
                                    </div>
                                </div>
                                
                                <button onClick={handleUpdateInfo} className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-4 rounded-xl font-bold hover:bg-blue-700 transition-colors">
                                    <Save size={20} /> حفظ البيانات
                                </button>
                            </div>

                            <div className="bg-white dark:bg-[#1e293b] p-8 rounded-2xl shadow-md border border-slate-200 dark:border-slate-800">
                                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
                                    <div className="p-2 bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 rounded-lg"><Lock size={24} /></div>
                                    <h3 className="text-xl font-black text-slate-900 dark:text-white">إعدادات الأمان</h3>
                                </div>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                                    <div>
                                        <label className="block text-slate-500 dark:text-slate-400 text-sm font-semibold mb-1.5">كلمة المرور الجديدة</label>
                                        <input 
                                            type="password"
                                            className="w-full py-3 px-4 bg-white dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-blue-500 rounded-xl font-bold" 
                                            value={newPassword}
                                            onChange={(e) => setNewPassword(e.target.value)}
                                            placeholder="أدخل كلمة مرور جديدة"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-slate-500 dark:text-slate-400 text-sm font-semibold mb-1.5">تأكيد كلمة المرور</label>
                                        <input 
                                            type="password"
                                            className="w-full py-3 px-4 bg-white dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-blue-500 rounded-xl font-bold" 
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            placeholder="أعد إدخال كلمة المرور"
                                        />
                                    </div>
                                </div>
                                
                                <button onClick={handleUpdatePassword} className="w-full flex items-center justify-center gap-2 bg-slate-800 dark:bg-slate-700 text-white py-4 rounded-xl font-bold hover:bg-slate-900 dark:hover:bg-slate-600 transition-colors">
                                    <Lock size={20} /> تغيير كلمة المرور
                                </button>
                            </div>
                        </div>
                    </>
            </div>
        </div>
    );
}
