import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, db, collection } from '../firebase';
import { Save, User, ArrowRight, Shield, BookOpen, Calendar, Check, ClipboardList, Activity } from 'lucide-react';
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

const normalizeArabic = (str) => {
    if (!str) return '';
    return str
        .replace(/[أإآا]/g, 'ا')
        .replace(/[ىي]/g, 'ي')
        .replace(/[ةه]/g, 'ه')
        .trim();
};

const getCleanCreatedAtTime = (s) => {
    try {
        if (!s || !s.createdAt) return 0;
        if (s.createdAt.toDate) {
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
    if (createdTime === 0) return true; // default active
    
    const parts = fridayStr.split('-');
    const friday = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    friday.setHours(23, 59, 59, 999);
    
    return createdTime <= friday.getTime();
};

const generateWeeks = () => {
    const weeks = [];
    const today = new Date();
    
    const currentFriday = new Date();
    const daysToFriday = (5 - today.getDay() + 7) % 7;
    currentFriday.setDate(today.getDate() + daysToFriday);
    
    const minFriday = new Date(2026, 5, 19); // Friday June 19, 2026
    minFriday.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < 52; i++) {
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

const getFridaysInMonth = (year, month) => {
    const fridays = [];
    const minFriday = new Date(2026, 5, 19); // Friday June 19, 2026
    minFriday.setHours(0, 0, 0, 0);
    
    const date = new Date(year, month - 1, 1);
    while (date.getDay() !== 5) {
        date.setDate(date.getDate() + 1);
    }
    
    while (date.getMonth() === month - 1) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const dStr = String(date.getDate()).padStart(2, '0');
        const fridayStr = `${y}-${m}-${dStr}`;
        
        const tempDate = new Date(date);
        tempDate.setHours(0, 0, 0, 0);
        
        if (tempDate.getTime() >= minFriday.getTime()) {
            fridays.push(fridayStr);
        }
        date.setDate(date.getDate() + 7);
    }
    return fridays;
};

export default function AdminServantProfile() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { isGeneralAdmin, isStageServant: isCurrentStageServant, servant: currentServant, authorizedClasses: currentAuthorizedClasses } = useAuth();
    const [servant, setServant] = useState(null);
    const [loading, setLoading] = useState(true);
    const [permissionError, setPermissionError] = useState('');
    const [formData, setFormData] = useState({
        role: '',
        assignedStage: '',
        assignedClass: '',
        managedClasses: [],
        myClasses: [],
        birthDate: ''
    });

    const weeksList = useMemo(() => generateWeeks(), []);
    const [reportType, setReportType] = useState('weekly');
    const [selectedWeekKey, setSelectedWeekKey] = useState('');
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [students, setStudents] = useState([]);
    const [studentsLoading, setStudentsLoading] = useState(true);

    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'students'), (snap) => {
            const list = [];
            snap.forEach(docSnap => {
                list.push({ id: docSnap.id, ...docSnap.data() });
            });
            setStudents(list);
            setStudentsLoading(false);
        }, (error) => {
            console.error("Error fetching students:", error);
            setStudentsLoading(false);
        });
        return unsub;
    }, []);

    // Set default selected week key
    useEffect(() => {
        if (weeksList.length > 0 && !selectedWeekKey) {
            setSelectedWeekKey(weeksList[0].key);
        }
    }, [weeksList, selectedWeekKey]);

    const currentFridaysOfMonth = useMemo(() => {
        return getFridaysInMonth(selectedYear, selectedMonth);
    }, [selectedYear, selectedMonth]);

    const activeFridays = useMemo(() => {
        return currentFridaysOfMonth.filter(fKey => isServantActiveInWeek(servant, fKey));
    }, [currentFridaysOfMonth, servant]);

    const monthlyStats = useMemo(() => {
        const fCount = activeFridays.length;
        if (fCount === 0) return { service: 0, liturgy: 0, meeting: 0, prep: 0, fCount: 0 };
        
        let service = 0;
        let liturgy = 0;
        let meeting = 0;
        let prep = 0;
        
        activeFridays.forEach(fKey => {
            const data = servant?.weeklyFollowUp?.[fKey] || {};
            if (data.attendanceService) service++;
            if (data.attendanceLiturgy) liturgy++;
            if (data.attendanceMeeting) meeting++;
            if (data.preparation) prep++;
        });
        
        return {
            service,
            liturgy,
            meeting,
            prep,
            fCount
        };
    }, [activeFridays, servant]);

    const visitationActivity = useMemo(() => {
        if (!servant) return { homeVisits: [], phoneVisits: [] };

        const homeVisits = [];
        const phoneVisits = [];

        if (reportType === 'weekly') {
            const selectedWeek = weeksList.find(w => w.key === selectedWeekKey);
            if (!selectedWeek) return { homeVisits: [], phoneVisits: [] };

            const startOfWeek = new Date(selectedWeek.saturdayDate);
            startOfWeek.setHours(0, 0, 0, 0);
            const endOfWeek = new Date(selectedWeek.fridayDate);
            endOfWeek.setHours(23, 59, 59, 999);

            students.forEach(st => {
                if (st.homeVisitations) {
                    Object.entries(st.homeVisitations).forEach(([monthKey, record]) => {
                        if (record.status === 'visited' || record.status === 'late_attended') {
                            const isByServant = record.servantId === servant.id || 
                                (Array.isArray(record.visitedByIds) && record.visitedByIds.includes(servant.id)) ||
                                (Array.isArray(record.visitedBy) && record.visitedBy.includes(servant.name)) ||
                                record.servantName === servant.name;
                            if (isByServant && record.timestamp) {
                                const t = new Date(record.timestamp).getTime();
                                if (t >= startOfWeek.getTime() && t <= endOfWeek.getTime()) {
                                    homeVisits.push({
                                        studentId: st.id,
                                        studentName: st.name,
                                        className: st.assignedClass || st.grade || '—',
                                        type: 'home',
                                        date: new Date(record.timestamp).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' }),
                                        status: record.status === 'visited' ? 'افتُقد' : 'افتقاد متأخر',
                                        note: record.note || ''
                                    });
                                }
                            }
                        }
                    });
                }

                if (st.phoneVisitations?.[selectedWeekKey]) {
                    const record = st.phoneVisitations[selectedWeekKey];
                    if (record.status === 'called' || record.status === 'late_attended') {
                        const isByServant = record.servantId === servant.id || record.servantName === servant.name;
                        if (isByServant) {
                            phoneVisits.push({
                                studentId: st.id,
                                studentName: st.name,
                                className: st.assignedClass || st.grade || '—',
                                type: 'phone',
                                date: record.timestamp ? new Date(record.timestamp).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' }) : '—',
                                status: record.status === 'called' ? 'مكالمة تليفونية' : 'مكالمة متأخرة',
                                note: record.note || ''
                            });
                        }
                    }
                }
            });
        } else {
            const monthKey = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;

            students.forEach(st => {
                if (st.homeVisitations?.[monthKey]) {
                    const record = st.homeVisitations[monthKey];
                    if (record.status === 'visited' || record.status === 'late_attended') {
                        const isByServant = record.servantId === servant.id || 
                            (Array.isArray(record.visitedByIds) && record.visitedByIds.includes(servant.id)) ||
                            (Array.isArray(record.visitedBy) && record.visitedBy.includes(servant.name)) ||
                            record.servantName === servant.name;
                        if (isByServant) {
                            homeVisits.push({
                                studentId: st.id,
                                studentName: st.name,
                                className: st.assignedClass || st.grade || '—',
                                type: 'home',
                                date: record.timestamp ? new Date(record.timestamp).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' }) : '—',
                                status: record.status === 'visited' ? 'افتُقد' : 'افتقاد متأخر',
                                note: record.note || ''
                            });
                        }
                    }
                }

                currentFridaysOfMonth.forEach(fKey => {
                    if (st.phoneVisitations?.[fKey]) {
                        const record = st.phoneVisitations[fKey];
                        if (record.status === 'called' || record.status === 'late_attended') {
                            const isByServant = record.servantId === servant.id || record.servantName === servant.name;
                            if (isByServant) {
                                phoneVisits.push({
                                    studentId: st.id,
                                    studentName: st.name,
                                    className: st.assignedClass || st.grade || '—',
                                    type: 'phone',
                                    date: record.timestamp ? new Date(record.timestamp).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' }) : '—',
                                    status: record.status === 'called' ? 'مكالمة تليفونية' : 'مكالمة متأخرة',
                                    note: record.note || '',
                                    weekKey: fKey
                                });
                            }
                        }
                    }
                });
            });
        }

        return { homeVisits, phoneVisits };
    }, [students, servant, reportType, selectedWeekKey, selectedMonth, selectedYear, currentFridaysOfMonth, weeksList]);

    const handleToggleWeeklyFollowUp = async (weekKey, field, currentValue) => {
        const updatedWeeklyFollowUp = {
            ...(servant.weeklyFollowUp || {}),
            [weekKey]: {
                ...(servant.weeklyFollowUp?.[weekKey] || {}),
                [field]: !currentValue
            }
        };

        try {
            await updateDoc(doc(db, 'servants', id), {
                weeklyFollowUp: updatedWeeklyFollowUp
            });
        } catch (error) {
            console.error("Error updating weekly follow-up:", error);
            alert('حدث خطأ أثناء تحديث المتابعة');
        }
    };

    useEffect(() => {
        if (!currentServant) return;

        const unsub = onSnapshot(doc(db, 'servants', id), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();

                const rawStage = data.assignedStage || data.grade || '';
                const normStage = normalizeArabic(rawStage);
                const matchedStage = Object.keys(STAGE_CLASS_MAP).find(
                    key => normalizeArabic(key) === normStage
                ) || '';

                // If they are a stage admin, enforce that the loaded servant belongs to their stage
                if (!isGeneralAdmin && isCurrentStageServant) {
                    const myStageNorm = normalizeArabic(currentServant.assignedStage || currentServant.grade || '');
                    if (normalizeArabic(matchedStage) !== myStageNorm) {
                        setPermissionError('غير مسموح لك بتعديل صلاحيات خادم من خارج مرحلتك الدراسية.');
                        setLoading(false);
                        return;
                    }
                }

                setServant({ id: docSnap.id, ...data });

                const rawClass = data.assignedClass || data.assignment || '';
                const rawManagedClasses = data.managedClasses || [];
                const rawMyClasses = data.myClasses || [];

                let matchedClass = '';
                if (matchedStage) {
                    const normClass = normalizeArabic(rawClass);
                    matchedClass = (STAGE_CLASS_MAP[matchedStage] || []).find(
                        cls => normalizeArabic(cls) === normClass
                    ) || '';
                }

                let matchedManagedClasses = [];
                if (matchedStage && Array.isArray(rawManagedClasses)) {
                    matchedManagedClasses = rawManagedClasses.map(rc => {
                        const normRc = normalizeArabic(rc);
                        return (STAGE_CLASS_MAP[matchedStage] || []).find(
                            cls => normalizeArabic(cls) === normRc
                        ) || '';
                    }).filter(Boolean);
                }

                let matchedMyClasses = [];
                if (matchedStage && Array.isArray(data.myClasses) && data.myClasses.length > 0) {
                    matchedMyClasses = data.myClasses.map(rc => {
                        const normRc = normalizeArabic(rc);
                        return (STAGE_CLASS_MAP[matchedStage] || []).find(
                            cls => normalizeArabic(cls) === normRc
                        ) || '';
                    }).filter(Boolean);
                } else if (matchedStage && matchedClass) {
                    matchedMyClasses = [matchedClass];
                }

                // Strictly map raw role to either 'امين فصل' or 'امين مرحله'
                const rawRole = data.role || '';
                const normRole = normalizeArabic(rawRole);
                const matchedRole = normRole.includes('مرحله') ? 'امين مرحله' : 'امين فصل';

                setFormData({
                    role: matchedRole,
                    assignedStage: matchedStage,
                    assignedClass: matchedClass,
                    managedClasses: matchedManagedClasses,
                    myClasses: matchedMyClasses,
                    birthDate: data.birthDate || ''
                });
            } else {
                alert('الخادم غير موجود');
                navigate('/admin/servants');
            }
            setLoading(false);
        }, (error) => {
            console.error("Error fetching servant:", error);
            setLoading(false);
        });

        return () => unsub();
    }, [id, navigate, isGeneralAdmin, isCurrentStageServant, currentServant]);

    const handleRoleChange = (newRole) => {
        setFormData(prev => ({
            ...prev,
            role: newRole,
            assignedStage: '',
            assignedClass: '',
            managedClasses: [],
            myClasses: []
        }));
    };

    const handleStageChange = (newStage) => {
        setFormData(prev => ({
            ...prev,
            assignedStage: newStage,
            assignedClass: '',
            managedClasses: [],
            myClasses: []
        }));
    };

    const handleCheckboxToggle = (className) => {
        setFormData(prev => {
            const currentList = prev.managedClasses || [];
            const newList = currentList.includes(className)
                ? currentList.filter(item => item !== className)
                : [...currentList, className];
            return {
                ...prev,
                managedClasses: newList
            };
        });
    };

    const handleMyClassToggle = (className) => {
      setFormData(prev => {
        const currentClasses = prev.myClasses || [];
        const updatedClasses = currentClasses.includes(className)
          ? currentClasses.filter(c => c !== className)
          : [...currentClasses, className];
        return { ...prev, myClasses: updatedClasses };
      });
    };

    const handleUpdate = async () => {
        try {
            const updates = {
                birthDate: formData.birthDate || ''
            };

            if (isGeneralAdmin) {
                updates.role = formData.role;
                updates.assignedStage = formData.assignedStage;
                updates.grade = formData.assignedStage;

                if (formData.role === 'امين مرحله') {
                    updates.managedClasses = formData.managedClasses || [];
                    updates.assignedClass = '';
                    updates.assignment = '';
                    updates.myClasses = [];
                } else {
                    updates.myClasses = formData.myClasses || [];
                    updates.assignedClass = formData.myClasses?.[0] || '';
                    updates.assignment = formData.myClasses?.[0] || '';
                    updates.managedClasses = [];
                }
            } else {
                // Stage admin: filter to only allow classes within their own authority
                const allowed = currentAuthorizedClasses || [];
                if (servant.role === 'امين مرحله') {
                    updates.managedClasses = (formData.managedClasses || []).filter(cls => allowed.includes(cls));
                } else {
                    const filteredClasses = (formData.myClasses || []).filter(cls => allowed.includes(cls));
                    updates.myClasses = filteredClasses;
                    updates.assignedClass = filteredClasses[0] || '';
                    updates.assignment = filteredClasses[0] || '';
                }
            }

            await updateDoc(doc(db, 'servants', id), updates);
            alert('تم تحديث بيانات الخادم بنجاح 🌟');
        } catch (error) {
            console.error("Error updating servant:", error);
            alert('حدث خطأ أثناء التحديث');
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

    if (permissionError) {
        return (
            <div className="py-20 text-center space-y-4 max-w-md mx-auto">
                <Shield size={64} className="text-rose-500 mx-auto animate-bounce" />
                <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100">خطأ في الصلاحيات</h2>
                <p className="text-slate-500 dark:text-slate-400 font-bold">{permissionError}</p>
                <button onClick={() => navigate(-1)} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow cursor-pointer border-none mt-4">
                    الرجوع للخلف
                </button>
            </div>
        );
    }

    if (!servant) return null;

    const nameStr = typeof servant.name === 'object' ? servant.name.name : servant.name;

    const isClassServant = formData.role === 'امين فصل';
    const isStageServant = formData.role === 'امين مرحله';

    const showStage = isClassServant || isStageServant;
    const showClass = isClassServant;

    return (
        <div className="max-w-4xl mx-auto px-4 py-8" dir="rtl">
            <Link to="/admin/servants" className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 mb-8 font-bold transition-colors">
                <ArrowRight size={20} />
                العودة لقائمة الخدام
            </Link>

            <header className="mb-10">
                <h1 className="text-3xl font-black text-slate-900 dark:text-white mb-2">{nameStr} - {servant.code || servant.servantCode}</h1>
                <p className="text-slate-500 dark:text-slate-400 text-base font-medium">تعديل صلاحيات ومسؤوليات الخادم</p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="p-6 bg-white dark:bg-[#1e293b] rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex items-center gap-4 text-slate-800 dark:text-slate-200">
                    <div className="bg-blue-100 dark:bg-blue-900/30 p-3 rounded-lg text-blue-600 dark:text-blue-400">
                        <User size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-slate-400 dark:text-slate-500 mb-1">التليفون</p>
                        <p className="font-black text-slate-750 dark:text-slate-200" dir="ltr">{servant.phone || '—'}</p>
                    </div>
                </div>

                <div className="p-6 bg-white dark:bg-[#1e293b] rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex items-center gap-4 text-slate-800 dark:text-slate-200">
                    <div className="bg-rose-100 dark:bg-rose-900/30 p-3 rounded-lg text-rose-600 dark:text-rose-400">
                        <Calendar size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-slate-400 dark:text-slate-500 mb-1">تاريخ الميلاد</p>
                        <p className="font-black text-slate-750 dark:text-slate-200" dir="ltr">{servant.birthDate || '—'}</p>
                    </div>
                </div>

                <div className="p-6 bg-white dark:bg-[#1e293b] rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex items-center gap-4 text-slate-800 dark:text-slate-200">
                    <div className="bg-amber-100 dark:bg-amber-900/30 p-3 rounded-lg text-amber-600 dark:text-amber-400">
                        <BookOpen size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-slate-400 dark:text-slate-500 mb-1">العنوان</p>
                        <p className="font-black text-slate-750 dark:text-slate-200">{servant.address || '—'}</p>
                    </div>
                </div>
            </div>

            <div className="bg-white dark:bg-[#1e293b] p-8 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-slate-900 dark:text-white">
                    <Shield size={20} className="text-blue-600 dark:text-blue-400" />
                    تعديل الصلاحيات والمرحلة
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    <div className="space-y-2">
                        <label className="text-slate-500 dark:text-slate-300 font-semibold text-sm mb-1.5 block">المسؤولية</label>
                        <select
                            disabled={!isGeneralAdmin}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-blue-500 rounded-xl font-bold outline-none disabled:opacity-75 disabled:cursor-not-allowed"
                            value={formData.role}
                            onChange={e => handleRoleChange(e.target.value)}
                        >
                            <option value="امين فصل">امين فصل</option>
                            <option value="امين مرحله">امين مرحله</option>
                        </select>
                        {!isGeneralAdmin && (
                            <p className="text-[11px] text-amber-650 dark:text-amber-400 font-bold mt-1">⚠️ يمكن تعديل هذا الحقل من خلال الأمين العام فقط</p>
                        )}
                    </div>

                    {showStage && (
                        <div className="space-y-2">
                            <label className="text-slate-500 dark:text-slate-300 font-semibold text-sm mb-1.5 block">المرحلة الدراسية</label>
                            <select
                                disabled={!isGeneralAdmin}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-blue-500 rounded-xl font-bold outline-none disabled:opacity-75 disabled:cursor-not-allowed"
                                value={formData.assignedStage}
                                onChange={e => handleStageChange(e.target.value)}
                            >
                                <option value="">اختر المرحلة</option>
                                {Object.keys(STAGE_CLASS_MAP).map(stage => (
                                    <option key={stage} value={stage}>{stage}</option>
                                ))}
                            </select>
                            {!isGeneralAdmin && (
                                <p className="text-[11px] text-amber-655 dark:text-amber-400 font-bold mt-1">⚠️ يمكن تعديل هذا الحقل من خلال الأمين العام فقط</p>
                            )}
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-slate-500 dark:text-slate-300 font-semibold text-sm mb-1.5 block">تاريخ الميلاد</label>
                        <input
                            type="date"
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-blue-500 rounded-xl font-bold outline-none text-right"
                            value={formData.birthDate || ''}
                            onChange={e => setFormData(prev => ({ ...prev, birthDate: e.target.value }))}
                        />
                    </div>

                    {isClassServant && (
                        <div className="space-y-3 md:col-span-2">
                            <label className="text-slate-500 dark:text-slate-300 font-semibold text-sm mb-1.5 block">الفصول المسؤول عنها</label>
                            {formData.assignedStage ? (
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    {(STAGE_CLASS_MAP[formData.assignedStage] || []).filter(cls => 
                                        isGeneralAdmin || (currentAuthorizedClasses || []).includes(cls)
                                    ).map(cls => {
                                        const isChecked = (formData.myClasses || []).includes(cls);
                                        return (
                                            <label
                                                key={cls}
                                                className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded-xl cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors font-bold text-slate-800 dark:text-slate-200"
                                            >
                                                <input
                                                    type="checkbox"
                                                    className="accent-blue-600 rounded w-5 h-5 cursor-pointer"
                                                    checked={isChecked}
                                                    onChange={() => handleMyClassToggle(cls)}
                                                />
                                                <span>{cls}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="p-4 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-400 dark:text-slate-500 text-center">
                                    برجاء اختيار المرحلة أولاً لعرض الفصول
                                </div>
                            )}
                        </div>
                    )}

                    {isStageServant && (
                        <div className="space-y-3 md:col-span-2">
                            <label className="text-slate-500 dark:text-slate-300 font-semibold text-sm mb-1.5 block">الفصول المسؤول عنها </label>
                            {formData.assignedStage ? (
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    {(STAGE_CLASS_MAP[formData.assignedStage] || []).filter(cls => 
                                        isGeneralAdmin || (currentAuthorizedClasses || []).includes(cls)
                                    ).map(cls => {
                                        const isChecked = (formData.managedClasses || []).includes(cls);
                                        return (
                                            <label
                                                key={cls}
                                                className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded-xl cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors font-bold text-slate-800 dark:text-slate-200"
                                            >
                                                <input
                                                    type="checkbox"
                                                    className="accent-blue-600 rounded w-5 h-5 cursor-pointer"
                                                    checked={isChecked}
                                                    onChange={() => handleCheckboxToggle(cls)}
                                                />
                                                <span>{cls}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="p-4 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-400 dark:text-slate-500 text-center">
                                    برجاء اختيار المرحلة أولاً لعرض الفصول
                                </div>
                            )}
                        </div>
                    )}
                    
                    {/* Servant Follow-up Dashboard */}
                    <div className="md:col-span-2 border-t border-slate-100 dark:border-slate-800 pt-8 mt-6">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-lg">
                                    <ClipboardList size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-black text-slate-900 dark:text-white">سجل متابعة الخادم الأسبوعية والشهرية</h3>
                                    <p className="text-slate-500 dark:text-slate-400 text-xs font-bold mt-0.5">استعراض وتعديل حضور وتقييم الخادم الذاتي</p>
                                </div>
                            </div>

                            <div className="flex bg-slate-100 dark:bg-slate-900 p-1.5 rounded-xl border border-slate-200 dark:border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setReportType('weekly')}
                                    className={`px-4 py-2 rounded-lg font-black text-sm transition-all cursor-pointer border-0 ${
                                        reportType === 'weekly'
                                        ? 'bg-white dark:bg-[#1e293b] text-blue-600 dark:text-blue-400 shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                                    }`}
                                >
                                    تقرير أسبوعي
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setReportType('monthly')}
                                    className={`px-4 py-2 rounded-lg font-black text-sm transition-all cursor-pointer border-0 ${
                                        reportType === 'monthly'
                                        ? 'bg-white dark:bg-[#1e293b] text-blue-600 dark:text-blue-400 shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                                    }`}
                                >
                                    تقرير شهري
                                </button>
                            </div>
                        </div>

                        {/* Filters and Controls */}
                        <div className="flex justify-end mb-6">
                            {reportType === 'weekly' ? (
                                <div className="flex gap-2 items-center w-full sm:w-auto">
                                    <span className="font-bold text-slate-600 dark:text-slate-400 shrink-0 text-sm">الأسبوع:</span>
                                    <select
                                        value={selectedWeekKey}
                                        onChange={e => setSelectedWeekKey(e.target.value)}
                                        className="w-full sm:w-auto p-2.5 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer text-sm"
                                    >
                                        {weeksList.map(w => (
                                            <option key={w.key} value={w.key}>{w.label}</option>
                                        ))}
                                    </select>
                                </div>
                            ) : (
                                <div className="flex gap-2 items-center w-full sm:w-auto flex-wrap">
                                    <span className="font-bold text-slate-600 dark:text-slate-400 shrink-0 text-sm">الشهر:</span>
                                    <select
                                        value={selectedMonth}
                                        onChange={e => setSelectedMonth(Number(e.target.value))}
                                        className="p-2.5 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer text-sm"
                                    >
                                        {Array.from({ length: 12 }, (_, idx) => (
                                            <option key={idx + 1} value={idx + 1}>
                                                {new Date(0, idx).toLocaleDateString('ar-EG', { month: 'long' })}
                                            </option>
                                        ))}
                                    </select>

                                    <select
                                        value={selectedYear}
                                        onChange={e => setSelectedYear(Number(e.target.value))}
                                        className="p-2.5 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer text-sm"
                                    >
                                        {[2025, 2026, 2027].map(year => (
                                            <option key={year} value={year}>{year}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>

                        {/* Status Display */}
                        {reportType === 'weekly' ? (
                            (() => {
                                const fData = servant?.weeklyFollowUp?.[selectedWeekKey] || {};
                                const isWeekActive = isServantActiveInWeek(servant, selectedWeekKey);
                                
                                if (!isWeekActive) {
                                    return (
                                        <div className="bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl text-slate-500 dark:text-slate-400 text-sm font-bold flex items-center gap-2 mb-6">
                                            <span>ℹ️</span>
                                            <span>هذا الأسبوع يسبق تاريخ انضمام الخادم الفعلي، ولذلك لا يدخل ضمن متابعته الأسبوعية.</span>
                                        </div>
                                    );
                                }

                                return (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                                        {/* 1. حضور الخدمة */}
                                        <div className="flex flex-col gap-2 p-4 bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-2xl items-center text-center">
                                            <span className="text-slate-500 dark:text-slate-300 font-bold text-sm">حضور الخدمة</span>
                                            <button
                                                type="button"
                                                onClick={() => handleToggleWeeklyFollowUp(selectedWeekKey, 'attendanceService', !!fData.attendanceService)}
                                                className={`mt-2 inline-flex items-center justify-center px-4 py-2 rounded-xl font-black text-sm transition-all cursor-pointer border-0 ${
                                                    fData.attendanceService
                                                    ? 'bg-emerald-100 hover:bg-rose-100 text-emerald-600 hover:text-rose-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                                                    : 'bg-slate-200 hover:bg-emerald-50 text-slate-400 hover:text-emerald-500 dark:bg-slate-800 dark:text-slate-550'
                                                }`}
                                            >
                                                {fData.attendanceService ? '✅ حضر' : '❌ غياب / لم يسجل'}
                                            </button>
                                        </div>

                                        {/* 2. حضور القداس */}
                                        <div className="flex flex-col gap-2 p-4 bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-2xl items-center text-center">
                                            <span className="text-slate-500 dark:text-slate-300 font-bold text-sm">حضور القداس</span>
                                            <button
                                                type="button"
                                                onClick={() => handleToggleWeeklyFollowUp(selectedWeekKey, 'attendanceLiturgy', !!fData.attendanceLiturgy)}
                                                className={`mt-2 inline-flex items-center justify-center px-4 py-2 rounded-xl font-black text-sm transition-all cursor-pointer border-0 ${
                                                    fData.attendanceLiturgy
                                                    ? 'bg-emerald-100 hover:bg-rose-100 text-emerald-600 hover:text-rose-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                                                    : 'bg-slate-200 hover:bg-emerald-50 text-slate-400 hover:text-emerald-500 dark:bg-slate-800 dark:text-slate-550'
                                                }`}
                                            >
                                                {fData.attendanceLiturgy ? '✅ حضر' : '❌ غياب / لم يسجل'}
                                            </button>
                                        </div>

                                        {/* 3. حضور اجتماع الخدام */}
                                        <div className="flex flex-col gap-2 p-4 bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-2xl items-center text-center">
                                            <span className="text-slate-500 dark:text-slate-300 font-bold text-sm">حضور اجتماع الخدام</span>
                                            <button
                                                type="button"
                                                onClick={() => handleToggleWeeklyFollowUp(selectedWeekKey, 'attendanceMeeting', !!fData.attendanceMeeting)}
                                                className={`mt-2 inline-flex items-center justify-center px-4 py-2 rounded-xl font-black text-sm transition-all cursor-pointer border-0 ${
                                                    fData.attendanceMeeting
                                                    ? 'bg-emerald-100 hover:bg-rose-100 text-emerald-600 hover:text-rose-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                                                    : 'bg-slate-200 hover:bg-emerald-50 text-slate-400 hover:text-emerald-500 dark:bg-slate-800 dark:text-slate-550'
                                                }`}
                                            >
                                                {fData.attendanceMeeting ? '✅ حضر' : '❌ غياب / لم يسجل'}
                                            </button>
                                        </div>

                                        {/* 4. التحضير للدرس */}
                                        <div className="flex flex-col gap-2 p-4 bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-2xl items-center text-center">
                                            <span className="text-slate-500 dark:text-slate-300 font-bold text-sm">التحضير للدرس</span>
                                            <button
                                                type="button"
                                                onClick={() => handleToggleWeeklyFollowUp(selectedWeekKey, 'preparation', !!fData.preparation)}
                                                className={`mt-2 inline-flex items-center justify-center px-4 py-2 rounded-xl font-black text-sm transition-all cursor-pointer border-0 ${
                                                    fData.preparation
                                                    ? 'bg-emerald-100 hover:bg-rose-100 text-emerald-600 hover:text-rose-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                                                    : 'bg-slate-200 hover:bg-emerald-50 text-slate-400 hover:text-emerald-500 dark:bg-slate-800 dark:text-slate-550'
                                                }`}
                                            >
                                                {fData.preparation ? '✅ حضر' : '❌ غياب / لم يسجل'}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })()
                        ) : (
                            (() => {
                                if (monthlyStats.fCount === 0) {
                                    return (
                                        <div className="bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl text-slate-500 dark:text-slate-400 text-sm font-bold flex items-center gap-2 mb-6">
                                            <span>ℹ️</span>
                                            <span>لا توجد أسابيع نشطة للخادم في هذا الشهر.</span>
                                        </div>
                                    );
                                }

                                const statsList = [
                                    { label: 'حضور الخدمة', value: monthlyStats.service, color: 'from-blue-500 to-indigo-650' },
                                    { label: 'حضور القداس', value: monthlyStats.liturgy, color: 'from-emerald-500 to-teal-650' },
                                    { label: 'حضور اجتماع الخدام', value: monthlyStats.meeting, color: 'from-purple-500 to-violet-650' },
                                    { label: 'التحضير للدرس', value: monthlyStats.prep, color: 'from-amber-500 to-orange-655' }
                                ];

                                return (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                                        {statsList.map(st => {
                                            const pct = Math.round((st.value / monthlyStats.fCount) * 100);
                                            return (
                                                <div key={st.label} className="bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
                                                    <span className="text-slate-800 dark:text-white font-bold text-sm mb-2 block">{st.label}</span>
                                                    <div className="flex items-baseline gap-2 mb-3">
                                                        <span className="text-xl font-black text-slate-800 dark:text-slate-200">{pct}%</span>
                                                        <span className="text-base font-extrabold text-slate-800 dark:text-white">({st.value} من {monthlyStats.fCount})</span>
                                                    </div>
                                                    <div className="w-full bg-slate-200 dark:bg-slate-850 h-2 rounded-full overflow-hidden">
                                                        <div className={`bg-gradient-to-r ${st.color} h-full rounded-full transition-all duration-500`} style={{ width: `${pct}%` }}></div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })()
                        )}

                        {/* New Visitation Section */}
                        <div className="mt-8 border-t border-slate-100 dark:border-slate-800 pt-6">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="p-2 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 rounded-lg">
                                    <Activity size={24} />
                                </div>
                                <div>
                                    <h4 className="text-lg font-black text-slate-900 dark:text-white">نشاط الافتقاد للخادم</h4>
                                    <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold mt-0.5">
                                        {reportType === 'weekly' ? 'إجمالي ومتابعة الافتقاد خلال هذا الأسبوع' : 'إجمالي ومتابعة الافتقاد خلال هذا الشهر'}
                                    </p>
                                </div>
                            </div>

                            {/* Summary Cards */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                                <div className="bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between relative overflow-hidden">
                                    <div>
                                        <span className="text-slate-550 dark:text-slate-400 font-bold text-sm block mb-1">الافتقاد المنزلي</span>
                                        <h5 className="text-2xl font-black text-slate-850 dark:text-white">
                                            {visitationActivity.homeVisits.length} {visitationActivity.homeVisits.length === 1 ? 'زيارة' : visitationActivity.homeVisits.length === 2 ? 'زيارتان' : visitationActivity.homeVisits.length >= 3 && visitationActivity.homeVisits.length <= 10 ? 'زيارات' : 'زيارة'}
                                        </h5>
                                    </div>
                                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-600"></div>
                                </div>

                                <div className="bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col justify-between relative overflow-hidden">
                                    <div>
                                        <span className="text-slate-550 dark:text-slate-400 font-bold text-sm block mb-1">الافتقاد التلفوني</span>
                                        <h5 className="text-2xl font-black text-slate-850 dark:text-white">
                                            {visitationActivity.phoneVisits.length} {visitationActivity.phoneVisits.length === 1 ? 'مكالمة' : visitationActivity.phoneVisits.length === 2 ? 'مكالمتان' : visitationActivity.phoneVisits.length >= 3 && visitationActivity.phoneVisits.length <= 10 ? 'مكالمات' : 'مكالمة'}
                                        </h5>
                                    </div>
                                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-600"></div>
                                </div>
                            </div>

                            {/* Detailed Log Table */}
                            <div className="bg-white dark:bg-[#1e293b] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                                <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800">
                                    <h5 className="font-bold text-slate-800 dark:text-white text-sm">سجل تفاصيل الافتقاد</h5>
                                </div>
                                
                                {studentsLoading ? (
                                    <div className="p-6 text-center text-slate-400 font-bold text-sm">جاري تحميل بيانات الافتقاد...</div>
                                ) : (visitationActivity.homeVisits.length === 0 && visitationActivity.phoneVisits.length === 0) ? (
                                    <div className="p-6 text-center text-slate-400 font-bold text-sm">لا توجد افتقادات مسجلة باسم هذا الخادم في هذه الفترة.</div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-right border-collapse text-sm">
                                            <thead>
                                                <tr className="bg-slate-100/50 dark:bg-slate-900/40 text-slate-700 dark:text-white text-xs font-black uppercase tracking-wider">
                                                    <th className="py-3 px-4 border-b border-slate-200 dark:border-slate-800">المخدوم</th>
                                                    <th className="py-3 px-4 border-b border-slate-200 dark:border-slate-800">الفصل</th>
                                                    <th className="py-3 px-4 border-b border-slate-200 dark:border-slate-800 text-center">النوع</th>
                                                    <th className="py-3 px-4 border-b border-slate-200 dark:border-slate-800 text-center">التاريخ</th>
                                                    <th className="py-3 px-4 border-b border-slate-200 dark:border-slate-800">تفاصيل / ملاحظات</th>
                                                </tr>
                                            </thead>
                                            <tbody className="text-slate-600 dark:text-slate-300">
                                                {[...visitationActivity.homeVisits, ...visitationActivity.phoneVisits].map((v, index) => (
                                                    <tr key={index} className="border-b border-slate-50 dark:border-slate-800/80 hover:bg-blue-50/20 dark:hover:bg-blue-900/10 transition-colors">
                                                        <td className="py-3.5 px-4 font-black">
                                                            <Link to={`/admin/student/${v.studentId}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                                                                {v.studentName}
                                                            </Link>
                                                        </td>
                                                        <td className="py-3.5 px-4 font-bold">{v.className}</td>
                                                        <td className="py-3.5 px-4 text-center">
                                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black ${
                                                                v.type === 'home' 
                                                                ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400' 
                                                                : 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                                                            }`}>
                                                                {v.type === 'home' ? '🏠 زيارة منزلية' : '📞 مكالمة تلفونية'}
                                                            </span>
                                                        </td>
                                                        <td className="py-3.5 px-4 text-center font-bold">{v.date}</td>
                                                        <td className="py-3.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 max-w-xs truncate" title={v.note}>
                                                            {v.note || <span className="text-slate-300 dark:text-slate-700 italic">لا توجد ملاحظات</span>}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <button 
                    onClick={handleUpdate} 
                    className="w-full bg-blue-600 dark:bg-blue-500 text-white py-4 rounded-xl font-black shadow-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-all flex items-center justify-center gap-2 text-lg"
                >
                    <Save size={24} />
                    حفظ التعديلات
                </button>
            </div>
        </div>
    );
}
