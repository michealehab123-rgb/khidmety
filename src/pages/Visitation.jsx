import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, onSnapshot, doc, writeBatch, db, query, where, updateDoc, deleteField } from '../firebase';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Home, PhoneCall, CheckCircle, XCircle, Clock, AlertCircle, Phone, MapPin, UserCheck, Calendar, Users, X, Printer, FileSpreadsheet, Undo2 } from 'lucide-react';
import { exportToExcelGeneric } from '../utils/excelExport';

const STAGE_CLASS_MAP = {
    'ابتدائي': ['حضانة/ملائكة', 'أولى ابتدائى', 'ثانية ابتدائى', 'ثالثة ابتدائى', 'رابعة ابتدائى', 'خامسة ابتدائى', 'سادسة ابتدائي'],
    'اعدادي': ['اولي اعدادي', 'تانيه اعدادي', 'تالته اعدادي'],
    'ثانوي': ['اولي ثانوي', 'تانيه ثانوي', 'تالته ثانوي'],
};

const normalizeArabic = (str) => {
    if (!str) return '';
    return str
        .replace(/[أإآا]/g, 'ا')
        .replace(/[ىي]/g, 'ي')
        .replace(/[ةه]/g, 'ه')
        .trim();
};

const generateWeeks = (count = 12) => {
    const weeks = [];
    const today = new Date();
    
    const currentFriday = new Date();
    currentFriday.setDate(today.getDate() - ((today.getDay() + 2) % 7));
    
    for (let i = 0; i < count; i++) {
        const friday = new Date(currentFriday);
        friday.setDate(currentFriday.getDate() - (i * 7));
        
        const thursday = new Date(friday);
        thursday.setDate(friday.getDate() + 6);
        
        const y = friday.getFullYear();
        const m = String(friday.getMonth() + 1).padStart(2, '0');
        const dStr = String(friday.getDate()).padStart(2, '0');
        const fridayStr = `${y}-${m}-${dStr}`;
        
        const options = { month: 'short', day: 'numeric' };
        const yearOption = { year: 'numeric' };
        const label = `الجمعة ${friday.toLocaleDateString('ar-EG', options)} - الخميس ${thursday.toLocaleDateString('ar-EG', { ...options, ...yearOption })}`;
        
        weeks.push({
            key: fridayStr,
            label: label,
            fridayDate: friday,
            thursdayDate: thursday
        });
    }
    return weeks;
};

const weeksList = generateWeeks(12);

export default function Visitation({ isEmbedded = false, embeddedStage = '', embeddedClass = '' }) {
    const { user, servant, isGeneralAdmin, isServant, loading: authLoading, authorizedClasses } = useAuth();
    
    const roleNorm = servant?.role ? normalizeArabic(servant.role) : '';
    const myStage = servant?.assignedStage || servant?.grade || '';
    const myClass = servant?.assignedClass || servant?.assignment || '';
    const myClasses = authorizedClasses || [];

    const classesKey = useMemo(() => myClasses.join(','), [myClasses]);

    const navigate = useNavigate();
    const location = useLocation();
    const [servantsInClass, setServantsInClass] = useState([]);
    const [students, setStudents] = useState([]);
    const [loading, setLoading] = useState(true);
    
    const [activeTab, setActiveTab] = useState('home');
    const [filterStage, setFilterStage] = useState('');
    const [filterClass, setFilterClass] = useState('');
    const [addressSearch, setAddressSearch] = useState('');
    
    const [partnerModal, setPartnerModal] = useState({ show: false, studentId: null, isPhone: false, missedFriday: null });
    const [selectedServants, setSelectedServants] = useState([]);
    const [lateModal, setLateModal] = useState({ show: false, studentId: null, isPhone: false, periodKey: null });
    const [lateNote, setLateNote] = useState('');

    // Reports State
    const [selectedReportType, setSelectedReportType] = useState('home');
    const [reportStage, setReportStage] = useState('');
    const [selectedClass, setSelectedClass] = useState('');
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [selectedWeekKey, setSelectedWeekKey] = useState('');
    const [reportStudents, setReportStudents] = useState([]);
    const [reportLoading, setReportLoading] = useState(false);

    const isFilterInitialized = useRef(false);
    const prevUserIdRef = useRef(null);

    // Synchronize filters when embedded
    useEffect(() => {
        if (isEmbedded) {
            if (embeddedStage) setFilterStage(embeddedStage);
            if (embeddedClass) setFilterClass(embeddedClass);
        }
    }, [isEmbedded, embeddedStage, embeddedClass]);

    const handleExportExcel = (list, listName) => {
        const headers = ['م', 'كود التعريف', 'الاسم', 'المرحلة', 'الفصل', 'رقم الموبايل', 'العنوان', 'ملاحظات / تفاصيل الافتقاد'];
        const rows = list.map((st, idx) => {
            let details = '';
            if (listName.includes('تم')) {
                // If visited, get the visitation record details
                const record = selectedReportType === 'home' 
                    ? st.homeVisitations?.[`${selectedYear}-${String(selectedMonth).padStart(2, '0')}`]
                    : st.phoneVisitations?.[selectedWeekKey];
                
                if (record) {
                    const servant = record.visitedBy ? record.visitedBy.join(' ، ') : (record.servantName || '');
                    const date = record.timestamp ? new Date(record.timestamp).toLocaleDateString('ar-EG') : '';
                    details = `افتُقد بواسطة: ${servant} بتاريخ: ${date} ${record.note ? ` - ملاحظة: ${record.note}` : ''}`;
                } else if (st.homeVisitations?.[currentMonth]) {
                    const rec = st.homeVisitations[currentMonth];
                    const servant = rec.visitedBy ? rec.visitedBy.join(' ، ') : (rec.servantName || '');
                    details = `تم الافتقاد بواسطة: ${servant} ${rec.note ? ` - ملاحظة: ${rec.note}` : ''}`;
                } else if (st.phoneVisitations?.[lastFridayStr]) {
                    const rec = st.phoneVisitations[lastFridayStr];
                    details = `تم الاتصال بواسطة: ${rec.servantName || ''} ${rec.note ? ` - ملاحظة: ${rec.note}` : ''}`;
                } else {
                    details = 'تم الافتقاد';
                }
            } else {
                details = 'لم يفتقد بعد';
            }
            return [
                idx + 1,
                st.code || '',
                st.name || '',
                st.schoolGrade || st.assignedStage || '',
                st.assignedClass || '',
                st.phone || '',
                st.address || '',
                details
            ];
        });
        const clsName = filterClass || 'الكل';
        exportToExcelGeneric(headers, rows, listName, `تقرير_افتقاد_${listName.replace(/\s+/g, '_')}_فصل_${clsName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}`);
    };

    const handleExportReportExcel = () => {
        const listName = selectedReportType === 'home' ? 'تقرير الافتقاد المنزلي' : 'تقرير الافتقاد التليفوني';

        const headers = [
            'م',
            'الاسم',
            'كود المخدوم',
            'الفصل',
            'الحالة',
            'تاريخ تسجيل الافتقاد',
            'بواسطة',
            'تفاصيل الافتقاد'
        ];

        // Combine visited and not visited
        const allRows = [];
        let idx = 1;

        visitedList.forEach(st => {
            let recordDate = '—';
            let recordBy = '—';
            let details = '—';

            if (selectedReportType === 'home') {
                const rec = st.homeVisitations?.[currentMonth] || {};
                recordDate = rec.date || '—';
                recordBy = rec.visitedBy ? rec.visitedBy.join(' ، ') : (rec.servantName || '—');
                details = rec.notes || '—';
            } else {
                const rec = st.phoneVisitations?.[selectedWeekKey] || {};
                recordDate = rec.date || '—';
                recordBy = rec.servantName || '—';
                details = rec.notes || '—';
            }

            allRows.push([
                idx++,
                st.name || '',
                st.code || '',
                st.assignedClass || '',
                'تم الافتقاد ✅',
                recordDate,
                recordBy,
                details
            ]);
        });

        notVisitedList.forEach(st => {
            allRows.push([
                idx++,
                st.name || '',
                st.code || '',
                st.assignedClass || '',
                'لم يتم الافتقاد ❌',
                '—',
                '—',
                '—'
            ]);
        });

        const clsName = selectedClass || 'الكل';
        exportToExcelGeneric(
            headers, 
            allRows, 
            listName, 
            `تقرير_افتقاد_${selectedReportType === 'home' ? 'منزلي' : 'تليفوني'}_فصل_${clsName.replace(/\s+/g, '_')}_تاريخ_${selectedReportType === 'home' ? `${selectedYear}_${selectedMonth}` : selectedWeekKey}`
        );
    };

    // Helpers
    const isSameLocalDate = (isoStr, localDateStr) => {
        if (!isoStr || !localDateStr) return false;
        try {
            const date = new Date(isoStr);
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}` === localDateStr;
        } catch (e) {
            return false;
        }
    };

    const getCleanCreatedAtTime = (st) => {
        if (!st) return 0;
        if (st.createdAt === null) return Date.now();
        if (typeof st.createdAt === 'undefined') return 0;
        if (typeof st.createdAt.toDate === 'function') return st.createdAt.toDate().getTime();
        if (st.createdAt && typeof st.createdAt.seconds === 'number') {
            return st.createdAt.seconds * 1000;
        }
        const t = new Date(st.createdAt).getTime();
        return isNaN(t) ? 0 : t;
    };

    const getStudentPhones = (st) => {
        if (!st) return [];
        const numbers = [];
        if (st.phones && Array.isArray(st.phones)) {
            st.phones.forEach(p => { if (p && p.trim()) numbers.push(p.trim()); });
        }
        ['phone', 'phone1', 'phone2', 'fatherPhone', 'motherPhone'].forEach(field => {
            if (st[field] && typeof st[field] === 'string' && st[field].trim()) {
                numbers.push(st[field].trim());
            }
        });
        return [...new Set(numbers)];
    };

    const getContactOptions = (st) => {
        if (!st) return [];
        const options = [];
        
        // 1. Add student's own phones
        if (st.phones && Array.isArray(st.phones)) {
            st.phones.forEach((p, idx) => {
                if (p && p.trim()) {
                    options.push({
                        label: `مخدوم${st.phones.length > 1 ? ` ${idx + 1}` : ''}`,
                        phone: p.trim(),
                        type: 'student'
                    });
                }
            });
        }
        ['phone', 'phone1', 'phone2'].forEach((field) => {
            if (st[field] && typeof st[field] === 'string' && st[field].trim()) {
                const phoneVal = st[field].trim();
                if (!options.some(opt => opt.phone === phoneVal)) {
                    options.push({
                        label: 'مخدوم (رقم إضافي)',
                        phone: phoneVal,
                        type: 'student'
                    });
                }
            }
        });
        
        // 2. Add fatherPhone / motherPhone if they exist (old schema fields)
        if (st.fatherPhone && typeof st.fatherPhone === 'string' && st.fatherPhone.trim()) {
            const phoneVal = st.fatherPhone.trim();
            if (!options.some(opt => opt.phone === phoneVal)) {
                options.push({
                    label: 'أب (قديم)',
                    phone: phoneVal,
                    type: 'father'
                });
            }
        }
        if (st.motherPhone && typeof st.motherPhone === 'string' && st.motherPhone.trim()) {
            const phoneVal = st.motherPhone.trim();
            if (!options.some(opt => opt.phone === phoneVal)) {
                options.push({
                    label: 'أم (قديم)',
                    phone: phoneVal,
                    type: 'mother'
                });
            }
        }

        // 3. Add new parents contacts
        if (st.parentsContacts && Array.isArray(st.parentsContacts)) {
            st.parentsContacts.forEach(contact => {
                if (contact && contact.phone && contact.phone.trim()) {
                    const phoneVal = contact.phone.trim();
                    const relLabel = contact.relation === 'father' ? 'أب' : contact.relation === 'mother' ? 'أم' : 'غيره';
                    const displayLabel = contact.name ? `${relLabel} (${contact.name})` : relLabel;
                    if (!options.some(opt => opt.phone === phoneVal)) {
                        options.push({
                            label: displayLabel,
                            phone: phoneVal,
                            type: contact.relation || 'other'
                        });
                    }
                }
            });
        }

        return options;
    };

    const lastFridayStr = useMemo(() => {
        const d = new Date();
        d.setDate(d.getDate() - ((d.getDay() + 2) % 7));
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dStr = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dStr}`;
    }, []);

    // Initialize selected week to the most recent week key
    useEffect(() => {
        if (weeksList.length > 0 && !selectedWeekKey) {
            setSelectedWeekKey(weeksList[0].key);
        }
    }, [selectedWeekKey]);

    // Initialize filters securely with initialization guards
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
            setFilterStage(prefilledStage);
            setReportStage(prefilledStage);
            setFilterClass(prefilledClass);
            setSelectedClass(prefilledClass);
            isFilterInitialized.current = true;
            window.history.replaceState({}, document.title);
            return;
        } else if (storedStage || storedClass) {
            let stageToUse = storedStage || '';
            let classToUse = storedClass || '';

            if (!isGeneralAdmin) {
                stageToUse = myStage;
                if (classToUse !== '' && !myClasses.includes(classToUse)) {
                    classToUse = myClasses[0] || '';
                }
            }

            if (stageToUse) {
                setFilterStage(stageToUse);
                setReportStage(stageToUse);
            }
            if (classToUse) {
                setFilterClass(classToUse);
                setSelectedClass(classToUse);
            }
            isFilterInitialized.current = true;
            return;
        }

        if (!isGeneralAdmin && servant) {
            let resolvedStage = myStage;
            let resolvedClass = myClasses.length > 1 ? '' : (myClasses[0] || '');
            setFilterStage(resolvedStage);
            setReportStage(resolvedStage);
            setFilterClass(resolvedClass);
            setSelectedClass(resolvedClass);
        } else if (isGeneralAdmin) {
            setFilterStage('ابتدائي');
            setFilterClass('');
            setReportStage('ابتدائي');
            setSelectedClass('');
        }

        isFilterInitialized.current = true;
    }, [isServant, isGeneralAdmin, authLoading, user?.uid, servant?.id, servant?.role, servant?.assignedStage, servant?.grade, classesKey, location, myClasses]);

    // Keep main filters and report filters in sync securely
    useEffect(() => {
        if (filterStage) {
            localStorage.setItem('selectedStageFilter', filterStage);
            if (reportStage !== filterStage) setReportStage(filterStage);
        }
    }, [filterStage]);

    useEffect(() => {
        localStorage.setItem('selectedClassFilter', filterClass || '');
        if (selectedClass !== filterClass) setSelectedClass(filterClass);
    }, [filterClass]);

    useEffect(() => {
        if (reportStage) {
            localStorage.setItem('selectedStageFilter', reportStage);
            if (filterStage !== reportStage) setFilterStage(reportStage);
        }
    }, [reportStage]);

    useEffect(() => {
        localStorage.setItem('selectedClassFilter', selectedClass || '');
        if (filterClass !== selectedClass) setFilterClass(selectedClass);
    }, [selectedClass]);

    useEffect(() => {
        if (!isGeneralAdmin && myClasses.length > 0) {
            if (filterClass !== '' && !myClasses.includes(filterClass)) {
                setFilterClass(myClasses[0]);
                localStorage.setItem('selectedClassFilter', myClasses[0]);
            }
        }
    }, [isGeneralAdmin, classesKey, filterClass]);

    const uniqueClasses = [...new Set(students.map(st => st.assignedClass).filter(Boolean))].sort();

    const getServantsForCurrentStudent = () => {
        const student = students.find(s => s.id === partnerModal.studentId);
        if (!student) return [];
        const studentClass = student.assignedClass || student.schoolGrade;
        if (!studentClass) return [];
        
        const normalize = (str) => str?.trim()?.toLowerCase() || '';
        const targetClass = normalize(studentClass);

        return servantsInClass.filter(s => {
            let otherServantClasses = [];
            if (Array.isArray(s.myClasses)) {
                otherServantClasses = [...s.myClasses];
            } else if (typeof s.myClasses === 'string') {
                otherServantClasses = [s.myClasses];
            }
            
            if (Array.isArray(s.managedClasses)) {
                otherServantClasses = [...otherServantClasses, ...s.managedClasses];
            }
            
            if (s.assignedClass) {
                if (Array.isArray(s.assignedClass)) {
                    otherServantClasses = [...otherServantClasses, ...s.assignedClass];
                } else if (typeof s.assignedClass === 'string') {
                    if (s.assignedClass.includes(',')) {
                        otherServantClasses = [...otherServantClasses, ...s.assignedClass.split(',').map(c => c.trim())];
                    } else {
                        otherServantClasses = [...otherServantClasses, s.assignedClass];
                    }
                }
            }
            
            return otherServantClasses.some(c => normalize(c) === targetClass);
        });
    };

    // Fetch reports data with a strict state loading gate to avoid re-render loop
    useEffect(() => {
        if (activeTab !== 'reports') {
            if (reportStudents.length > 0) {
                setReportStudents([]);
            }
            return;
        }

        if (!authLoading && !isGeneralAdmin && isServant && servant) {
            const roleNorm = servant.role ? normalizeArabic(servant.role) : '';
            if (roleNorm === 'امين مرحله') {
                const stage = servant.assignedStage || servant.grade || '';
                const allowedClasses = STAGE_CLASS_MAP[stage] || [];
                if (selectedClass && !allowedClasses.includes(selectedClass)) {
                    if (reportStudents.length > 0) setReportStudents([]);
                    return;
                }
            } else if (roleNorm === 'امين فصل') {
                if (selectedClass && !myClasses.includes(selectedClass)) {
                    if (reportStudents.length > 0) setReportStudents([]);
                    return;
                }
            }
        }

        let q;
        if (selectedClass) {
            q = query(collection(db, 'students'), where('assignedClass', '==', selectedClass));
        } else if (reportStage) {
            q = query(collection(db, 'students'), where('schoolGrade', '==', reportStage));
        } else {
            setReportStudents([]);
            return;
        }

        setReportLoading(true);
        const unsub = onSnapshot(q, (snapshot) => {
            let list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // If they are a class servant and selectedClass is empty, filter by myClasses
            if (!selectedClass && !isGeneralAdmin && isServant && servant) {
                const roleNorm = servant.role ? normalizeArabic(servant.role) : '';
                if (roleNorm === 'امين فصل') {
                    list = list.filter(st => myClasses.includes(st.assignedClass));
                }
            }

            setReportStudents(list);
            setReportLoading(false);
        }, (error) => {
            setReportLoading(false);
        });

        return () => unsub();
    }, [selectedClass, reportStage, activeTab, isGeneralAdmin, isServant, servant?.id, servant?.role, servant?.assignedStage, servant?.grade, authLoading, classesKey, myClasses]);

    // Live Database Synchronization Core Hook
    useEffect(() => {
        if (authLoading) return;

        if (!isGeneralAdmin && !isServant) {
            navigate('/login');
            return;
        }

        const unsubServants = onSnapshot(collection(db, 'servants'), snap => {
            const svts = snap.docs.map(d => ({id: d.id, ...d.data()}));
            const filteredSvts = svts.filter(s => {
                if (s.isActive === false || s.status !== 'approved' || s.id === servant?.id) return false;
                if (isGeneralAdmin) return true;
                
                let otherServantClasses = [];
                if (Array.isArray(s.myClasses)) {
                    otherServantClasses = [...s.myClasses];
                } else if (typeof s.myClasses === 'string') {
                    otherServantClasses = [s.myClasses];
                }
                
                if (Array.isArray(s.managedClasses)) {
                    otherServantClasses = [...otherServantClasses, ...s.managedClasses];
                }
                
                if (s.assignedClass) {
                    if (Array.isArray(s.assignedClass)) {
                        otherServantClasses = [...otherServantClasses, ...s.assignedClass];
                    } else if (typeof s.assignedClass === 'string') {
                        if (s.assignedClass.includes(',')) {
                            otherServantClasses = [...otherServantClasses, ...s.assignedClass.split(',').map(c => c.trim())];
                        } else {
                            otherServantClasses = [...otherServantClasses, s.assignedClass];
                        }
                    }
                }

                const roleNorm = servant?.role ? normalizeArabic(servant.role) : '';
                if (roleNorm === 'امين مرحله') {
                    const stage = servant?.assignedStage || servant?.grade || '';
                    const allowedClasses = STAGE_CLASS_MAP[stage] || [];
                    return otherServantClasses.some(c => allowedClasses.includes(c));
                } else if (roleNorm === 'امين فصل') {
                    return otherServantClasses.some(c => myClasses.includes(c));
                }
                return false;
            });
            setServantsInClass(filteredSvts);
        });

        const unsubStudents = onSnapshot(collection(db, 'students'), async (snap) => {
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            
            const visibleStudentsList = isGeneralAdmin 
                ? list 
                : list.filter(st => {
                    const studentClass = st.assignedClass || '';
                    const roleNorm = servant?.role ? normalizeArabic(servant.role) : '';
                    if (roleNorm === 'امين مرحله') {
                        const stage = servant?.assignedStage || servant?.grade || '';
                        const allowedClasses = STAGE_CLASS_MAP[stage] || [];
                        return allowedClasses.includes(studentClass);
                    } else if (roleNorm === 'امين فصل') {
                        return myClasses.includes(studentClass);
                    }
                    return false;
                });

            await runAutoMigrations(visibleStudentsList);
            setStudents(visibleStudentsList);
            setLoading(false);
        });

        return () => {
            unsubServants();
            unsubStudents();
        };
    }, [isGeneralAdmin, isServant, servant?.id, servant?.role, servant?.assignedStage, servant?.grade, authLoading, navigate, classesKey, myClasses]);

    useEffect(() => {
        const originalTitle = document.title;
        const handleBeforePrint = () => {
            if (activeTab === 'reports') {
                const stage = reportStage || filterStage || 'الكل';
                const cls = selectedClass || filterClass || 'الكل';
                const typeStr = selectedReportType === 'home' ? 'المنزلي' : 'التليفوني';
                const periodStr = selectedReportType === 'home'
                    ? `شهر ${selectedMonth} - سنة ${selectedYear}`
                    : `أسبوع ${selectedWeekKey}`;
                document.title = `تقرير الافتقاد ${typeStr} - مرحلة ${stage} - فصل ${cls} - ${periodStr}`;
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
    }, [activeTab, reportStage, filterStage, selectedClass, filterClass, selectedReportType, selectedMonth, selectedYear, selectedWeekKey]);

    const getCurrentMonthKey = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    const getPreviousMonthKey = () => {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    const getLastFridays = (count) => {
        const fridays = [];
        const d = new Date();
        d.setDate(d.getDate() - ((d.getDay() + 2) % 7));
        for (let i = 0; i < count; i++) {
            fridays.push(new Date(d));
            d.setDate(d.getDate() - 7);
        }
        return fridays.map(dt => {
            const y = dt.getFullYear();
            const m = String(dt.getMonth() + 1).padStart(2, '0');
            const dStr = String(dt.getDate()).padStart(2, '0');
            return `${y}-${m}-${dStr}`;
        });
    };

    const runAutoMigrations = async (visibleStudents) => {
        const batch = writeBatch(db);
        let hasChanges = false;
        
        const prevMonth = getPreviousMonthKey();
        const pastFridays = getLastFridays(4);

        visibleStudents.forEach(st => {
            const studentCreatedTime = getCleanCreatedAtTime(st);
            const stRef = doc(db, 'students', st.id);
            let updates = {};

            const hv = st.homeVisitations || {};
            const prevParts = prevMonth.split('-');
            const prevMonthEnd = new Date(parseInt(prevParts[0], 10), parseInt(prevParts[1], 10), 0, 23, 59, 59);
            const prevMonthEndTime = prevMonthEnd.getTime();
            if (!hv[prevMonth] && prevMonthEndTime >= studentCreatedTime) {
                updates[`homeVisitations.${prevMonth}`] = { status: 'missed', timestamp: new Date().toISOString() };
            }

            const pv = st.phoneVisitations || {};
            const att = st.attendance || [];
            
            for (let i = 1; i < pastFridays.length; i++) {
                const fDate = pastFridays[i];
                const fParts = fDate.split('-');
                const fDateEnd = new Date(parseInt(fParts[0], 10), parseInt(fParts[1], 10) - 1, parseInt(fParts[2], 10), 23, 59, 59);
                const fridayEndTime = fDateEnd.getTime();
                if (fridayEndTime < studentCreatedTime) {
                    continue;
                }

                const wasPresent = att.some(dStr => isSameLocalDate(dStr, fDate));
                if (!wasPresent && !pv[fDate]) {
                    updates[`phoneVisitations.${fDate}`] = { status: 'missed', timestamp: new Date().toISOString() };
                }
            }

            if (Object.keys(updates).length > 0) {
                batch.update(stRef, updates);
                hasChanges = true;
            }
        });

        if (hasChanges) {
            try {
                await batch.commit();
            } catch (err) {
                console.error("Migration error: ", err);
            }
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
                <p className="text-lg font-bold text-slate-400 dark:text-slate-500">تحميل الافتقاد و المتابعه...</p>
            </div>
        );
    }

    if (!isGeneralAdmin && !isServant) return null;

    const visibleStudents = students.filter(st => {
        if (filterClass) {
            if (st.assignedClass !== filterClass) return false;
        } else if (filterStage) {
            const allowedClasses = STAGE_CLASS_MAP[filterStage] || [];
            if (!allowedClasses.includes(st.assignedClass)) return false;
        }
        return true;
    });

    const currentMonth = getCurrentMonthKey();

    // Compute Home Visitation Lists
    const homeNeedsVisit = [];
    const homeVisited = [];

    const currentMonthEndDate = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59);
    const currentMonthEndTime = currentMonthEndDate.getTime();
    const homeVisibleStudents = visibleStudents.filter(st => {
        const studentCreatedTime = getCleanCreatedAtTime(st);
        if (currentMonthEndTime < studentCreatedTime) return false;

        if (addressSearch) {
            const normalizedQuery = normalizeArabic(addressSearch);
            const matchesAddress = (() => {
                if (st.address && normalizeArabic(st.address).includes(normalizedQuery)) return true;
                if (st.location && normalizeArabic(st.location).includes(normalizedQuery)) return true;
                if (st.addresses && Array.isArray(st.addresses)) {
                    return st.addresses.some(addr => addr && normalizeArabic(addr).includes(normalizedQuery));
                }
                return false;
            })();
            if (!matchesAddress) return false;
        }

        return true;
    });

    homeVisibleStudents.forEach(st => {
        const hv = st.homeVisitations || {};
        if (hv[currentMonth] && hv[currentMonth].status === 'visited') {
            homeVisited.push(st);
        } else {
            homeNeedsVisit.push(st);
        }
    });

    // Compute Phone Visitation Lists
    const phoneNeedsCall = [];
    const phoneCalled = [];

    const lastFridayParts = lastFridayStr.split('-');
    const lastFridayEnd = new Date(parseInt(lastFridayParts[0], 10), parseInt(lastFridayParts[1], 10) - 1, parseInt(lastFridayParts[2], 10), 23, 59, 59);
    const lastFridayEndTime = lastFridayEnd.getTime();
    const phoneVisibleStudents = visibleStudents.filter(st => {
        const studentCreatedTime = getCleanCreatedAtTime(st);
        return lastFridayEndTime >= studentCreatedTime;
    });

    phoneVisibleStudents.forEach(st => {
        const att = st.attendance || [];
        const pv = st.phoneVisitations || {};
        
        const wasPresentLastFriday = att.some(dStr => isSameLocalDate(dStr, lastFridayStr));
        
        if (!wasPresentLastFriday) {
            if (pv[lastFridayStr]?.status === 'called') {
                phoneCalled.push(st);
            } else {
                phoneNeedsCall.push(st);
            }
        }
    });

    const markVisitation = async () => {
        if (!partnerModal.studentId) return;
        
        const stRef = doc(db, 'students', partnerModal.studentId);
        const updates = {};
        const timestamp = new Date().toISOString();

        const sId = isGeneralAdmin ? user.uid : servant?.id;
        
        const currentCode = isGeneralAdmin ? '' : (servant?.code || servant?.servantCode || '');
        const sNameWithCode = isGeneralAdmin 
            ? (user.email || 'الأمين العام') 
            : `${servant?.nameStr || servant?.name || 'خادم غير معروف'}${currentCode ? ` - ${currentCode}` : ''}`;

        if (partnerModal.isPhone) {
            updates[`phoneVisitations.${partnerModal.missedFriday}`] = {
                status: 'called',
                servantId: sId,
                servantName: sNameWithCode,
                timestamp
            };
        } else {
            const selectedNames = selectedServants.map(id => {
                const found = servantsInClass.find(sv => sv.id === id);
                if (found) {
                    const code = found.code || found.servantCode || '';
                    return `${found.nameStr || found.name}${code ? ` - ${code}` : ''}`;
                }
                return 'خادم غير معروف';
            });

            updates[`homeVisitations.${currentMonth}`] = {
                status: 'visited',
                servantId: sId,
                servantName: sNameWithCode,
                visitedBy: [sNameWithCode, ...selectedNames],
                visitedByIds: [sId, ...selectedServants],
                partnerId: selectedServants.length > 0 ? 'multi_partner' : null,
                timestamp
            };
        }

        try {
            const batch = writeBatch(db);
            batch.update(stRef, updates);
            setPartnerModal({ show: false, studentId: null, isPhone: false, missedFriday: null });
            setSelectedServants([]);
            batch.commit().catch(err => console.error("Error committing visitation:", err));
        } catch (error) {
            console.error("Error saving visitation:", error);
            alert("حدث خطأ أثناء حفظ الافتقاد");
        }
    };

    const saveLateVisitation = async () => {
        if (!lateModal.studentId || !lateModal.periodKey) return;
        
        const stRef = doc(db, 'students', lateModal.studentId);
        const updates = {};
        const timestamp = new Date().toISOString();

        const sId = isGeneralAdmin ? user.uid : servant?.id;
        
        const currentCode = isGeneralAdmin ? '' : (servant?.code || servant?.servantCode || '');
        const sNameWithCode = isGeneralAdmin 
            ? (user.email || 'الأمين العام') 
            : `${servant?.nameStr || servant?.name || 'خادم غير معروف'}${currentCode ? ` - ${currentCode}` : ''}`;

        if (lateModal.isPhone) {
            updates[`phoneVisitations.${lateModal.periodKey}`] = {
                status: 'late_attended',
                servantId: sId,
                servantName: sNameWithCode,
                timestamp,
                note: lateNote
            };
        } else {
            updates[`homeVisitations.${lateModal.periodKey}`] = {
                status: 'late_attended',
                servantId: sId,
                servantName: sNameWithCode,
                visitedBy: [sNameWithCode],
                visitedByIds: [sId],
                timestamp,
                note: lateNote
            };
        }

        try {
            const batch = writeBatch(db);
            batch.update(stRef, updates);
            setLateModal({ show: false, studentId: null, isPhone: false, periodKey: null });
            setLateNote('');
            alert("تم إدراج الافتقاد المتأخر بنجاح");
            batch.commit().catch(err => console.error("Error committing late visitation:", err));
        } catch (error) {
            console.error("Error saving late visitation:", error);
            alert("حدث خطأ أثناء حفظ الافتقاد المتأخر");
        }
    };

    // Report Logic Computations
    let visitedList = [];
    let notVisitedList = [];
    let attendedFridayList = [];

    let activeReportStudents = [];

    if (selectedReportType === 'home') {
        const monthKey = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
        const selectedDate = new Date(selectedYear, selectedMonth, 0, 23, 59, 59);
        const selectedDateTime = selectedDate.getTime();

        activeReportStudents = reportStudents.filter(st => {
            const studentCreatedTime = getCleanCreatedAtTime(st);
            return selectedDateTime >= studentCreatedTime;
        });
        
        activeReportStudents.forEach(st => {
            const hv = st.homeVisitations || {};
            if (hv[monthKey] && (hv[monthKey].status === 'visited' || hv[monthKey].status === 'late_attended')) {
                visitedList.push(st);
            } else {
                notVisitedList.push(st);
            }
        });
    } else if (selectedReportType === 'phone') {
        if (selectedWeekKey) {
            const wParts = selectedWeekKey.split('-');
            const selectedDate = new Date(parseInt(wParts[0], 10), parseInt(wParts[1], 10) - 1, parseInt(wParts[2], 10), 23, 59, 59);
            const selectedDateTime = selectedDate.getTime();

            activeReportStudents = reportStudents.filter(st => {
                const studentCreatedTime = getCleanCreatedAtTime(st);
                return selectedDateTime >= studentCreatedTime;
            });

            activeReportStudents.forEach(st => {
                const att = st.attendance || [];
                const pv = st.phoneVisitations || {};
                
                const wasPresent = att.some(dStr => isSameLocalDate(dStr, selectedWeekKey));
                
                if (wasPresent) {
                    attendedFridayList.push(st);
                } else {
                    if (pv[selectedWeekKey] && (pv[selectedWeekKey].status === 'called' || pv[selectedWeekKey].status === 'late_attended')) {
                        visitedList.push(st);
                    } else {
                        notVisitedList.push(st);
                    }
                }
            });
        }
    }

    const totalReportStudents = activeReportStudents.length;
    const denominator = selectedReportType === 'home' 
        ? totalReportStudents 
        : (visitedList.length + notVisitedList.length);

    const complianceRate = denominator > 0 
        ? Math.round((visitedList.length / denominator) * 100) 
        : 100;

    const years = [2024, 2025, 2026];
    const months = [
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

    return (
        <div className={isEmbedded ? "w-full" : "max-w-6xl mx-auto px-4 py-8 bg-slate-50 text-slate-900 dark:bg-[#0f172a] dark:text-slate-50 transition-colors duration-300 min-h-[75vh]"} dir="rtl">
            {!isEmbedded && (
                <header className="mb-8 print:hidden">
                    <h1 className="text-3xl font-black text-slate-800 dark:text-slate-100 mb-2">الافتقاد و المتابعه</h1>
                    <p className="text-slate-500 dark:text-slate-400">  من هنا يمكنك متابعة افتقادات فصلك </p>
                </header>
            )}
            
            <div className="mt-4 p-6 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm print:hidden">
                <p className="text-slate-500 dark:text-slate-400 font-bold text-sm mb-3">تصفية بناءً على المرحلة والفصل:</p>
                <div className="flex flex-col sm:flex-row gap-3">
                    {/* Stage selector / display */}
                    {isGeneralAdmin ? (
                        <select
                            className="p-3 bg-white dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold max-w-sm w-full transition-colors duration-300"
                            value={filterStage}
                            onChange={e => { setFilterStage(e.target.value); setFilterClass(''); }}
                        >
                            <option value="">كل المراحل</option>
                            {Object.keys(STAGE_CLASS_MAP).map(s => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    ) : (
                        <div className="p-3 bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-700 dark:text-slate-200 max-w-sm w-full">
                            المرحلة: {filterStage || 'غير محدد'}
                        </div>
                    )}

                    {/* Class selector */}
                    {isGeneralAdmin ? (
                        <select
                            className="p-3 bg-white dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold max-w-sm w-full transition-colors duration-300 disabled:opacity-50"
                            value={filterClass}
                            onChange={e => setFilterClass(e.target.value)}
                            disabled={!filterStage}
                        >
                            <option value="">{filterStage ? 'كل فصول المرحلة' : 'اختر المرحلة أولاً'}</option>
                            {(STAGE_CLASS_MAP[filterStage] || []).map(cls => (
                                <option key={cls} value={cls}>{cls}</option>
                            ))}
                        </select>
                    ) : (
                        <select
                            className="p-3 bg-white dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold max-w-sm w-full transition-colors duration-300"
                            value={filterClass}
                            onChange={e => setFilterClass(e.target.value)}
                        >
                            {myClasses.length > 1 && <option value="">كل الفصول</option>}
                            {myClasses.map(cls => (
                                <option key={cls} value={cls}>{cls}</option>
                            ))}
                        </select>
                    )}
                </div>
            </div>

            <div className="flex gap-4 mt-8 mb-8 border-b border-slate-200 dark:border-slate-800 print:hidden">
                <button 
                    onClick={() => setActiveTab('home')}
                    className={`pb-4 px-4 font-black flex items-center gap-2 border-b-4 transition-all cursor-pointer ${activeTab === 'home' ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                >
                    <Home size={20} /> الافتقاد المنزلي
                </button>
                <button 
                    onClick={() => setActiveTab('phone')}
                    className={`pb-4 px-4 font-black flex items-center gap-2 border-b-4 transition-all cursor-pointer ${activeTab === 'phone' ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                >
                    <PhoneCall size={20} /> الافتقاد التليفوني
                </button>
                {(isGeneralAdmin || isServant) && (
                    <button 
                        onClick={() => setActiveTab('reports')}
                        className={`pb-4 px-4 font-black flex items-center gap-2 border-b-4 transition-all cursor-pointer ${activeTab === 'reports' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                    >
                        <UserCheck size={20} /> كشوف الافتقاد
                    </button>
                )}
            </div>

            {activeTab === 'home' && (
                <div className="space-y-6">
                    {/* Address Search Bar */}
                    <div className="relative max-w-md w-full">
                        <span className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-slate-400 dark:text-slate-500">
                            <MapPin size={20} />
                        </span>
                        <input
                            type="text"
                            value={addressSearch}
                            onChange={e => setAddressSearch(e.target.value)}
                            placeholder="ابحث بالمنطقة أو الشارع (مثال: الأهرام)..."
                            className="w-full max-w-md pr-10 pl-10 p-3 bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                        {addressSearch && (
                            <button 
                                onClick={() => setAddressSearch('')}
                                className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer border-none bg-transparent"
                            >
                                <X size={16} />
                            </button>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 min-h-[40vh]">
                        {/* Home: Needs Visit */}
                        <div className="bg-white dark:bg-[#1e293b]/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm dark:shadow-inner">
                            <div className="flex justify-between items-center pb-3 border-b border-slate-150 dark:border-slate-800/60">
                                <h3 className="font-bold text-orange-800 dark:text-blue-400 flex items-center gap-2">
                                    <Clock size={18} className="text-orange-600 dark:text-blue-400" />
                                    لم يُفتقد بعد
                                </h3>
                                <span className="bg-orange-100 dark:bg-blue-500/10 text-orange-800 dark:text-blue-400 px-3 py-1 rounded-full text-xs font-black">{homeNeedsVisit.length}</span>
                            </div>
                            <div className="space-y-4 max-h-[60vh] overflow-y-auto mt-4 pr-1">
                                {homeNeedsVisit.length === 0 ? <p className="text-center text-slate-400 text-sm py-8">لا يوجد مخدومين هنا</p> : 
                                    homeNeedsVisit.map(st => (
                                        <div key={st.id} className="relative bg-white dark:bg-[#1e293b] hover:bg-slate-50 dark:hover:bg-[#243146] border border-slate-200 dark:border-slate-700/50 rounded-xl p-4 shadow-sm transition-all duration-200">
                                            <h4 className="font-black text-slate-800 dark:text-slate-100 text-lg mb-1 pl-16">{st.name}</h4>
                                            {st.assignedClass && (
                                                <span className="inline-block bg-transparent border-none p-0 text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                                                    {st.assignedClass}
                                                </span>
                                            )}
                                            {st.homeLocation && (
                                                <a 
                                                    href={`https://www.google.com/maps/dir/?api=1&destination=${st.homeLocation.latitude},${st.homeLocation.longitude}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="absolute top-4 left-4 flex items-center gap-1 bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-200 dark:border-blue-900/40 px-2 py-0.5 rounded-lg text-xs font-black hover:bg-blue-100 dark:hover:bg-blue-900/60 shadow-sm transition active:scale-95 cursor-pointer shrink-0"
                                                    title="افتح الاتجاهات على خريطة جوجل"
                                                >
                                                    <MapPin size={11} className="fill-blue-600 dark:fill-blue-400" />
                                                    <span>خريطة 🗺️</span>
                                                </a>
                                            )}
                                            <div className="space-y-1.5 text-sm text-slate-600 dark:text-slate-400 mb-4">
                                                <p className="flex items-center gap-2"><Phone size={14} className="text-slate-400 dark:text-slate-500"/> {st.phones?.[0] || '—'} <span className="font-mono text-xs bg-slate-100 dark:bg-[#0f172a] text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800">{st.code}</span></p>
                                                <p className="flex items-start gap-2">
                                                    <MapPin size={14} className="text-slate-400 dark:text-slate-500 mt-0.5 shrink-0"/> 
                                                    <span>{st.addresses?.[0] || '—'}</span>
                                                </p>
                                            </div>
                                            {(() => {
                                                const contactOptions = getContactOptions(st);
                                                if (contactOptions.length > 0) {
                                                    return (
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                                                            {contactOptions.map((opt, idx) => {
                                                                const bgClass = opt.type === 'father' ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-transparent hover:bg-blue-100 dark:hover:bg-blue-900/30' : opt.type === 'mother' ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-955/20 dark:text-rose-400 dark:border-transparent hover:bg-rose-100 dark:hover:bg-rose-900/30' : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700';
                                                                return (
                                                                    <a 
                                                                        key={idx} 
                                                                        href={`tel:${opt.phone}`} 
                                                                        className={`py-2.5 px-3 border rounded-xl text-xs font-bold transition flex items-center justify-between gap-1 hover:shadow-sm cursor-pointer ${bgClass}`}
                                                                    >
                                                                        <span className="truncate max-w-[85%]">{opt.label}: {opt.phone}</span>
                                                                        <Phone size={12} className="shrink-0"/>
                                                                    </a>
                                                                );
                                                            })}
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            })()}
                                            <button onClick={() => setPartnerModal({ show: true, studentId: st.id, isPhone: false })} className="w-full py-2.5 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-transparent text-orange-700 dark:text-orange-400 rounded-xl text-sm font-bold hover:bg-orange-100 dark:hover:bg-orange-900/30 transition cursor-pointer">
                                                تسجيل زيارة
                                            </button>
                                        </div>
                                    ))
                                }
                            </div>
                        </div>

                        {/* Home: Visited */}
                        <div className="bg-white dark:bg-[#1e293b]/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm dark:shadow-inner">
                            <div className="flex justify-between items-center pb-3 border-b border-slate-150 dark:border-slate-800/60">
                                <h3 className="font-bold text-emerald-800 dark:text-blue-400 flex items-center gap-2">
                                    <CheckCircle size={18} className="text-emerald-600 dark:text-blue-400" />
                                    تم الافتقاد
                                </h3>
                                <span className="bg-emerald-100 dark:bg-blue-500/10 text-emerald-800 dark:text-blue-400 px-3 py-1 rounded-full text-xs font-black">{homeVisited.length}</span>
                            </div>
                            <div className="space-y-4 max-h-[60vh] overflow-y-auto mt-4 pr-1">
                                {homeVisited.length === 0 ? <p className="text-center text-slate-400 text-sm py-8">لا يوجد سجلات هذا الشهر</p> : 
                                    homeVisited.map(st => (
                                        <div key={st.id} className="bg-white dark:bg-[#1e293b] hover:bg-slate-50 dark:hover:bg-[#243146] border border-slate-200 dark:border-slate-700/50 rounded-xl p-4 shadow-sm transition-all duration-200">
                                            <div className="flex justify-between items-start gap-2">
                                                <div className="flex-1">
                                                    <h4 className="font-black text-slate-800 dark:text-slate-100 text-lg mb-1">{st.name}</h4>
                                                    <div className="text-xs text-slate-500 dark:text-slate-400 font-bold space-y-1 flex flex-col gap-1">
                                                        <span className="text-slate-500 dark:text-slate-200">الخدام المسؤولين: <span className="text-slate-700 dark:text-white font-black">{st.homeVisitations[currentMonth].visitedBy ? st.homeVisitations[currentMonth].visitedBy.join(' ، ') : st.homeVisitations[currentMonth].servantName}</span></span>
                                                        {!st.homeVisitations[currentMonth].visitedBy && st.homeVisitations[currentMonth].partnerId && <span>ومشاركة خادم آخر</span>}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        if (window.confirm(`هل أنت متأكد من التراجع عن افتقاد ${st.name}؟`)) {
                                                            const stRef = doc(db, 'students', st.id);
                                                            updateDoc(stRef, {
                                                                [`homeVisitations.${currentMonth}`]: deleteField()
                                                            }).catch(err => console.error('خطأ في التراجع:', err));
                                                        }
                                                    }}
                                                    className="p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-all shrink-0"
                                                    title="تراجع عن الافتقاد"
                                                >
                                                    <Undo2 size={18} />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                }
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'phone' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 min-h-[40vh]">
                    {/* Phone: Needs Call */}
                    <div className="bg-white dark:bg-[#1e293b]/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm dark:shadow-inner">
                        <div className="flex justify-between items-center pb-3 border-b border-slate-150 dark:border-slate-800/60">
                            <h3 className="font-bold text-blue-800 dark:text-emerald-400 flex items-center gap-2">
                                <PhoneCall size={18} className="text-blue-600 dark:text-emerald-400" />
                                يحتاج لاتصال
                            </h3>
                            <span className="bg-blue-100 dark:bg-emerald-500/10 text-blue-800 dark:text-emerald-400 px-3 py-1 rounded-full text-xs font-black">{phoneNeedsCall.length}</span>
                        </div>
                        <div className="space-y-4 max-h-[60vh] overflow-y-auto mt-4 pr-1">
                            {phoneNeedsCall.length === 0 ? <p className="text-center text-slate-400 text-sm py-8">الجميع حضر الجمعة الماضية!</p> : 
                                phoneNeedsCall.map(st => (
                                    <div key={st.id} className="bg-white dark:bg-[#1e293b] hover:bg-slate-50 dark:hover:bg-[#243146] border border-slate-200 dark:border-slate-700/50 rounded-xl p-4 shadow-sm transition-all duration-200">
                                        <h4 className="font-black text-slate-800 dark:text-slate-100 text-lg mb-1">{st.name}</h4>
                                        {st.assignedClass && (
                                            <span className="inline-block bg-transparent border-none p-0 text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                                                {st.assignedClass}
                                            </span>
                                        )}
                                        {(() => {
                                            const contactOptions = getContactOptions(st);
                                            if (contactOptions.length > 0) {
                                                return (
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                                                        {contactOptions.map((opt, idx) => {
                                                            const bgClass = opt.type === 'father' ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-transparent hover:bg-blue-100 dark:hover:bg-blue-900/30' : opt.type === 'mother' ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-955/20 dark:text-rose-400 dark:border-transparent hover:bg-rose-100 dark:hover:bg-rose-900/30' : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700';
                                                            return (
                                                                <a 
                                                                    key={idx} 
                                                                    href={`tel:${opt.phone}`} 
                                                                    onClick={(e) => {
                                                                        setPartnerModal({ show: true, studentId: st.id, isPhone: true, missedFriday: lastFridayStr });
                                                                    }}
                                                                    className={`py-2.5 px-3 border rounded-xl text-xs font-bold transition flex items-center justify-between gap-1 hover:shadow-sm cursor-pointer ${bgClass}`}
                                                                >
                                                                    <span className="truncate max-w-[85%]">{opt.label}: {opt.phone}</span>
                                                                    <Phone size={12} className="shrink-0"/>
                                                                </a>
                                                            );
                                                        })}
                                                    </div>
                                                );
                                            }
                                            return (
                                                <div className="text-sm font-semibold text-slate-450 dark:text-slate-500 mb-4 text-center">
                                                    لا يوجد رقم هاتف مسجل
                                                </div>
                                            );
                                        })()}
                                        <button onClick={() => setPartnerModal({ show: true, studentId: st.id, isPhone: true, missedFriday: lastFridayStr })} className="w-full py-2.5 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-transparent text-blue-700 dark:text-blue-400 rounded-xl text-sm font-bold hover:bg-blue-100 dark:hover:bg-blue-900/30 transition cursor-pointer">
                                            تسجيل المكالمة
                                        </button>
                                    </div>
                                ))
                            }
                        </div>
                    </div>

                    {/* Phone: Called */}
                    <div className="bg-white dark:bg-[#1e293b]/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm dark:shadow-inner">
                        <div className="flex justify-between items-center pb-3 border-b border-slate-150 dark:border-slate-800/60">
                            <h3 className="font-bold text-emerald-800 dark:text-emerald-400 flex items-center gap-2">
                                <UserCheck size={18} className="text-emerald-600 dark:text-emerald-400" />
                                تم التواصل
                            </h3>
                            <span className="bg-emerald-100 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 px-3 py-1 rounded-full text-xs font-black">{phoneCalled.length}</span>
                        </div>
                        <div className="space-y-4 max-h-[60vh] overflow-y-auto mt-4 pr-1">
                            {phoneCalled.length === 0 ? <p className="text-center text-slate-400 text-sm py-8">لا يوجد مكالمات ليوم الجمعة الماضي</p> : 
                                phoneCalled.map(st => (
                                    <div key={st.id} className="bg-white dark:bg-[#1e293b] hover:bg-slate-50 dark:hover:bg-[#243146] border border-slate-200 dark:border-slate-700/50 rounded-xl p-4 shadow-sm transition-all duration-200">
                                        <div className="flex justify-between items-start gap-2">
                                            <div className="flex-1">
                                                <h4 className="font-black text-slate-800 dark:text-slate-100 text-lg mb-1">{st.name}</h4>
                                                <div className="text-xs text-slate-550 dark:text-slate-400 font-bold space-y-1">
                                                    <p className="text-slate-500 dark:text-slate-200">تم المتابعة الهاتفية بنجاح</p>
                                                    {st.phoneVisitations?.[lastFridayStr]?.servantName && (
                                                        <p className="text-slate-400 dark:text-slate-400 text-[10px]">
                                                            بواسطة: <span className="text-slate-600 dark:text-slate-200 font-black">{st.phoneVisitations[lastFridayStr].servantName}</span>
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => {
                                                    if (window.confirm(`هل أنت متأكد من التراجع عن الاتصال بـ${st.name}؟`)) {
                                                        const stRef = doc(db, 'students', st.id);
                                                        updateDoc(stRef, {
                                                            [`phoneVisitations.${lastFridayStr}`]: deleteField()
                                                        }).catch(err => console.error('خطأ في التراجع:', err));
                                                    }
                                                }}
                                                className="p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-all shrink-0"
                                                title="تراجع عن الاتصال"
                                            >
                                                <Undo2 size={18} />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            }
                        </div>
                    </div>
                </div>
            )}
            {activeTab === 'reports' && (
                <div className="space-y-8 animate-in fade-in duration-300">
                    {/* Filters Container */}
                    <div className="bg-white dark:bg-[#1e293b] rounded-3xl p-6 shadow-sm border border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-6 print:hidden">
                        {/* 1. Visitation Type */}
                        <div>
                            <label className="block text-sm font-bold text-slate-600 dark:text-slate-400 mb-2 flex items-center gap-2">
                                <Users size={16} className="text-slate-400" /> نوع الافتقاد
                            </label>
                            <select
                                className="w-full p-4 bg-white dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold transition duration-300"
                                value={selectedReportType}
                                onChange={(e) => {
                                    setSelectedReportType(e.target.value);
                                }}
                            >
                                <option value="home">الافتقاد المنزلي (شهري)</option>
                                <option value="phone">الافتقاد التليفوني (أسبوعي)</option>
                            </select>
                        </div>

                        {/* 2. Dynamic Date Selection */}
                        <div>
                            {selectedReportType === 'home' ? (
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="block text-sm font-bold text-slate-600 dark:text-slate-400 mb-2 flex items-center gap-2">
                                            <Calendar size={16} className="text-slate-400" /> الشهر
                                        </label>
                                        <select
                                            className="w-full p-4 bg-white dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-700 dark:text-slate-200 transition"
                                            value={selectedMonth}
                                            onChange={(e) => setSelectedMonth(Number(e.target.value))}
                                        >
                                            {months.map(m => (
                                                <option key={m.value} value={m.value}>{m.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-slate-600 dark:text-slate-400 mb-2">السنة</label>
                                        <select
                                            className="w-full p-4 bg-white dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-700 dark:text-slate-200 transition"
                                            value={selectedYear}
                                            onChange={(e) => setSelectedYear(Number(e.target.value))}
                                        >
                                            {years.map(y => (
                                                <option key={y} value={y}>{y}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-sm font-bold text-slate-600 dark:text-slate-400 mb-2 flex items-center gap-2">
                                        <Calendar size={16} className="text-slate-400" /> الأسبوع
                                    </label>
                                    <select
                                        className="w-full p-4 bg-white dark:bg-[#1e293b] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-700 dark:text-slate-200 transition"
                                        value={selectedWeekKey}
                                        onChange={(e) => setSelectedWeekKey(e.target.value)}
                                    >
                                        {weeksList.map(w => (
                                            <option key={w.key} value={w.key}>{w.label}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Report Output */}
                    {!selectedClass && !reportStage ? (
                        <div className="py-20 text-center bg-white dark:bg-[#1e293b] rounded-3xl border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center gap-4">
                            <Clock size={64} className="text-slate-300 dark:text-slate-600 animate-pulse" />
                            <p className="text-xl font-bold text-slate-400 dark:text-slate-400">برجاء اختيار المرحلة والفصل لعرض كشف الافتقاد</p>
                        </div>
                    ) : reportLoading ? (
                        <div className="py-20 text-center space-y-4">
                            <div className="w-12 h-12 border-4 border-slate-200 dark:border-slate-800 border-t-indigo-600 rounded-full animate-spin mx-auto"></div>
                            <p className="text-xl font-bold text-slate-400 dark:text-slate-500">جاري جلب البيانات من Firestore...</p>
                        </div>
                    ) : (
                        <div className="space-y-8">
                            {/* Dashboard Stats */}
                            <div className="bg-gradient-to-r from-indigo-50/50 to-blue-50/50 dark:from-indigo-950/10 dark:to-blue-950/10 border border-indigo-100/60 dark:border-indigo-900/30 rounded-3xl p-6 md:p-8 flex flex-col md:flex-row justify-between items-center gap-6">
                                <div className="space-y-2 text-center md:text-right">
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 print:hidden">
                                        <h3 className="text-2xl font-black text-slate-800 dark:text-slate-100">
                                            {selectedReportType === 'home' ? 'تقرير الافتقاد المنزلي' : 'تقرير الافتقاد التليفوني'}
                                        </h3>
                                        <div className="flex gap-2">
                                            {(visitedList.length > 0 || notVisitedList.length > 0) && (
                                                <button 
                                                    type="button"
                                                    onClick={handleExportReportExcel}
                                                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow transition-all flex items-center justify-center gap-2 cursor-pointer border-none text-sm"
                                                    title="تصدير تقرير الافتقاد لإكسيل"
                                                >
                                                    <FileSpreadsheet size={16} />
                                                    <span>تصدير لإكسيل</span>
                                                </button>
                                            )}
                                            <button 
                                                type="button"
                                                onClick={() => window.print()}
                                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow transition-all flex items-center justify-center gap-2 cursor-pointer border-none text-sm"
                                            >
                                                <Printer size={16} />
                                                <span>طباعة التقرير</span>
                                            </button>
                                        </div>
                                    </div>
                                    <h3 className="text-2xl font-black text-slate-800 dark:text-slate-100 hidden print:block">
                                        {selectedReportType === 'home' ? 'تقرير الافتقاد المنزلي' : 'تقرير الافتقاد التليفوني'}
                                    </h3>
                                    <p className="text-slate-600 dark:text-slate-300 font-bold">
                                        الفصل: <span className="text-indigo-600 dark:text-indigo-400 font-black">{selectedClass || 'كل الفصول'}</span>
                                    </p>
                                    <p className="text-sm text-slate-500 dark:text-slate-400 font-semibold">
                                        {selectedReportType === 'home' 
                                            ? `الفترة: شهر ${selectedMonth} سنة ${selectedYear}`
                                            : `الفترة: الأسبوع المحدد من خلال الجمعة الموافق ${selectedWeekKey}`}
                                    </p>
                                </div>

                                <div className="flex flex-wrap justify-center gap-8 items-center">
                                    <div className="text-center">
                                        <p className="text-slate-500 dark:text-slate-400 font-bold text-sm">إجمالي الطلاب</p>
                                        <p className="text-3xl font-black text-slate-800 dark:text-slate-200">{totalReportStudents}</p>
                                    </div>
                                    
                                    {selectedReportType === 'phone' && (
                                        <div className="text-center">
                                            <p className="text-slate-500 dark:text-slate-400 font-bold text-sm">حاضرين الجمعة</p>
                                            <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400">{attendedFridayList.length}</p>
                                        </div>
                                    )}

                                    <div className="text-center">
                                        <p className="text-slate-500 dark:text-slate-400 font-bold text-sm">تم الافتقاد</p>
                                        <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400">{visitedList.length}</p>
                                    </div>

                                    <div className="text-center">
                                        <p className="text-slate-500 dark:text-slate-400 font-bold text-sm">لم يتم الافتقاد</p>
                                        <p className="text-3xl font-black text-rose-500 dark:text-rose-400">{notVisitedList.length}</p>
                                    </div>

                                    {/* Radial Progress Ring */}
                                    <div className="flex items-center gap-3 bg-white dark:bg-[#1e293b] px-5 py-3 rounded-2xl border border-indigo-100 dark:border-indigo-900/50 shadow-sm">
                                        <div className="relative flex items-center justify-center">
                                            <svg className="w-16 h-16 transform -rotate-90">
                                                <circle cx="32" cy="32" r="26" className="stroke-slate-100 dark:stroke-slate-800" strokeWidth="6" fill="transparent" />
                                                <circle cx="32" cy="32" r="26" className="stroke-indigo-600 dark:stroke-indigo-500 transition-all duration-500" strokeWidth="6" fill="transparent"
                                                    strokeDasharray={2 * Math.PI * 26}
                                                    strokeDashoffset={2 * Math.PI * 26 * (1 - complianceRate / 100)}
                                                />
                                            </svg>
                                            <span className="absolute text-sm font-black text-slate-700 dark:text-slate-300">{complianceRate}%</span>
                                        </div>
                                        <div>
                                            <p className="text-xs font-bold text-slate-400 dark:text-slate-500">نسبة التغطية</p>
                                            <p className="text-sm font-black text-slate-700 dark:text-slate-300">نسبة الافتقاد</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Main Split Lists */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* Visited List (Green Theme) */}
                                <div className="bg-white dark:bg-[#1e293b] rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm flex flex-col">
                                    <div className="bg-emerald-50/40 dark:bg-emerald-950/20 p-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                                        <h4 className="font-black text-emerald-800 dark:text-emerald-400 flex items-center gap-2">
                                            <CheckCircle size={20} className="text-emerald-600" /> تم الافتقاد
                                        </h4>
                                        <div className="flex items-center gap-2">
                                            {visitedList.length > 0 && (
                                                <button 
                                                    type="button"
                                                    onClick={() => handleExportExcel(visitedList, 'تم الافتقاد')}
                                                    className="p-1 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer border-none bg-transparent"
                                                    title="تصدير القائمة إلى إكسيل"
                                                >
                                                    <FileSpreadsheet size={16} />
                                                </button>
                                            )}
                                            <span className="bg-emerald-100 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 px-3 py-1 rounded-full text-xs font-black">
                                                {visitedList.length} طالب
                                            </span>
                                        </div>
                                    </div>

                                    <div className="p-6 space-y-4 flex-grow max-h-[60vh] overflow-y-auto print:max-h-none print:overflow-visible">
                                        {visitedList.length === 0 ? (
                                            <p className="text-center text-slate-400 text-sm py-12">لا يوجد سجلات مطابقة لهذه الفترة</p>
                                        ) : (
                                            visitedList.map(st => {
                                                const record = selectedReportType === 'home' 
                                                    ? st.homeVisitations?.[`${selectedYear}-${String(selectedMonth).padStart(2, '0')}`]
                                                    : st.phoneVisitations?.[selectedWeekKey];
                                                
                                                return (
                                                    <div key={st.id} className="p-4 border border-slate-100 dark:border-slate-800 rounded-2xl bg-slate-50/20 dark:bg-slate-900/10 hover:border-emerald-300/40 dark:hover:border-emerald-900/30 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
                                                        <div className="flex justify-between items-start mb-2">
                                                            <h5 className="font-black text-slate-800 dark:text-slate-200 text-base flex items-center gap-2">
                                                                <span>{st.name}</span>
                                                                {st.assignedClass && !selectedClass && (
                                                                    <span className="text-[10px] bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-md border border-blue-100 dark:border-transparent font-medium">
                                                                        {st.assignedClass}
                                                                    </span>
                                                                )}
                                                            </h5>
                                                            <span className="font-mono text-xs bg-slate-100 dark:bg-slate-900 text-slate-500 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-800">
                                                                #{st.code}
                                                            </span>
                                                        </div>

                                                        {record && (
                                                            <div className="text-xs text-slate-500 dark:text-slate-400 font-bold space-y-1 mt-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                                                                {record.status === 'late_attended' && (
                                                                    <div className="mb-2">
                                                                        <span className="inline-block bg-amber-100 dark:bg-amber-955/30 text-amber-800 dark:text-amber-400 text-[10px] font-black px-2 py-0.5 rounded border border-amber-200 dark:border-amber-900/50">
                                                                            افتقاد متأخر
                                                                        </span>
                                                                    </div>
                                                                )}
                                                                <p className="text-slate-500 dark:text-slate-200">
                                                                    {selectedReportType === 'home' ? 'الخدام المسؤولين: ' : 'الخادم المتصل: '}
                                                                    <span className="text-slate-700 dark:text-white font-black">
                                                                        {record.visitedBy ? record.visitedBy.join(' ، ') : (record.servantName || 'خادم غير معروف')}
                                                                    </span>
                                                                </p>
                                                                {!record.visitedBy && record.partnerId && <p className="text-indigo-600 dark:text-indigo-400">بمشاركة خادم آخر</p>}
                                                                {record.timestamp && (
                                                                    <p className="text-[10px] text-slate-400 dark:text-slate-500">
                                                                        تاريخ التسجيل: {new Date(record.timestamp).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                                    </p>
                                                                )}
                                                                {record.note && (
                                                                    <p className="text-slate-600 dark:text-slate-350 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-2 rounded-lg mt-2 font-medium italic">
                                                                        ملاحظة: {record.note}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>

                                {/* Not Visited List (Orange Warning Theme) */}
                                <div className="bg-white dark:bg-[#1e293b] rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm flex flex-col">
                                    <div className="bg-orange-50/40 dark:bg-orange-950/20 p-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                                        <h4 className="font-black text-orange-800 dark:text-orange-400 flex items-center gap-2">
                                            <AlertCircle size={20} className="text-orange-600" /> لم يتم الافتقاد
                                        </h4>
                                        <div className="flex items-center gap-2">
                                            {notVisitedList.length > 0 && (
                                                <button 
                                                    type="button"
                                                    onClick={() => handleExportExcel(notVisitedList, 'لم يتم الافتقاد')}
                                                    className="p-1 text-slate-400 hover:text-orange-600 dark:hover:text-orange-400 transition-colors cursor-pointer border-none bg-transparent"
                                                    title="تصدير القائمة إلى إكسيل"
                                                >
                                                    <FileSpreadsheet size={16} />
                                                </button>
                                            )}
                                            <span className="bg-orange-100 dark:bg-orange-950/30 text-orange-800 dark:text-orange-300 px-3 py-1 rounded-full text-xs font-black">
                                                {notVisitedList.length} طالب
                                            </span>
                                        </div>
                                    </div>

                                    <div className="p-6 space-y-4 flex-grow max-h-[60vh] overflow-y-auto print:max-h-none print:overflow-visible">
                                        {notVisitedList.length === 0 ? (
                                            <div className="text-center py-12 space-y-2">
                                                <CheckCircle size={40} className="text-emerald-500 mx-auto" />
                                                <p className="text-emerald-600 dark:text-emerald-400 font-black text-base">رائع! جميع مخدومي الفصل تم افتقادهم في هذه الفترة</p>
                                            </div>
                                        ) : (
                                            notVisitedList.map(st => (
                                                <div key={st.id} className="relative p-4 border border-slate-100 dark:border-slate-800 rounded-2xl bg-slate-50/20 dark:bg-slate-900/10 hover:border-orange-300/40 dark:hover:border-orange-900/30 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
                                                    <div className="flex items-center gap-2 mb-2 pr-0 pl-16">
                                                        <h5 className="font-black text-slate-800 dark:text-slate-200 text-base">{st.name}</h5>
                                                        {st.assignedClass && !selectedClass && (
                                                            <span className="text-[10px] bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-md border border-blue-100 dark:border-transparent font-medium mr-2">
                                                                {st.assignedClass}
                                                            </span>
                                                        )}
                                                        <span className="font-mono text-xs bg-slate-100 dark:bg-slate-900 text-slate-500 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-800">
                                                            #{st.code}
                                                        </span>
                                                    </div>

                                                    {st.homeLocation && (
                                                        <a 
                                                            href={`https://www.google.com/maps/dir/?api=1&destination=${st.homeLocation.latitude},${st.homeLocation.longitude}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="absolute top-4 left-4 flex items-center gap-1 bg-blue-50 text-blue-600 dark:bg-blue-955/40 dark:text-blue-400 border border-blue-200 dark:border-blue-900/40 px-2 py-0.5 rounded-lg text-[10px] font-black hover:bg-blue-100 dark:hover:bg-blue-900/60 shadow-sm transition active:scale-95 cursor-pointer shrink-0"
                                                            title="افتح الاتجاهات على خريطة جوجل"
                                                        >
                                                            <MapPin size={10} className="fill-blue-600 dark:fill-blue-400" />
                                                            <span>خريطة 🗺️</span>
                                                        </a>
                                                    )}

                                                    <div className="space-y-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 mt-3 pt-2 border-t border-slate-150 dark:border-slate-800/50">
                                                        <div className="flex items-center gap-2">
                                                            <Phone size={13} className="text-slate-400 dark:text-slate-500" />
                                                            {(() => {
                                                                const contactOptions = getContactOptions(st);
                                                                if (contactOptions.length > 0) {
                                                                    return (
                                                                        <div className="flex flex-wrap gap-2">
                                                                            {contactOptions.map((opt, i) => {
                                                                                const labelColor = opt.type === 'father' ? 'text-blue-600 dark:text-blue-400' : opt.type === 'mother' ? 'text-rose-600 dark:text-rose-400' : 'text-indigo-650 dark:text-indigo-400';
                                                                                return (
                                                                                    <a key={i} href={`tel:${opt.phone}`} className={`font-bold hover:underline ${labelColor}`} dir="ltr">
                                                                                        {opt.label}: {opt.phone}
                                                                                    </a>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    );
                                                                }
                                                                return <span className="text-slate-400 dark:text-slate-500">لا يوجد رقم تليفون مسجل</span>;
                                                            })()}
                                                        </div>
                                                        <div className="flex items-start gap-2 w-full">
                                                            <MapPin size={13} className="text-slate-400 dark:text-slate-500 mt-0.5 shrink-0" />
                                                            <span className="text-slate-700 dark:text-slate-300 break-words">{st.addresses?.[0] || 'لا يوجد عنوان مسجل'}</span>
                                                        </div>
                                                    </div>
                                                    <button 
                                                        onClick={() => setLateModal({
                                                            show: true,
                                                            studentId: st.id,
                                                            isPhone: selectedReportType === 'phone',
                                                            periodKey: selectedReportType === 'home' 
                                                                ? `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`
                                                                : selectedWeekKey
                                                        })}
                                                        className="w-full mt-4 py-2 bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 rounded-xl text-xs font-bold hover:bg-orange-200 dark:hover:bg-orange-900/30 transition print:hidden"
                                                    >
                                                        إدراج افتقاد متأخر
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Attended Section for Phone Report */}
                            {selectedReportType === 'phone' && attendedFridayList.length > 0 && (
                                <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-3xl p-6">
                                    <div className="flex justify-between items-center mb-4">
                                        <h4 className="font-black text-slate-700 dark:text-slate-300 flex items-center gap-2">
                                            <UserCheck size={18} className="text-slate-500" /> مخدومين حضروا يوم الجمعة ({attendedFridayList.length})
                                        </h4>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 font-bold">لا يحتاجون لاتصال هاتفي</p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {attendedFridayList.map(st => (
                                            <span key={st.id} className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-xl text-xs flex items-center gap-1">
                                                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                                                {st.name}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Action Partner Modal */}
            {partnerModal.show && (
                <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-[#1e293b] rounded-3xl w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-800 p-6 animate-in zoom-in-95 duration-200">
                        <h3 className="text-2xl font-black text-slate-800 dark:text-slate-100 mb-4">{partnerModal.isPhone ? 'تأكيد التواصل الهاتفي' : 'تأكيد الافتقاد المنزلي'}</h3>
                        
                        {!partnerModal.isPhone && getServantsForCurrentStudent().length > 0 && (
                            <div className="mb-6">
                                <label className="block text-sm font-bold text-slate-600 dark:text-slate-400 mb-3">الخدام المشاركون في الزيارة: (اختياري)</label>
                                <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-2xl p-3 bg-slate-50 dark:bg-slate-900/50 space-y-2 text-right" dir="rtl">
                                    {getServantsForCurrentStudent().map(s => {
                                        const servantName = s.nameStr || s.name;
                                        const code = s.code || s.servantCode || '';
                                        const displayName = `${servantName}${code ? ` - ${code}` : ''}`;
                                        const isSelected = selectedServants.includes(s.id);
                                        return (
                                            <label 
                                                key={s.id} 
                                                className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border ${
                                                    isSelected 
                                                        ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900/50 text-blue-900 dark:text-blue-200' 
                                                        : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                                                }`}
                                            >
                                                <input 
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setSelectedServants([...selectedServants, s.id]);
                                                        } else {
                                                            setSelectedServants(selectedServants.filter(id => id !== s.id));
                                                        }
                                                    }}
                                                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                                                />
                                                <span className="font-bold text-sm select-none">{displayName}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {!partnerModal.isPhone && getServantsForCurrentStudent().length === 0 && (
                            <p className="text-sm font-bold text-amber-800 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-4 rounded-xl mb-6">أنت الخادم الوحيد المسجل لهذا الفصل. سيتم تسجيل الافتقاد فردياً.</p>
                        )}
                        
                        {partnerModal.isPhone && (
                            <p className="text-sm font-bold text-blue-800 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 p-4 rounded-xl mb-6">سيتم تسجيل أنك تواصلت مع المخدوم اليوم بخصوص غياب الجمعة الموافق: {partnerModal.missedFriday}</p>
                        )}

                        <div className="flex gap-4">
                            <button onClick={() => {setPartnerModal({ show: false, studentId: null, isPhone: false, missedFriday: null }); setSelectedServants([]);}} className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700">إلغاء</button>
                            <button onClick={markVisitation} className={`flex-1 py-4 font-bold rounded-xl text-white shadow-md transition-colors ${partnerModal.isPhone ? 'bg-blue-600 hover:bg-blue-700' : 'bg-orange-500 hover:bg-orange-600'}`}>
                                تأكيد التسجيل
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Action Late Visitation Modal */}
            {(() => {
                if (!lateModal.show) return null;
                const student = students.find(s => s.id === lateModal.studentId) || reportStudents.find(s => s.id === lateModal.studentId);
                const phones = getStudentPhones(student);

                return (
                    <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                        <div className="bg-white dark:bg-[#1e293b] rounded-3xl w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-800 p-6 animate-in zoom-in-95 duration-200" dir="rtl">
                            <h3 className="text-2xl font-black text-slate-800 dark:text-slate-100 mb-4">تسجيل افتقاد متأخر</h3>
                            
                            <p className="text-sm font-bold text-amber-800 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-4 rounded-xl mb-4">
                                سيتم تسجيل هذا الافتقاد كـ (افتقاد متأخر) للفترة: {lateModal.periodKey} للمخدوم: {student?.name}
                            </p>

                            <div className="mb-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-4 rounded-2xl">
                                {contactOptions.length === 0 ? (
                                    <p className="text-sm font-bold text-slate-400 dark:text-slate-500 text-center py-2">لا يوجد أرقام هواتف مسجلة لهذا الطالب</p>
                                ) : contactOptions.length === 1 ? (
                                    <a 
                                        href={`tel:${contactOptions[0].phone}`} 
                                        className="inline-flex items-center justify-center gap-2 w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md transition-colors text-center"
                                    >
                                        <Phone size={16} /> اتصل الآن بالرقم ({contactOptions[0].label}: {contactOptions[0].phone})
                                    </a>
                                ) : (
                                    <div className="space-y-2">
                                        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">اختر الرقم للاتصال:</p>
                                        <div className="grid grid-cols-1 gap-2">
                                            {contactOptions.map((opt, i) => {
                                                const bgClass = opt.type === 'father' ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-955/20 dark:text-blue-400 dark:border-transparent hover:bg-blue-105' : opt.type === 'mother' ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-955/20 dark:text-rose-400 dark:border-transparent hover:bg-blue-105' : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 hover:bg-slate-200';
                                                return (
                                                    <a 
                                                        key={i} 
                                                        href={`tel:${opt.phone}`} 
                                                        className={`inline-flex items-center justify-between gap-2 py-2.5 px-4 rounded-xl font-bold transition-colors text-xs cursor-pointer ${bgClass}`}
                                                    >
                                                        <span>{opt.label}: {opt.phone}</span>
                                                        <Phone size={14} />
                                                    </a>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="mb-6">
                                <label className="block text-sm font-bold text-slate-600 dark:text-slate-400 mb-2">ملاحظات الافتقاد</label>
                                <textarea 
                                    className="w-full p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 font-bold text-slate-700 dark:text-slate-200 h-28 resize-none"
                                    placeholder="اكتب ملاحظة الزيارة أو المكالمة هنا..."
                                    value={lateNote}
                                    onChange={(e) => setLateNote(e.target.value)}
                                />
                            </div>

                            <div className="flex gap-4">
                                <button onClick={() => {setLateModal({ show: false, studentId: null, isPhone: false, periodKey: null }); setLateNote('');}} className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700">إلغاء</button>
                                <button onClick={saveLateVisitation} className="flex-1 py-4 font-bold rounded-xl text-white shadow-md bg-amber-500 hover:bg-amber-600 transition-colors">
                                    تأكيد الحفظ
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}