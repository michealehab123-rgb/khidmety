import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { db, doc, collection, onSnapshot, updateDoc, setDoc, getDocs, writeBatch, query, where } from '../firebase';
import { Gift, Flame, ArrowLeft, Users, Cake, CalendarDays, RotateCcw, Check, FileSpreadsheet, RefreshCcw } from 'lucide-react';
import { exportToExcelGeneric } from '../utils/excelExport';

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

export default function AdminGifts() {
    const { servant, isGeneralAdmin, isServant, authorizedClasses } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const roleNorm = servant?.role ? normalizeArabic(servant.role) : '';
    const isStageServant = roleNorm.includes('مرحله');
    const isClassServant = isServant && !isStageServant;

    const [selectedStage, setSelectedStage] = useState('');
    const [selectedClass, setSelectedClass] = useState('');
    const [students, setStudents] = useState([]);
    const [attendanceConfigs, setAttendanceConfigs] = useState({});
    const [loading, setLoading] = useState(true);
    const [isResettingStreaks, setIsResettingStreaks] = useState(false);

    const prefilledStage = location.state?.prefilledStage || '';
    const prefilledClass = location.state?.prefilledClass || '';

    // Tab state: 'four_weeks' or 'birthdays'
    const [activeTab, setActiveTab] = useState(location.state?.activeTab || 'four_weeks');

    // Birthday tracking states
    const today = new Date();
    const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
    const [selectedYear, setSelectedYear] = useState(today.getFullYear() >= 2026 ? today.getFullYear() : 2026);

    const allowedStages = useMemo(() => {
        if (isGeneralAdmin) return Object.keys(STAGE_CLASS_MAP);
        if (!servant) return [];
        const myStage = servant.assignedStage || servant.grade || '';
        const stageNorm = myStage ? (myStage.includes('ابتدائي') || myStage.includes('ابتدائى') ? 'ابتدائي' : myStage.includes('اعدادي') || myStage.includes('اعدادى') ? 'اعدادي' : myStage.includes('ثانوي') || myStage.includes('ثانوى') ? 'ثانوي' : '') : '';
        return stageNorm ? [stageNorm] : Object.keys(STAGE_CLASS_MAP);
    }, [isGeneralAdmin, servant]);

    const allowedClasses = useMemo(() => {
        if (isGeneralAdmin) {
            return selectedStage ? (STAGE_CLASS_MAP[selectedStage] || []) : [];
        }
        if (!servant) return [];
        const classesForStage = selectedStage ? (STAGE_CLASS_MAP[selectedStage] || []) : [];
        return authorizedClasses.filter(cls => classesForStage.includes(cls));
    }, [isGeneralAdmin, servant, selectedStage, authorizedClasses]);

    const MONTHS = [
        { value: 1, label: 'يناير (1)' },
        { value: 2, label: 'فبراير (2)' },
        { value: 3, label: 'مارس (3)' },
        { value: 4, label: 'أبريل (4)' },
        { value: 5, label: 'مايو (5)' },
        { value: 6, label: 'يونيو (6)' },
        { value: 7, label: 'يوليو (7)' },
        { value: 8, label: 'أغسطس (8)' },
        { value: 9, label: 'سبتمبر (9)' },
        { value: 10, label: 'أكتوبر (10)' },
        { value: 11, label: 'نوفمبر (11)' },
        { value: 12, label: 'ديسمبر (12)' }
    ];

    const yearsList = useMemo(() => {
        const startYear = 2026;
        const endYear = Math.max(startYear, new Date().getFullYear()) + 4;
        const years = [];
        for (let y = startYear; y <= endYear; y++) {
            years.push(y);
        }
        return years;
    }, []);

    // Handle initial state setup
    useEffect(() => {
        if (isGeneralAdmin) {
            setSelectedStage(prefilledStage || 'ابتدائي');
            setSelectedClass(prefilledClass || '');
        } else if (isServant && servant) {
            const myStage = servant.assignedStage || servant.grade || '';
            const stageNorm = myStage ? (myStage.includes('ابتدائي') || myStage.includes('ابتدائى') ? 'ابتدائي' : myStage.includes('اعدادي') || myStage.includes('اعدادى') ? 'اعدادي' : myStage.includes('ثانوي') || myStage.includes('ثانوى') ? 'ثانوي' : '') : '';
            setSelectedStage(stageNorm || 'ابتدائي');

            if (isClassServant) {
                if (prefilledClass && authorizedClasses.includes(prefilledClass)) {
                    setSelectedClass(prefilledClass);
                } else if (authorizedClasses.length === 1) {
                    setSelectedClass(authorizedClasses[0]);
                } else {
                    setSelectedClass('');
                }
            } else {
                setSelectedClass(prefilledClass || '');
            }
        }
    }, [servant, isGeneralAdmin, isServant, prefilledStage, prefilledClass, authorizedClasses, isClassServant]);

    // Sync tab state from navigation state
    useEffect(() => {
        if (location.state?.activeTab) {
            setActiveTab(location.state.activeTab);
        }
    }, [location.state?.activeTab]);

    // Auto-select class if there is only one allowed class
    useEffect(() => {
        if (!isGeneralAdmin && allowedClasses.length === 1) {
            setSelectedClass(allowedClasses[0]);
        }
    }, [allowedClasses, isGeneralAdmin]);

    // Sync configs and students
    useEffect(() => {
        const unsubConfig = onSnapshot(collection(db, 'attendance_config'), (snapshot) => {
            const configMap = {};
            snapshot.docs.forEach(doc => {
                configMap[doc.id] = doc.data();
            });
            setAttendanceConfigs(configMap);
        });

        const unsubStudents = onSnapshot(collection(db, 'students'), (snapshot) => {
            const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setStudents(list);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching students:", error);
            setLoading(false);
        });

        return () => {
            unsubConfig();
            unsubStudents();
        };
    }, []);

    // 4-weeks streak student filtering & sorting
    const filteredStudents = useMemo(() => {
        if (!selectedStage || !selectedClass) return [];
        return students.filter(st => {
            const studentStage = st.schoolGrade || st.stage || '';
            const studentClass = st.assignedClass || st.class || '';
            return normalizeArabic(studentStage) === normalizeArabic(selectedStage) && 
                   normalizeArabic(studentClass) === normalizeArabic(selectedClass);
        });
    }, [students, selectedStage, selectedClass]);

    const sortedStudents = useMemo(() => {
        return [...filteredStudents].sort((a, b) => {
            const aGifts = a.pendingGifts || 0;
            const bGifts = b.pendingGifts || 0;
            if (bGifts !== aGifts) return bGifts - aGifts;
            
            const aStreak = a.attendanceStreak || 0;
            const bStreak = b.attendanceStreak || 0;
            if (bStreak !== aStreak) return bStreak - aStreak;
            
            return (a.name || '').localeCompare(b.name || '', 'ar');
        });
    }, [filteredStudents]);

    // Birthday student filtering & sorting
    const birthdayStudents = useMemo(() => {
        if (!selectedStage || !selectedClass) return [];
        return students.filter(st => {
            const studentStage = st.schoolGrade || st.stage || '';
            const studentClass = st.assignedClass || st.class || '';
            const isMatch = normalizeArabic(studentStage) === normalizeArabic(selectedStage) && 
                            normalizeArabic(studentClass) === normalizeArabic(selectedClass);
            if (!isMatch) return false;

            if (!st.birthDate) return false;
            const parts = st.birthDate.split('-');
            if (parts.length < 2) return false;
            const birthMonth = parseInt(parts[1], 10);
            return birthMonth === selectedMonth;
        });
    }, [students, selectedStage, selectedClass, selectedMonth]);

    const sortedBirthdayStudents = useMemo(() => {
        return [...birthdayStudents].sort((a, b) => {
            const getDay = (dateStr) => {
                if (!dateStr) return 0;
                const parts = dateStr.split('-');
                return parts.length >= 3 ? parseInt(parts[2], 10) : 0;
            };
            const aDay = getDay(a.birthDate);
            const bDay = getDay(b.birthDate);
            if (aDay !== bDay) return aDay - bDay;
            return (a.name || '').localeCompare(b.name || '', 'ar');
        });
    }, [birthdayStudents]);

    const safeClassId = selectedClass ? selectedClass.replace(/\//g, '-') : '';
    const isConsecutiveGiftEnabled = !!attendanceConfigs[safeClassId]?.consecutiveGiftEnabled;

    const handleToggleConsecutiveGift = async () => {
        if (!selectedClass) return;
        const safeId = selectedClass.replace(/\//g, '-');
        const newValue = !isConsecutiveGiftEnabled;
        try {
            await setDoc(doc(db, 'attendance_config', safeId), { consecutiveGiftEnabled: newValue }, { merge: true });
        } catch (error) {
            console.error("Error toggling consecutive gift setting:", error);
            alert("حدث خطأ أثناء تغيير الإعدادات");
        }
    };

    const handleResetStreaks = async () => {
        if (!selectedClass || !selectedStage) return;
        if (!window.confirm(`⚠️ هل أنت متأكد أنك تريد تصفير جميع الاستريكات والهدايا المستحقة لكل طلاب فصل (${selectedClass})؟\n\nهذا الإجراء لا يمكن التراجع عنه.`)) return;

        setIsResettingStreaks(true);
        try {
            const studentsToReset = filteredStudents.filter(s => (s.attendanceStreak || 0) > 0 || (s.pendingGifts || 0) > 0);
            if (studentsToReset.length === 0) {
                alert('لا يوجد طلاب لديهم استريك أو هدايا مستحقة لتصفيرها.');
                setIsResettingStreaks(false);
                return;
            }

            // Firestore batches support max 500 writes
            const batchSize = 450;
            for (let i = 0; i < studentsToReset.length; i += batchSize) {
                const batch = writeBatch(db);
                const chunk = studentsToReset.slice(i, i + batchSize);
                chunk.forEach(student => {
                    const ref = doc(db, 'students', student.id);
                    batch.update(ref, {
                        attendanceStreak: 0,
                        pendingGifts: 0
                    });
                });
                await batch.commit();
            }

            alert(`✅ تم تصفير الاستريك والهدايا المستحقة لعدد ${studentsToReset.length} طالب في فصل (${selectedClass}) بنجاح.`);
        } catch (error) {
            console.error('Error resetting streaks:', error);
            alert('حدث خطأ أثناء تصفير الاستريكات. حاول مرة أخرى.');
        } finally {
            setIsResettingStreaks(false);
        }
    };

    const handleExportConsecutiveExcel = () => {
        if (sortedStudents.length === 0) return;
        
        const headers = [
            'م',
            'كود التعريف',
            'اسم الطالب',
            'المرحلة',
            'الفصل',
            'الاستريك المتتالي (الالتزام)',
            'الهدايا المستحقة'
        ];

        const rows = sortedStudents.map((student, idx) => {
            return [
                idx + 1,
                student.code || '',
                student.name || '',
                student.schoolGrade || selectedStage || '',
                student.assignedClass || selectedClass || '',
                student.attendanceStreak ? `${student.attendanceStreak} أسابيع` : '—',
                student.pendingGifts ? `${student.pendingGifts} هدايا` : '—'
            ];
        });

        const sheetTitle = 'التزام الطلاب والهدايا';
        const clsName = selectedClass || 'الكل';
        const fileName = `تقرير_التزام_الـ4_أسابيع_فصل_${clsName.replace(/\s+/g, '_')}_تاريخ_${new Date().toISOString().split('T')[0]}`;

        exportToExcelGeneric(headers, rows, sheetTitle, fileName);
    };

    const handleExportBirthdayExcel = () => {
        if (sortedBirthdayStudents.length === 0) return;
        
        const headers = [
            'م',
            'كود التعريف',
            'اسم المخدوم',
            'المرحلة',
            'الفصل',
            'تاريخ الميلاد',
            'حالة استلام الهدية'
        ];

        const rows = sortedBirthdayStudents.map((student, idx) => {
            const claimedMap = student.birthdayGiftsClaimed || {};
            const hasClaimed = !!claimedMap[selectedYear];
            return [
                idx + 1,
                student.code || '',
                student.name || '',
                student.schoolGrade || selectedStage || '',
                student.assignedClass || selectedClass || '',
                getFormattedBirthday(student.birthDate) || student.birthDate || '',
                hasClaimed ? `تم التسليم لعام ${selectedYear} 🎁` : 'لم يستلم ❌'
            ];
        });

        const sheetTitle = 'أعياد ميلاد المخدومين';
        const clsName = selectedClass || 'الكل';
        const fileName = `تقرير_أعياد_ميلاد_شهر_${selectedMonth}_سنة_${selectedYear}_فصل_${clsName.replace(/\s+/g, '_')}`;

        exportToExcelGeneric(headers, rows, sheetTitle, fileName);
    };

    const claimGift = async (studentId, currentPendingGifts) => {
        if (currentPendingGifts <= 0) return;
        if (!window.confirm('هل أنت متأكد من تسليم الهدية للمخدوم؟ سيتم خصم هدية واحدة من الهدايا المستحقة.')) return;
        try {
            const studentRef = doc(db, 'students', studentId);
            await updateDoc(studentRef, {
                pendingGifts: Math.max(0, currentPendingGifts - 1)
            });
            alert('تم تسليم الهدية للمخدوم بنجاح 🎁');
        } catch (error) {
            console.error("Error claiming gift:", error);
            alert('حدث خطأ أثناء تسليم الهدية');
        }
    };

    const claimBirthdayGift = async (studentId, currentMap) => {
        if (!window.confirm(`هل أنت متأكد من تسليم هدية عيد الميلاد لعام ${selectedYear} للمخدوم؟`)) return;
        try {
            const studentRef = doc(db, 'students', studentId);
            const updatedMap = {
                ...(currentMap || {}),
                [selectedYear]: true
            };
            await updateDoc(studentRef, {
                birthdayGiftsClaimed: updatedMap
            });
            alert('تم تسليم هدية عيد الميلاد بنجاح 🎁');
        } catch (error) {
            console.error("Error claiming birthday gift:", error);
            alert('حدث خطأ أثناء تسليم الهدية');
        }
    };

    const unclaimBirthdayGift = async (studentId, currentMap) => {
        if (!window.confirm(`هل أنت متأكد من إلغاء تسليم هدية عيد الميلاد لعام ${selectedYear} للمخدوم؟`)) return;
        try {
            const studentRef = doc(db, 'students', studentId);
            const updatedMap = { ...(currentMap || {}) };
            delete updatedMap[selectedYear];
            await updateDoc(studentRef, {
                birthdayGiftsClaimed: updatedMap
            });
            alert('تم إلغاء تسليم هدية عيد الميلاد بنجاح ↩️');
        } catch (error) {
            console.error("Error unclaiming birthday gift:", error);
            alert('حدث خطأ أثناء إلغاء تسليم الهدية');
        }
    };

    const getFormattedBirthday = (dateStr) => {
        if (!dateStr) return '';
        const parts = dateStr.split('-');
        if (parts.length < 3) return dateStr;
        const day = parseInt(parts[2], 10);
        const monthNum = parseInt(parts[1], 10);
        
        const arabicMonthNames = [
            'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
            'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
        ];
        
        const monthName = arabicMonthNames[monthNum - 1] || '';
        return `${day} ${monthName}`;
    };

    const handleBack = () => {
        if (isGeneralAdmin) {
            navigate('/admin');
        } else {
            navigate('/servant/profile');
        }
    };

    return (
        <div className="max-w-6xl mx-auto px-4 py-8 bg-slate-50 text-slate-900 dark:bg-[#0f172a] dark:text-slate-50 transition-colors duration-300" dir="rtl">
            <header className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                        <Gift className="text-amber-500" size={32} />
                        نظام متابعة الـ 4 أسابيع وأعياد الميلاد
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1 font-bold text-sm">
                        متابعة وتوزيع مكافآت التزام الحضور وأعياد ميلاد المخدومين
                    </p>
                </div>
                <button 
                    onClick={handleBack} 
                    className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#1e293b] dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold transition-all cursor-pointer shadow-sm border-none"
                >
                    <ArrowLeft size={18} />
                    <span>رجوع</span>
                </button>
            </header>

            {loading ? (
                <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
                    <p className="text-lg font-bold text-slate-400 dark:text-slate-505">تحميل البيانات...</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Tab Navigation */}
                    <div className="flex bg-slate-100 dark:bg-[#1e293b] p-1.5 rounded-2xl w-full sm:w-fit border border-slate-200/50 dark:border-slate-800 mb-6">
                        <button
                            type="button"
                            onClick={() => setActiveTab('four_weeks')}
                            className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer border-none flex-1 sm:flex-initial ${
                                activeTab === 'four_weeks'
                                    ? 'bg-white dark:bg-[#0f172a] text-blue-600 dark:text-blue-450 shadow-sm'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                            }`}
                        >
                            <Flame size={16} />
                            <span>نظام متابعة الـ 4 أسابيع</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('birthdays')}
                            className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer border-none flex-1 sm:flex-initial ${
                                activeTab === 'birthdays'
                                    ? 'bg-white dark:bg-[#0f172a] text-blue-600 dark:text-blue-450 shadow-sm'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                            }`}
                        >
                            <Cake size={16} />
                            <span>نظام متابعة أعياد الميلاد</span>
                        </button>
                    </div>

                    {/* Filters Card */}
                    <div className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm flex flex-col lg:flex-row gap-4 items-center transition-all">
                        <span className="font-bold text-slate-600 dark:text-slate-400 whitespace-nowrap">تصفية حسب:</span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-row gap-4 w-full">
                            <div className="flex-1">
                                <select
                                    value={selectedStage}
                                    onChange={(e) => {
                                        setSelectedStage(e.target.value);
                                        setSelectedClass('');
                                    }}
                                    disabled={!isGeneralAdmin && allowedStages.length <= 1}
                                    className="w-full p-3 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:opacity-60 cursor-pointer"
                                >
                                    <option value="">-- اختر المرحلة --</option>
                                    {allowedStages.map(stage => (
                                        <option key={stage} value={stage}>{stage}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex-1">
                                <select
                                    value={selectedClass}
                                    onChange={(e) => setSelectedClass(e.target.value)}
                                    disabled={!selectedStage || (!isGeneralAdmin && allowedClasses.length <= 1)}
                                    className="w-full p-3 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:opacity-60 cursor-pointer"
                                >
                                    <option value="">-- اختر الفصل --</option>
                                    {allowedClasses.map(cls => (
                                        <option key={cls} value={cls}>{cls}</option>
                                    ))}
                                </select>
                            </div>

                            {activeTab === 'birthdays' && (
                                <>
                                    <div className="flex-1">
                                        <select
                                            value={selectedMonth}
                                            onChange={(e) => setSelectedMonth(parseInt(e.target.value, 10))}
                                            className="w-full p-3 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer"
                                        >
                                            {MONTHS.map(m => (
                                                <option key={m.value} value={m.value}>{m.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="flex-1">
                                        <select
                                            value={selectedYear}
                                            onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                                            className="w-full p-3 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors cursor-pointer"
                                        >
                                            {yearsList.map(y => (
                                                <option key={y} value={y}>{y}</option>
                                            ))}
                                        </select>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {selectedClass ? (
                        activeTab === 'four_weeks' ? (
                            <>
                                {/* Settings Configuration Card */}
                                <div className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm rounded-2xl p-6 transition-all">
                                    <div className="max-w-xl space-y-3">
                                        <div className="flex justify-between items-center bg-slate-50 dark:bg-[#0f172a]/55 border border-slate-200/50 dark:border-slate-800 p-4 rounded-xl transition-all">
                                            <div className="flex flex-col gap-1 text-right">
                                                <span className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                                    تفعيل نظام المكافآت (4 أسابيع متتالية) لفصل ({selectedClass})
                                                </span>
                                                <span className="text-xs text-slate-500 dark:text-slate-400 font-bold">
                                                    عند التفعيل، يحصل الطالب تلقائياً على هدية مستحقة عند تحقيق 4 حضور متتالي.
                                                </span>
                                            </div>
                                            <button
                                                onClick={handleToggleConsecutiveGift}
                                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-205 ease-in-out focus:outline-none ${isConsecutiveGiftEnabled ? 'bg-emerald-500' : 'bg-slate-600'}`}
                                                type="button"
                                                dir="ltr"
                                            >
                                                <span
                                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isConsecutiveGiftEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                                                />
                                            </button>
                                        </div>

                                        {/* Reset Streaks Button */}
                                        {isConsecutiveGiftEnabled && (
                                            <div className="flex justify-between items-center bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200/50 dark:border-rose-900/40 p-4 rounded-xl transition-all">
                                                <div className="flex flex-col gap-1 text-right">
                                                    <span className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                                        تصفير الاستريك لفصل ({selectedClass})
                                                    </span>
                                                    <span className="text-xs text-slate-500 dark:text-slate-400 font-bold">
                                                        إعادة تعيين جميع الاستريكات والهدايا المستحقة لكل طلاب الفصل للبدء من جديد.
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={handleResetStreaks}
                                                    disabled={isResettingStreaks || sortedStudents.length === 0}
                                                    className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all border cursor-pointer ${
                                                        isResettingStreaks
                                                            ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-555 border-slate-200 dark:border-slate-700 cursor-not-allowed'
                                                            : 'bg-rose-500 hover:bg-rose-600 text-white border-rose-500 hover:border-rose-600 shadow-sm'
                                                    }`}
                                                    type="button"
                                                >
                                                    <RefreshCcw size={16} className={isResettingStreaks ? 'animate-spin' : ''} />
                                                    {isResettingStreaks ? 'جاري التصفير...' : 'ضبط مصنع 🔄'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Roster Table Card */}
                                <div className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm rounded-2xl p-6 transition-all">
                                    <h3 className="text-lg font-black text-slate-805 dark:text-slate-150 mb-6 pb-2 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                                        <span>قائمة التزام الطلاب والهدايا - ({selectedClass})</span>
                                        <div className="flex items-center gap-3">
                                            {sortedStudents.length > 0 && (
                                                <button 
                                                    type="button"
                                                    onClick={handleExportConsecutiveExcel}
                                                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow transition-all flex items-center justify-center gap-1 cursor-pointer border-none text-xs"
                                                    title="تصدير كشف التزام الـ 4 أسابيع لإكسيل"
                                                >
                                                    <FileSpreadsheet size={14} />
                                                    <span>تصدير لإكسيل</span>
                                                </button>
                                            )}
                                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">إجمالي الطلاب: {sortedStudents.length}</span>
                                        </div>
                                    </h3>

                                    {sortedStudents.length === 0 ? (
                                        <div className="py-12 text-center text-slate-450 dark:text-slate-500 font-bold border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                                            لا يوجد طلاب مسجلين في هذا الفصل حالياً
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-right border-collapse">
                                                <thead>
                                                    <tr className="bg-slate-50 dark:bg-[#0f172a] text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800">
                                                        <th className="p-3">اسم الطالب</th>
                                                        <th className="p-3">الكود</th>
                                                        <th className="p-3 text-center">الاستريك المتتالي</th>
                                                        <th className="p-3 text-center">الهدايا المستحقة</th>
                                                        <th className="p-3 text-center">إجراءات</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {sortedStudents.map(student => {
                                                        const hasStreak = (student.attendanceStreak || 0) > 0;
                                                        const hasGifts = (student.pendingGifts || 0) > 0;
                                                        const studentProfileUrl = isGeneralAdmin ? `/admin/student/${student.id}` : `/servant/student/${student.id}`;
                                                        return (
                                                            <tr key={student.id} className="border-b border-slate-150 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                                                <td className="p-3 font-bold text-slate-800 dark:text-slate-200">
                                                                    <a href={studentProfileUrl} className="text-blue-500 hover:underline hover:text-blue-600 transition-colors">
                                                                        {student.name}
                                                                    </a>
                                                                </td>
                                                                <td className="p-3 font-mono text-sm text-slate-550 dark:text-slate-450 font-bold">
                                                                    #{student.code}
                                                                </td>
                                                                <td className="p-3 text-center">
                                                                    {hasStreak ? (
                                                                        <span className="inline-flex items-center gap-1 px-3 py-1 bg-orange-100 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 rounded-full font-bold text-xs" dir="ltr">
                                                                            🔥 {student.attendanceStreak} أسابيع
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-slate-400 dark:text-slate-600 font-medium">—</span>
                                                                    )}
                                                                </td>
                                                                <td className="p-3 text-center">
                                                                    {hasGifts ? (
                                                                        <span className="inline-flex items-center gap-1 px-3 py-1 bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-full font-bold text-xs" dir="ltr">
                                                                            🎁 {student.pendingGifts} هدايا
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-slate-400 dark:text-slate-600 font-medium">—</span>
                                                                    )}
                                                                </td>
                                                                <td className="p-3 text-center">
                                                                    {hasGifts ? (
                                                                        <button
                                                                            onClick={() => claimGift(student.id, student.pendingGifts)}
                                                                            className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-md inline-flex items-center gap-1 cursor-pointer border-none"
                                                                        >
                                                                            🎁 تسليم الهدية
                                                                        </button>
                                                                    ) : (
                                                                        <span className="text-slate-400 dark:text-slate-600 text-xs font-semibold">لا يوجد هدايا معلقة</span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            /* Birthday Roster Table Card */
                            <div className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm rounded-2xl p-6 transition-all">
                                <h3 className="text-lg font-black text-slate-800 dark:text-slate-150 mb-6 pb-2 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                                    <span>قائمة أعياد ميلاد المخدومين - ({selectedClass})</span>
                                    <div className="flex items-center gap-3">
                                        {sortedBirthdayStudents.length > 0 && (
                                            <button 
                                                type="button"
                                                onClick={handleExportBirthdayExcel}
                                                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow transition-all flex items-center justify-center gap-1 cursor-pointer border-none text-xs"
                                                title="تصدير كشف أعياد الميلاد لإكسيل"
                                            >
                                                <FileSpreadsheet size={14} />
                                                <span>تصدير لإكسيل</span>
                                            </button>
                                        )}
                                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">إجمالي مخدومي شهر ({selectedMonth}): {sortedBirthdayStudents.length}</span>
                                    </div>
                                </h3>

                                {sortedBirthdayStudents.length === 0 ? (
                                    <div className="py-12 text-center text-slate-450 dark:text-slate-500 font-bold border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                                        لا يوجد مخدومين لديهم أعياد ميلاد في هذا الشهر بالفصل المختار
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-right border-collapse">
                                            <thead>
                                                <tr className="bg-slate-50 dark:bg-[#0f172a] text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800">
                                                    <th className="p-3">اسم المخدوم</th>
                                                    <th className="p-3">الكود</th>
                                                    <th className="p-3 text-center">تاريخ الميلاد</th>
                                                    <th className="p-3 text-center">حالة هدية {selectedYear}</th>
                                                    <th className="p-3 text-center">إجراءات</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {sortedBirthdayStudents.map(student => {
                                                    const claimedMap = student.birthdayGiftsClaimed || {};
                                                    const hasClaimed = !!claimedMap[selectedYear];
                                                    const studentProfileUrl = isGeneralAdmin ? `/admin/student/${student.id}` : `/servant/student/${student.id}`;
                                                    return (
                                                        <tr key={student.id} className="border-b border-slate-150 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                                            <td className="p-3 font-bold text-slate-800 dark:text-slate-200">
                                                                <a href={studentProfileUrl} className="text-blue-500 hover:underline hover:text-blue-600 transition-colors">
                                                                    {student.name}
                                                                </a>
                                                            </td>
                                                            <td className="p-3 font-mono text-sm text-slate-550 dark:text-slate-450 font-bold">
                                                                #{student.code}
                                                            </td>
                                                            <td className="p-3 text-center font-bold text-slate-600 dark:text-white">
                                                                {getFormattedBirthday(student.birthDate)}
                                                            </td>
                                                            <td className="p-3 text-center">
                                                                {hasClaimed ? (
                                                                    <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-full font-bold text-xs" dir="ltr">
                                                                        تم التسليم 🎁
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center gap-1 px-3 py-1 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-full font-bold text-xs" dir="ltr">
                                                                        لم يستلم ❌
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="p-3 text-center">
                                                                {hasClaimed ? (
                                                                    <button
                                                                        onClick={() => unclaimBirthdayGift(student.id, claimedMap)}
                                                                        className="bg-rose-500 hover:bg-rose-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-md inline-flex items-center gap-1 cursor-pointer border-none"
                                                                    >
                                                                        <RotateCcw size={12} />
                                                                        تراجع
                                                                    </button>
                                                                ) : (
                                                                    <button
                                                                        onClick={() => claimBirthdayGift(student.id, claimedMap)}
                                                                        className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-md inline-flex items-center gap-1 cursor-pointer border-none"
                                                                    >
                                                                        🎁 تسليم الهدية
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )
                    ) : (
                        <div className="text-center py-12 text-slate-550 dark:text-slate-500 font-bold text-sm bg-slate-100/40 dark:bg-[#1e293b]/20 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                            يرجى اختيار المرحلة والفصل لعرض وإدارة مكافآت الالتزام والهدايا.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
