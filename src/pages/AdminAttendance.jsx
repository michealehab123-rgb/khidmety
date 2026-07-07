import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, onSnapshot, db } from '../firebase';
import { Printer, Filter, Calendar, CheckCircle, XCircle, Search, FileSpreadsheet } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { exportAttendanceToExcel, exportToExcelGeneric } from '../utils/excelExport';

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

const parseFilterValues = (filterStr) => {
    if (!filterStr || filterStr.trim() === '') return null;
    
    // Normalize string: replace Arabic comma with English comma
    let str = filterStr.replace(/،/g, ',').trim();
    
    const values = new Set();
    // Split by comma, dot, semicolon, slash, or whitespace
    const tokens = str.split(/[\.,;，\s\/]+/);
    for (let token of tokens) {
        token = token.trim();
        if (!token) continue;
        if (token.includes('-')) {
            const rangeParts = token.split('-');
            if (rangeParts.length === 2) {
                const start = parseInt(rangeParts[0], 10);
                const end = parseInt(rangeParts[1], 10);
                if (!isNaN(start) && !isNaN(end)) {
                    const min = Math.min(start, end);
                    const max = Math.max(start, end);
                    for (let i = min; i <= max; i++) {
                        values.add(i);
                    }
                }
            }
        } else {
            const val = parseInt(token, 10);
            if (!isNaN(val)) {
                values.add(val);
            }
        }
    }
    return values.size > 0 ? Array.from(values) : null;
};

export default function AdminAttendance() {
    const { user, servant, isGeneralAdmin, isStageServant, isServant, loading: authLoading, authorizedClasses } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const [students, setStudents] = useState([]);
    const [isFetching, setIsFetching] = useState(true);

    const todayDate = new Date();
    const formatDateToYYYYMMDD = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };
    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(todayDate.getDate() - 30);
    
    const [selectedStage, setSelectedStage] = useState('');
    const [selectedClass, setSelectedClass] = useState('');
    const [resultSearchQuery, setResultSearchQuery] = useState('');
    const [minAttendanceFilter, setMinAttendanceFilter] = useState('');
    const [minLiturgyFilter, setMinLiturgyFilter] = useState('');
    const [minConfessionFilter, setMinConfessionFilter] = useState('');
    
    const isFilterInitialized = useRef(false);
    const prevUserIdRef = useRef(null);

    let myStage = 'ابتدائي';
    const rawStage = servant ? (servant.assignedStage || servant.grade || '') : '';
    if (rawStage.includes('ابتدائي') || rawStage.includes('ابتدائى')) {
        myStage = 'ابتدائي';
    } else if (rawStage.includes('اعدادي') || rawStage.includes('اعدادى')) {
        myStage = 'اعدادي';
    } else if (rawStage.includes('ثانوي') || rawStage.includes('ثانوى')) {
        myStage = 'ثانوي';
    }

    const myClass = servant ? (servant.assignedClass || servant.assignment || '') : '';
    const myClasses = authorizedClasses || [];

    const myClassesKey = useMemo(() => myClasses.join(','), [myClasses]);

    const [filters, setFilters] = useState({
        day: String(todayDate.getDate()),
        month: String(todayDate.getMonth() + 1),
        year: String(todayDate.getFullYear()),
        status: 'attended',
        grade: '',
        searchMode: 'single',
        startDay: String(oneMonthAgo.getDate()),
        startMonth: String(oneMonthAgo.getMonth() + 1),
        startYear: String(oneMonthAgo.getFullYear()),
        endDay: String(todayDate.getDate()),
        endMonth: String(todayDate.getMonth() + 1),
        endYear: String(todayDate.getFullYear())
    });

    const [appliedFilters, setAppliedFilters] = useState(null);

    // جلب وحماية البيانات اللحظية بناءً على نطاق أمين المرحلة لمنع التسريب كلياً
    useEffect(() => {
        if (authLoading) return;

        if (!isGeneralAdmin && !isServant) {
            navigate('/login');
            return;
        }

        const unsub = onSnapshot(collection(db, 'students'), (snapshot) => {
            const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            const visibleStudents = isGeneralAdmin
                ? list
                : list.filter(st => {
                    const studentClass = st.assignedClass || '';
                    if (isStageServant) {
                        const allowedClasses = STAGE_CLASS_MAP[myStage] || [];
                        return allowedClasses.includes(studentClass);
                    } else {
                        return myClasses.includes(studentClass);
                    }
                });

            setStudents(visibleStudents);
            setIsFetching(false);
        }, (error) => {
            console.error("Error fetching students:", error);
            setIsFetching(false);
        });

        return () => unsub();
    }, [isGeneralAdmin, isServant, isStageServant, myStage, myClassesKey, authLoading, navigate]);

    // عسكري حراسة ذكي لتصفير وتثبيت فلاتر الصفحة بأمان ومنع اللووب الدائري
    useEffect(() => {
        if (authLoading) return;

        const currentUserId = (isGeneralAdmin && user?.uid) || servant?.id || 'guest';
        
        if (prevUserIdRef.current !== currentUserId) {
            isFilterInitialized.current = false;
            prevUserIdRef.current = currentUserId;
        }

        if (isFilterInitialized.current) return;

        const prefilledStage = location.state?.prefilledStage;
        const prefilledClass = location.state?.prefilledClass;
        const storedStage = localStorage.getItem('selectedStageFilter');
        const storedClass = localStorage.getItem('selectedClassFilter');

        if (prefilledStage && prefilledClass) {
            setSelectedStage(prefilledStage);
            setSelectedClass(prefilledClass);
            setFilters(prev => ({
                ...prev,
                grade: prefilledClass
            }));
            setAppliedFilters({
                day: String(todayDate.getDate()),
                month: String(todayDate.getMonth() + 1),
                year: String(todayDate.getFullYear()),
                status: 'attended',
                grade: prefilledClass,
                searchMode: 'single',
                startDay: String(oneMonthAgo.getDate()),
                startMonth: String(oneMonthAgo.getMonth() + 1),
                startYear: String(oneMonthAgo.getFullYear()),
                endDay: String(todayDate.getDate()),
                endMonth: String(todayDate.getMonth() + 1),
                endYear: String(todayDate.getFullYear())
            });
            isFilterInitialized.current = true;
            window.history.replaceState({}, document.title);
            return;
        } else if (storedStage || storedClass) {
            let stageToUse = storedStage || 'ابتدائي';
            let classToUse = storedClass || '';

            if (!isGeneralAdmin) {
                stageToUse = myStage;
                if (classToUse !== '' && !myClasses.includes(classToUse)) {
                    classToUse = myClasses[0] || '';
                }
            }

            setSelectedStage(stageToUse);
            setSelectedClass(classToUse);
            setFilters(prev => ({
                ...prev,
                grade: classToUse
            }));
            setAppliedFilters({
                day: String(todayDate.getDate()),
                month: String(todayDate.getMonth() + 1),
                year: String(todayDate.getFullYear()),
                status: 'attended',
                grade: classToUse,
                searchMode: 'single',
                startDay: String(oneMonthAgo.getDate()),
                startMonth: String(oneMonthAgo.getMonth() + 1),
                startYear: String(oneMonthAgo.getFullYear()),
                endDay: String(todayDate.getDate()),
                endMonth: String(todayDate.getMonth() + 1),
                endYear: String(todayDate.getFullYear())
            });
            isFilterInitialized.current = true;
            return;
        }

        let resolvedStage = 'ابتدائي';
        let resolvedClass = '';

        if (!isGeneralAdmin) {
            resolvedStage = myStage;
            resolvedClass = myClasses.length > 1 ? '' : (myClasses[0] || '');
        }

        setSelectedStage(resolvedStage);
        setSelectedClass(resolvedClass);

        setFilters(prev => ({
            ...prev,
            grade: resolvedClass
        }));

        setAppliedFilters({
            day: String(todayDate.getDate()),
            month: String(todayDate.getMonth() + 1),
            year: String(todayDate.getFullYear()),
            status: 'attended',
            grade: resolvedClass,
            searchMode: 'single',
            startDay: String(oneMonthAgo.getDate()),
            startMonth: String(oneMonthAgo.getMonth() + 1),
            startYear: String(oneMonthAgo.getFullYear()),
            endDay: String(todayDate.getDate()),
            endMonth: String(todayDate.getMonth() + 1),
            endYear: String(todayDate.getFullYear())
        });

        isFilterInitialized.current = true;
    }, [isServant, servant, isGeneralAdmin, authLoading, user, myStage, isStageServant, myClassesKey, location]);

    // ربط الفصل المختار بحقل التصفية الداخلي بشكل مستقر
    useEffect(() => {
        setFilters(prev => ({ ...prev, grade: selectedClass }));
    }, [selectedClass]);

    useEffect(() => {
        if (!isGeneralAdmin && myClasses.length > 0) {
            if (selectedClass !== '' && !myClasses.includes(selectedClass)) {
                setSelectedClass(myClasses[0]);
                localStorage.setItem('selectedClassFilter', myClasses[0]);
            }
        }
    }, [isGeneralAdmin, myClassesKey, selectedClass]);

    useEffect(() => {
        const originalTitle = document.title;
        const handleBeforePrint = () => {
            if (appliedFilters) {
                const stage = selectedStage || 'الكل';
                const cls = selectedClass || 'الكل';
                const statusStr = appliedFilters.status === 'attended' ? 'حضور' : 'غياب';
                let dateStr = '';
                if (appliedFilters.searchMode === 'range') {
                    dateStr = `من ${appliedFilters.startDay}-${appliedFilters.startMonth}-${appliedFilters.startYear} إلى ${appliedFilters.endDay}-${appliedFilters.endMonth}-${appliedFilters.endYear}`;
                } else {
                    dateStr = `${appliedFilters.day}-${appliedFilters.month}-${appliedFilters.year}`;
                }
                document.title = `كشف ${statusStr} - مرحلة ${stage} - فصل ${cls} - ${dateStr}`;
            }
        };
        const handleAfterPrint = () => {
            document.title = originalTitle;
        };

        window.addEventListener('beforeprint', handleBeforePrint);
        window.addEventListener('afterprint', handleAfterPrint);
        return () => {
            window.removeEventListener('beforeprint', handleBeforePrint);
            window.removeEventListener('afterprint', handleAfterPrint);
            document.title = originalTitle;
        };
    }, [appliedFilters, selectedStage, selectedClass]);

    if (authLoading || isFetching || (!isServant && !isGeneralAdmin)) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
                <p className="text-lg font-medium text-gray-600 dark:text-slate-400">جاري التحميل...</p>
            </div>
        );
    }

    const handleSearch = () => {
        const snapshot = { ...filters };
        setAppliedFilters(snapshot);
    };

    const handlePrint = () => {
        window.print();
    };

    const handleExportExcel = () => {
        if (!appliedFilters || results.length === 0) return;
        
        let dateStr = '';
        const isRange = appliedFilters.searchMode === 'range';
        if (isRange) {
            dateStr = `${appliedFilters.startYear}-${String(appliedFilters.startMonth).padStart(2, '0')}-${String(appliedFilters.startDay).padStart(2, '0')}_to_${appliedFilters.endYear}-${String(appliedFilters.endMonth).padStart(2, '0')}-${String(appliedFilters.endDay).padStart(2, '0')}`;
        } else {
            dateStr = `${appliedFilters.year}-${String(appliedFilters.month).padStart(2, '0')}-${String(appliedFilters.day).padStart(2, '0')}`;
        }

        const headers = [
            'م',
            'اسم المخدوم',
            'كود التعريف',
            'حضور القداس',
            'الاعتراف',
            isRange ? 'عدد مرات الحضور' : 'حضور الخدمة',
            'الفصل',
            'المرحلة'
        ];

        const rows = results.map((student, idx) => {
            let liturgyStatus = '';
            let confessionStatus = '';
            let attendanceStatus = '';
            
            if (isRange) {
                liturgyStatus = `${student.liturgyAttendanceCount || 0} مرات`;
                confessionStatus = `${student.confessionCount || 0} مرات`;
                attendanceStatus = `${student.attendanceCount || 0} مرات`;
            } else {
                const targetDay = parseInt(appliedFilters.day, 10);
                const targetMonth = parseInt(appliedFilters.month, 10) - 1;
                const targetYear = parseInt(appliedFilters.year, 10);
                
                const attendedLiturgyToday = (student.liturgyAttendance || []).some(dateStr => {
                    const date = new Date(dateStr);
                    return date.getDate() === targetDay &&
                           date.getMonth() === targetMonth &&
                           date.getFullYear() === targetYear;
                });
                
                const attendedToday = (student.attendance || []).some(dateStr => {
                    const date = new Date(dateStr);
                    return date.getDate() === targetDay &&
                           date.getMonth() === targetMonth &&
                           date.getFullYear() === targetYear;
                });

                const targetMonthNum = parseInt(appliedFilters.month, 10);
                const targetYearNum = parseInt(appliedFilters.year, 10);
                const monthKey = `${String(targetMonthNum).padStart(2, '0')}-${targetYearNum}`;
                const hasConfessed = student.confessions?.[monthKey]?.status === true;

                liturgyStatus = attendedLiturgyToday ? 'حاضر ✅' : 'غائب ❌';
                confessionStatus = hasConfessed ? 'اعترف ✅' : 'لم يعترف ❌';
                attendanceStatus = attendedToday ? 'حاضر ✅' : 'غائب ❌';
            }

            return [
                idx + 1,
                student.name || '',
                student.code || '',
                liturgyStatus,
                confessionStatus,
                attendanceStatus,
                student.assignedClass || '—',
                student.schoolGrade || student.assignedStage || '—'
            ];
        });

        const sheetTitle = 'كشف الحضور والغياب';
        const fileName = `كشف_حضور_وغياب_تاريخ_${dateStr}_فصل_${appliedFilters.grade || 'الكل'}`;

        exportToExcelGeneric(headers, rows, sheetTitle, fileName);
    };

    const getCleanCreatedAtTime = (st) => {
        if (!st) return 0;
        if (st.createdAt === null) return Date.now();
        if (typeof st.createdAt === 'undefined') return 0;
        if (typeof st.createdAt.toDate === 'function') return st.createdAt.toDate().getTime();
        if (st.createdAt && typeof st.createdAt.seconds === 'number') return st.createdAt.seconds * 1000;
        const t = new Date(st.createdAt).getTime();
        return isNaN(t) ? 0 : t;
    };

    const formatAttendanceCount = (count, zeroLabel = 'لم يحضر') => {
        if (count === 0) return zeroLabel;
        if (count === 1) return 'مرة واحدة';
        if (count === 2) return 'مرتين';
        if (count >= 3 && count <= 10) return `${count} مرات`;
        return `${count} مرة`;
    };

    const getFilteredStudents = () => {
        if (!appliedFilters) return [];

        const isRange = appliedFilters.searchMode === 'range';

        let startLimit, endLimit;
        let sheetTimestamp;
        let targetDay, targetMonth, targetYear;

        if (isRange) {
            const startDay = parseInt(appliedFilters.startDay, 10);
            const startMonth = parseInt(appliedFilters.startMonth, 10) - 1;
            const startYear = parseInt(appliedFilters.startYear, 10);

            const endDay = parseInt(appliedFilters.endDay, 10);
            const endMonth = parseInt(appliedFilters.endMonth, 10) - 1;
            const endYear = parseInt(appliedFilters.endYear, 10);

            startLimit = new Date(startYear, startMonth, startDay, 0, 0, 0, 0);
            endLimit = new Date(endYear, endMonth, endDay, 23, 59, 59, 999);
            sheetTimestamp = endLimit.getTime();
        } else {
            targetDay = parseInt(appliedFilters.day, 10);
            targetMonth = parseInt(appliedFilters.month, 10) - 1;
            targetYear = parseInt(appliedFilters.year, 10);

            const selectedDate = new Date(targetYear, targetMonth, targetDay, 23, 59, 59);
            sheetTimestamp = selectedDate.getTime();
        }

        const filteredList = students.filter(student => {
            const studentCreationTimestamp = getCleanCreatedAtTime(student);

            let hasAttendance = false;
            if (isRange) {
                hasAttendance = (student.attendance || []).some(dateStr => {
                    const date = new Date(dateStr);
                    const time = date.getTime();
                    return time >= startLimit.getTime() && time <= endLimit.getTime();
                }) || (student.liturgyAttendance || []).some(dateStr => {
                    const date = new Date(dateStr);
                    const time = date.getTime();
                    return time >= startLimit.getTime() && time <= endLimit.getTime();
                });
            } else {
                hasAttendance = (student.attendance || []).some(dateStr => {
                    const date = new Date(dateStr);
                    return date.getDate() === targetDay &&
                           date.getMonth() === targetMonth &&
                           date.getFullYear() === targetYear;
                }) || (student.liturgyAttendance || []).some(dateStr => {
                    const date = new Date(dateStr);
                    return date.getDate() === targetDay &&
                           date.getMonth() === targetMonth &&
                           date.getFullYear() === targetYear;
                });
            }

            if (sheetTimestamp < studentCreationTimestamp && !hasAttendance) {
                return false;
            }

            if (isGeneralAdmin && selectedStage) {
                if (student.schoolGrade !== selectedStage) return false;
            }

            const studentClass = student.assignedClass || '';
            if (appliedFilters.grade && studentClass !== appliedFilters.grade) {
                return false;
            }

            if (isRange) {
                const attendanceInPeriod = (student.attendance || []).filter(dateStr => {
                    const date = new Date(dateStr);
                    const time = date.getTime();
                    return time >= startLimit.getTime() && time <= endLimit.getTime();
                });
                
                const count = attendanceInPeriod.length;

                // Only apply default status filtering if no custom attendance filter is typed
                if (minAttendanceFilter.trim() === '') {
                    if (appliedFilters.status === 'attended' && count === 0) return false;
                    if (appliedFilters.status === 'absent' && count > 0) return false;
                }
            } else {
                const didAttend = (student.attendance || []).some(dateStr => {
                    const date = new Date(dateStr);
                    return date.getDate() === targetDay &&
                           date.getMonth() === targetMonth &&
                           date.getFullYear() === targetYear;
                });

                if (appliedFilters.status === 'attended' && !didAttend) return false;
                if (appliedFilters.status === 'absent' && didAttend) return false;
            }

            return true;
        });

        const mappedList = filteredList.map(student => {
            if (isRange) {
                const attendanceInPeriod = (student.attendance || []).filter(dateStr => {
                    const date = new Date(dateStr);
                    const time = date.getTime();
                    return time >= startLimit.getTime() && time <= endLimit.getTime();
                });
                const liturgyInPeriod = (student.liturgyAttendance || []).filter(dateStr => {
                    const date = new Date(dateStr);
                    const time = date.getTime();
                    return time >= startLimit.getTime() && time <= endLimit.getTime();
                });
                const confessionsInPeriod = Object.values(student.confessions || {}).filter(c => {
                    if (!c || c.status !== true || !c.date) return false;
                    const time = new Date(c.date).getTime();
                    return time >= startLimit.getTime() && time <= endLimit.getTime();
                });
                return {
                    ...student,
                    attendanceCount: attendanceInPeriod.length,
                    liturgyAttendanceCount: liturgyInPeriod.length,
                    confessionCount: confessionsInPeriod.length
                };
            } else {
                const attendedLiturgyToday = (student.liturgyAttendance || []).some(dateStr => {
                    const date = new Date(dateStr);
                    return date.getDate() === targetDay &&
                           date.getMonth() === targetMonth &&
                           date.getFullYear() === targetYear;
                });
                return {
                    ...student,
                    attendedLiturgyToday
                };
            }
        });

        if (isRange && appliedFilters.status === 'attended') {
            return mappedList.sort((a, b) => {
                if (b.attendanceCount !== a.attendanceCount) {
                    return b.attendanceCount - a.attendanceCount;
                }
                return normalizeArabic(a.name).localeCompare(normalizeArabic(b.name));
            });
        }

        return mappedList;
    };

    const rawResults = getFilteredStudents();

    const results = (() => {
        let filtered = rawResults;

        // Search by name or code
        if (resultSearchQuery.trim()) {
            const q = normalizeArabic(resultSearchQuery.trim().toLowerCase());
            filtered = filtered.filter(st => {
                const name = normalizeArabic((st.name || '').toLowerCase());
                const code = (st.code || '').toLowerCase();
                return name.includes(q) || code.includes(q);
            });
        }

        // Filter by attendance count (range mode only)
        if (minAttendanceFilter !== '' && appliedFilters?.searchMode === 'range') {
            const allowedVals = parseFilterValues(minAttendanceFilter);
            if (allowedVals !== null) {
                filtered = filtered.filter(st => allowedVals.includes(st.attendanceCount || 0));
            }
        }

        // Filter by liturgy count (range mode only)
        if (minLiturgyFilter !== '' && appliedFilters?.searchMode === 'range') {
            const allowedVals = parseFilterValues(minLiturgyFilter);
            if (allowedVals !== null) {
                filtered = filtered.filter(st => allowedVals.includes(st.liturgyAttendanceCount || 0));
            }
        }

        // Filter by confession count (range mode only)
        if (minConfessionFilter !== '' && appliedFilters?.searchMode === 'range') {
            const allowedVals = parseFilterValues(minConfessionFilter);
            if (allowedVals !== null) {
                filtered = filtered.filter(st => allowedVals.includes(st.confessionCount || 0));
            }
        }

        return filtered;
    })();

    const days = Array.from({ length: 31 }, (_, i) => i + 1);
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const currentYear = new Date().getFullYear();
    const years = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

    const formatHeaderDate = () => {
        if (!appliedFilters) return '';
        if (appliedFilters.searchMode === 'range') {
            return `من ${appliedFilters.startDay}/${appliedFilters.startMonth}/${appliedFilters.startYear} إلى ${appliedFilters.endDay}/${appliedFilters.endMonth}/${appliedFilters.endYear}`;
        }
        return `${appliedFilters.day}/${appliedFilters.month}/${appliedFilters.year}`;
    };

    const statusPill = (status) => {
        if (status === 'attended') return <span className="text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-955/30 font-bold px-2 py-1 rounded">حاضرين</span>;
        return <span className="text-rose-700 dark:text-rose-400 bg-rose-100 dark:bg-rose-955/30 font-bold px-2 py-1 rounded">غائبين</span>;
    };

    return (
        <div className="max-w-7xl mx-auto px-4 py-8 min-h-[75vh]" dir="rtl">
            {/* Header section (Hidden on Print) */}
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 print:hidden">
                <div className="flex items-center gap-4">
                    <div className="bg-blue-600 p-3.5 rounded-2xl text-white shadow-lg">
                        <Calendar size={32} />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-slate-800 dark:text-slate-100">كشوف حضور المخدومين والغياب</h1>
                        <p className="text-slate-500 dark:text-slate-400 font-medium">متابعة دقيقة وتقارير مجهزة للطباعة</p>
                    </div>
                </div>
                
                {appliedFilters && (
                    <div className="flex gap-3 whitespace-nowrap">
                        <button 
                            type="button"
                            onClick={handleExportExcel}
                            className="flex items-center gap-2 bg-emerald-600 dark:bg-emerald-700 text-white px-6 py-3 rounded-xl font-bold shadow-lg hover:bg-emerald-500 transition cursor-pointer border-none"
                            title="تصدير كشف الحضور والغياب لإكسيل"
                        >
                            <FileSpreadsheet size={20} /> تصدير إلى إكسيل
                        </button>
                        <button 
                            onClick={handlePrint}
                            className="flex items-center gap-2 bg-slate-800 dark:bg-slate-700 text-white px-6 py-3 rounded-xl font-bold shadow-lg hover:bg-slate-700 dark:hover:bg-slate-650 transition cursor-pointer border-none"
                        >
                            <Printer size={20} /> طباعة الكشف
                        </button>
                    </div>
                )}
            </header>

            {/* Filter Section (Hidden on Print) */}
            <div className="bg-white dark:bg-[#1e293b] p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-805 mb-8 print:hidden">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-700 dark:text-slate-100">
                    <Filter size={20} className="text-blue-600" />
                    خيارات البحث
                </h3>
                
                {/* التبويب لتحديد نوع البحث */}
                <div className="flex border-b border-slate-150 dark:border-slate-800 pb-4 mb-6 gap-2">
                    <button
                        type="button"
                        onClick={() => setFilters(prev => ({ ...prev, searchMode: 'single' }))}
                        className={`px-5 py-2.5 rounded-xl text-sm font-black transition-all flex items-center gap-2 cursor-pointer border-none ${
                            filters.searchMode === 'single'
                                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                                : 'bg-slate-100 dark:bg-slate-900 text-slate-650 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-850'
                        }`}
                    >
                        <Calendar size={18} />
                        بحث بيوم محدد
                    </button>
                    <button
                        type="button"
                        onClick={() => setFilters(prev => ({ ...prev, searchMode: 'range' }))}
                        className={`px-5 py-2.5 rounded-xl text-sm font-black transition-all flex items-center gap-2 cursor-pointer border-none ${
                            filters.searchMode === 'range'
                                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                                : 'bg-slate-100 dark:bg-slate-900 text-slate-650 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-850'
                        }`}
                    >
                        <Filter size={18} />
                        بحث بفترة زمنية
                    </button>
                </div>
                
                <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-${filters.searchMode === 'range' ? '8' : '6'} gap-4`}>
                    {/* Status Filter */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400">حالة المخدوم</label>
                        <select 
                            className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                            value={filters.status}
                            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                        >
                            <option value="attended">حضر (موجودين)</option>
                            <option value="absent">لم يحضر (غائبين)</option>
                        </select>
                    </div>

                    {/* Stage Selector */}
                    <div className="space-y-2 border-r border-slate-100 dark:border-slate-800 pr-4">
                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400">المرحلة الدراسية</label>
                        {isGeneralAdmin ? (
                            <select
                                className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                value={selectedStage}
                                onChange={(e) => {
                                    const nextStage = e.target.value;
                                    setSelectedStage(nextStage);
                                    localStorage.setItem('selectedStageFilter', nextStage);
                                    setSelectedClass('');
                                    localStorage.setItem('selectedClassFilter', '');
                                }}
                            >
                                {Object.keys(STAGE_CLASS_MAP).map(stage => (
                                    <option key={stage} value={stage}>{stage}</option>
                                ))}
                            </select>
                        ) : (
                            <div className="w-full bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-slate-900 dark:text-slate-100 font-bold">
                                {selectedStage || 'غير محدد'}
                            </div>
                        )}
                    </div>

                    {/* Class Selector */}
                    <div className="space-y-2 border-r border-slate-100 dark:border-slate-800 pr-4">
                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 font-semibold text-sm mb-1.5 block">الفصل</label>
                        {isGeneralAdmin ? (
                            <select
                                className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                value={selectedClass}
                                onChange={(e) => {
                                    const nextClass = e.target.value;
                                    setSelectedClass(nextClass);
                                    localStorage.setItem('selectedClassFilter', nextClass);
                                }}
                            >
                                <option value="">كل الفصول</option>
                                {(STAGE_CLASS_MAP[selectedStage] || []).map(cls => (
                                    <option key={cls} value={cls}>{cls}</option>
                                ))}
                            </select>
                        ) : (
                            <select
                                className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                value={selectedClass}
                                onChange={(e) => {
                                    const nextClass = e.target.value;
                                    setSelectedClass(nextClass);
                                    localStorage.setItem('selectedClassFilter', nextClass);
                                }}
                            >
                                {myClasses.length > 1 && <option value="">كل الفصول</option>}
                                {myClasses.map(cls => (
                                    <option key={cls} value={cls}>{cls}</option>
                                ))}
                            </select>
                        )}
                    </div>

                    {/* Date Filters */}
                    {filters.searchMode === 'single' ? (
                        <div className="space-y-2 border-r border-slate-100 dark:border-slate-800 pr-4 lg:col-span-2">
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-2">التاريخ</label>
                            <div className="flex gap-2">
                                <select 
                                    className="w-1/3 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-center text-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                    value={filters.day}
                                    onChange={(e) => setFilters({ ...filters, day: e.target.value })}
                                >
                                    {days.map(d => <option key={d} value={d}>يوم {d}</option>)}
                                </select>
                                
                                <select 
                                    className="w-1/3 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-center text-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                    value={filters.month}
                                    onChange={(e) => setFilters({ ...filters, month: e.target.value })}
                                >
                                    {months.map(m => <option key={m} value={m}>شهر {m}</option>)}
                                </select>
                                
                                <select 
                                    className="w-1/3 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-center text-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                    value={filters.year}
                                    onChange={(e) => setFilters({ ...filters, year: e.target.value })}
                                >
                                    {years.map(y => <option key={y} value={y}>سنة {y}</option>)}
                                </select>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="space-y-2 border-r border-slate-100 dark:border-slate-800 pr-4 lg:col-span-2">
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-2">من تاريخ</label>
                                <div className="flex gap-2">
                                    <select 
                                        className="w-1/3 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-center text-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                        value={filters.startDay}
                                        onChange={(e) => setFilters({ ...filters, startDay: e.target.value })}
                                    >
                                        {days.map(d => <option key={d} value={d}>يوم {d}</option>)}
                                    </select>
                                    <select 
                                        className="w-1/3 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-center text-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                        value={filters.startMonth}
                                        onChange={(e) => setFilters({ ...filters, startMonth: e.target.value })}
                                    >
                                        {months.map(m => <option key={m} value={m}>شهر {m}</option>)}
                                    </select>
                                    <select 
                                        className="w-1/3 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-center text-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                        value={filters.startYear}
                                        onChange={(e) => setFilters({ ...filters, startYear: e.target.value })}
                                    >
                                        {years.map(y => <option key={y} value={y}>سنة {y}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="space-y-2 border-r border-slate-100 dark:border-slate-800 pr-4 lg:col-span-2">
                                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-2">إلى تاريخ</label>
                                <div className="flex gap-2">
                                    <select 
                                        className="w-1/3 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-center text-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                        value={filters.endDay}
                                        onChange={(e) => setFilters({ ...filters, endDay: e.target.value })}
                                    >
                                        {days.map(d => <option key={d} value={d}>يوم {d}</option>)}
                                    </select>
                                    <select 
                                        className="w-1/3 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-center text-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                        value={filters.endMonth}
                                        onChange={(e) => setFilters({ ...filters, endMonth: e.target.value })}
                                    >
                                        {months.map(m => <option key={m} value={m}>شهر {m}</option>)}
                                    </select>
                                    <select 
                                        className="w-1/3 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-center text-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                        value={filters.endYear}
                                        onChange={(e) => setFilters({ ...filters, endYear: e.target.value })}
                                    >
                                        {years.map(y => <option key={y} value={y}>سنة {y}</option>)}
                                    </select>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Submit Button */}
                    <div className="flex items-end">
                        <button 
                            onClick={handleSearch}
                            className="w-full bg-blue-600 text-white p-3 rounded-lg font-black text-lg hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-md cursor-pointer border-none"
                        >
                            <Search size={20} />
                            بحث
                        </button>
                    </div>
                </div>
            </div>

            {/* Results Section */}
            {appliedFilters && (
                <div className="bg-white dark:bg-[#1e293b] p-8 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 print:shadow-none print:border-none print:p-0">
                    
                    {/* Print Header */}
                    <div className="mb-8 border-b-2 border-slate-800 dark:border-slate-700 pb-4 flex flex-col md:flex-row justify-between items-center gap-4">
                        <div className="text-center md:text-right">
                            <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 leading-normal mb-1 print:text-3xl">
                                قائمة المخدومين الـ ({statusPill(appliedFilters.status)}) 
                                {appliedFilters.grade && `في مرحلة [${appliedFilters.grade}]`}
                            </h2>
                            <p className="text-lg font-bold text-slate-600 dark:text-slate-400">
                                {appliedFilters.searchMode === 'range' ? 'الفترة:' : 'بتاريخ:'} <span dir="rtl" className="inline-block py-1 px-3 bg-slate-100 dark:bg-slate-900 rounded text-slate-800 dark:text-slate-200 font-black">{formatHeaderDate()}</span>
                            </p>
                        </div>
                        <div className="text-center print:text-left">
                            <div className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-1">العدد الإجمالي</div>
                            <div className="text-4xl font-black text-blue-600 dark:text-blue-450 print:text-slate-800 dark:print:text-slate-200">{results.length}</div>
                        </div>
                    </div>

                    {/* Search & Filter Bar */}
                    <div className="mb-6 print:hidden">
                        <div className={`flex flex-col sm:flex-row gap-3 items-stretch`}>
                            {/* Search by name / code */}
                            <div className="flex-1 relative">
                                <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" />
                                <input
                                    type="text"
                                    placeholder="بحث بالاسم أو الكود..."
                                    value={resultSearchQuery}
                                    onChange={(e) => setResultSearchQuery(e.target.value)}
                                    className="w-full pr-10 pl-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500"
                                />
                            </div>

                            {appliedFilters?.searchMode === 'range' && (
                                <>
                                    {/* Min attendance count */}
                                    <div className="relative min-w-[170px]">
                                        <input
                                            type="text"
                                            placeholder="حضور الخدمة (مثال: 1 أو 1.2 أو 0)"
                                            value={minAttendanceFilter}
                                            onChange={(e) => setMinAttendanceFilter(e.target.value)}
                                            className="w-full px-4 py-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/50 rounded-xl font-bold text-blue-700 dark:text-blue-300 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all placeholder:text-blue-400/70 dark:placeholder:text-blue-500/50 text-center text-sm"
                                        />
                                    </div>

                                    {/* Min liturgy count */}
                                    <div className="relative min-w-[170px]">
                                        <input
                                            type="text"
                                            placeholder="حضور القداس (مثال: 1 أو 1.2 أو 0)"
                                            value={minLiturgyFilter}
                                            onChange={(e) => setMinLiturgyFilter(e.target.value)}
                                            className="w-full px-4 py-3 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/50 rounded-xl font-bold text-purple-700 dark:text-purple-300 outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all placeholder:text-purple-400/70 dark:placeholder:text-purple-500/50 text-center text-sm"
                                        />
                                    </div>

                                    {/* Min confession count */}
                                    <div className="relative min-w-[170px]">
                                        <input
                                            type="text"
                                            placeholder="مرات الاعتراف (مثال: 1 أو 1.2 أو 0)"
                                            value={minConfessionFilter}
                                            onChange={(e) => setMinConfessionFilter(e.target.value)}
                                            className="w-full px-4 py-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 rounded-xl font-bold text-amber-700 dark:text-amber-300 outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all placeholder:text-amber-400/70 dark:placeholder:text-amber-550/50 text-center text-sm"
                                        />
                                    </div>
                                </>
                            )}

                            {/* Clear filters button */}
                            {(resultSearchQuery || minAttendanceFilter || minLiturgyFilter || minConfessionFilter) && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setResultSearchQuery('');
                                        setMinAttendanceFilter('');
                                        setMinLiturgyFilter('');
                                        setMinConfessionFilter('');
                                    }}
                                    className="px-4 py-3 bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-455 border border-rose-200 dark:border-rose-800/50 rounded-xl font-bold hover:bg-rose-100 dark:hover:bg-rose-900/30 transition-all cursor-pointer whitespace-nowrap"
                                >
                                    ✕ مسح الفلاتر
                                </button>
                            )}
                        </div>

                        {/* Active filter summary */}
                        {(resultSearchQuery || minAttendanceFilter || minLiturgyFilter || minConfessionFilter) && (
                            <div className="mt-3 flex flex-wrap gap-2 items-center">
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">نتائج مفلترة:</span>
                                <span className="text-sm font-black text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 px-3 py-1 rounded-full">
                                    {results.length} من {rawResults.length} مخدوم
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Table */}
                    {results.length > 0 ? (
                        <div className="overflow-x-auto print:overflow-visible">
                            <table className="w-full text-right border-collapse print:text-lg">
                                <thead>
                                    <tr className="bg-slate-100 dark:bg-slate-900/60 text-slate-900 dark:text-white font-black print:bg-slate-200 print:text-slate-900">
                                        <th className="p-4 border border-slate-300 dark:border-slate-800 w-16 text-center">م</th>
                                        <th className="p-4 border border-slate-300 dark:border-slate-800">اسم المخدوم</th>
                                        <th className="p-4 border border-slate-300 dark:border-slate-800 w-32 text-center">كود التعريف</th>
                                        <th className="p-4 border border-slate-300 dark:border-slate-800 w-36 text-center">حضور القداس</th>
                                        {appliedFilters.searchMode === 'range' && (
                                            <th className="p-4 border border-slate-300 dark:border-slate-800 w-36 text-center">الاعتراف ⛪</th>
                                        )}
                                        {appliedFilters.searchMode === 'range' && (
                                            <th className="p-4 border border-slate-300 dark:border-slate-800 w-36 text-center">عدد مرات الحضور</th>
                                        )}
                                        <th className="p-4 border border-slate-300 dark:border-slate-800 w-48 text-center">الفصل</th>
                                        {!appliedFilters.grade && <th className="p-4 border border-slate-300 dark:border-slate-800 w-48 text-center">المرحلة</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.map((student, idx) => (
                                        <tr key={student.id} className="hover:bg-slate-50 dark:hover:bg-blue-900/10 border-b border-slate-200 dark:border-slate-800 print:border-slate-400">
                                            <td className="p-4 border border-slate-300 dark:border-slate-800 text-center font-bold text-slate-500 dark:text-slate-400">{idx + 1}</td>
                                            <td className="p-4 border border-slate-300 dark:border-slate-800 font-black text-slate-800 dark:text-slate-100">
                                                <div>{student.name}</div>
                                            </td>
                                            <td className="p-4 border border-slate-300 dark:border-slate-800 text-center font-mono font-bold text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 print:bg-transparent tracking-widest">{student.code}</td>
                                            <td className="p-4 border border-slate-300 dark:border-slate-800 text-center">
                                                {appliedFilters.searchMode === 'range' ? (
                                                    <span className={`text-[11px] font-black px-2 py-0.5 rounded-full border ${
                                                        student.liturgyAttendanceCount > 0
                                                        ? 'bg-purple-50 dark:bg-purple-950/10 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800/85'
                                                        : 'bg-rose-50 dark:bg-rose-950/10 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900/30'
                                                    }`}>
                                                        {formatAttendanceCount(student.liturgyAttendanceCount, 'لم يحضر')}
                                                    </span>
                                                ) : (
                                                    <span className={`text-[11px] font-black px-2 py-0.5 rounded-full border ${
                                                        student.attendedLiturgyToday
                                                        ? 'bg-emerald-50 dark:bg-emerald-950/10 text-emerald-600 dark:text-emerald-450 border-emerald-200 dark:border-emerald-800/85'
                                                        : 'bg-rose-50 dark:bg-rose-950/10 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900/30'
                                                    }`}>
                                                        {student.attendedLiturgyToday ? '⛪ حضر القداس' : '❌ لم يحضر'}
                                                    </span>
                                                )}
                                            </td>

                                            {appliedFilters.searchMode === 'range' && (
                                                <td className="p-4 border border-slate-300 dark:border-slate-800 text-center">
                                                    <span className={`text-[11px] font-black px-2 py-0.5 rounded-full border ${
                                                        student.confessionCount > 0
                                                        ? 'bg-purple-50 dark:bg-purple-950/10 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800/85'
                                                        : 'bg-rose-50 dark:bg-rose-950/10 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900/30'
                                                    }`}>
                                                        {formatAttendanceCount(student.confessionCount, 'لم يعترف')}
                                                    </span>
                                                </td>
                                            )}

                                            {appliedFilters.searchMode === 'range' && (
                                                <td className="p-4 border border-slate-300 dark:border-slate-800 text-center font-bold text-blue-600 dark:text-blue-400">
                                                    {formatAttendanceCount(student.attendanceCount, 'لم يحضر')}
                                                </td>
                                            )}
                                            <td className="p-4 border border-slate-300 dark:border-slate-800 text-center font-bold text-slate-700 dark:text-slate-300">
                                                {student.assignedClass || '—'}
                                            </td>
                                            {!appliedFilters.grade && (
                                                <td className="p-4 border border-slate-300 dark:border-slate-800 text-center text-sm font-bold text-slate-600 dark:text-slate-400 block print:table-cell">
                                                    {student.schoolGrade || '—'}
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="py-20 text-center">
                            {appliedFilters.status === 'attended' ? <XCircle size={64} className="mx-auto text-slate-200 dark:text-slate-700 mb-4" /> : <CheckCircle size={64} className="mx-auto text-slate-200 dark:text-slate-700 mb-4" />}
                            <p className="text-xl font-bold text-slate-400 dark:text-slate-500">
                                لا يوجد مخدومين تتطابق مع هذه المواصفات.
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}