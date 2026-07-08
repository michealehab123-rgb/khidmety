import { useState, useEffect, useMemo } from 'react';
import { db, collection, query, where, onSnapshot, doc, updateDoc, setDoc, getDoc, deleteDoc, addDoc, orderBy, limit } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { 
    Users, Filter, MessageSquare, Copy, ExternalLink, RefreshCw, 
    Search, Check, AlertCircle, Sparkles, X, Info, Smartphone,
    Clock, Calendar, Bell, List, Trash2
} from 'lucide-react';

const STAGE_CLASS_MAP = {
    'ابتدائي': ['حضانة/ملائكة', 'أولى ابتدائى', 'ثانية ابتدائى', 'ثالثة ابتدائى', 'رابعة ابتدائى', 'خامسة ابتدائى', 'سادسة ابتدائي'],
    'اعدادي': ['اولي اعدادي', 'تانيه اعدادي', 'تالته اعدادي'],
    'ثانوي': ['اولي ثانوي', 'تانيه ثانوي', 'تالته ثانوي'],
};

// Guess gender from student name to determine default greeting
const guessGender = (fullName) => {
    if (!fullName) return 'boy';
    const firstName = fullName.trim().split(' ')[0];
    if (!firstName) return 'boy';
    
    const femaleNames = [
        'مريم', 'ماريا', 'مارينا', 'دميانه', 'جيرمين', 'فبرونيا', 'مارتينا', 'جوليا', 'يوستينا', 
        'كيرمينا', 'ساندرا', 'ساره', 'كارين', 'ميرنا', 'هيلانه', 'ايريني', 'شيري', 'فيرونيكا', 
        'بربارة', 'مهرائيل', 'ميرا', 'ميرال', 'ناردين', 'سنتيا', 'ماري', 'سوزان', 'تيريزا',
        'ميرفت', 'دينا', 'مها', 'مني', 'نهي', 'هبه', 'ندي', 'نور', 'شرين', 'رانيا', 'روجينا'
    ];
    
    // Normalize arabic characters for comparison
    const normalize = (str) => str
        .replace(/[أإآا]/g, 'ا')
        .replace(/[ىي]/g, 'ي')
        .replace(/[ةه]/g, 'ه');
        
    const normFirst = normalize(firstName);
    const isFemale = femaleNames.some(fn => normalize(fn) === normFirst);
    if (isFemale) return 'girl';
    
    // Arabic names ending with these letters are typically female
    if (firstName.endsWith('ة') || firstName.endsWith('ه') || firstName.endsWith('ا') || firstName.endsWith('ى')) {
        return 'girl';
    }
    
    return 'boy';
};

// Normalize arabic characters for search
const normalizeArabic = (str) => {
    if (!str) return '';
    return str
        .replace(/[أإآا]/g, 'ا')
        .replace(/[ىي]/g, 'ي')
        .replace(/[ةه]/g, 'ه')
        .trim();
};

const generateWeeks = () => {
    const weeks = [];
    const startFriday = new Date(2026, 6, 3); // 2026-07-03 (July is index 6)
    const today = new Date();
    
    const currentFriday = new Date();
    currentFriday.setDate(today.getDate() - ((today.getDay() + 2) % 7));
    currentFriday.setHours(0, 0, 0, 0);

    let tempFriday = new Date(currentFriday);
    while (tempFriday >= startFriday) {
        const friday = new Date(tempFriday);
        const thursday = new Date(friday);
        thursday.setDate(friday.getDate() + 6);
        thursday.setHours(23, 59, 59, 999);
        
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
        
        tempFriday.setDate(tempFriday.getDate() - 7);
    }
    
    if (weeks.length === 0) {
        const thursday = new Date(startFriday);
        thursday.setDate(startFriday.getDate() + 6);
        const label = `الجمعة ${startFriday.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' })} - الخميس ${thursday.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        weeks.push({
            key: '2026-07-03',
            label: label,
            fridayDate: startFriday,
            thursdayDate: thursday
        });
    }
    return weeks;
};

const getFridaysInMonth = (month, year) => {
    const fridays = [];
    const date = new Date(year, month - 1, 1);
    while (date.getMonth() === month - 1) {
        if (date.getDay() === 5) { // 5 is Friday
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            fridays.push(`${y}-${m}-${d}`);
        }
        date.setDate(date.getDate() + 1);
    }
    return fridays;
};

const countFridaysForStudentInMonth = (student, month, year) => {
    let count = 0;
    const date = new Date(year, month - 1, 1);
    
    // Get student creation time
    let createdAtTime = 0;
    if (student.createdAt) {
        if (typeof student.createdAt.toDate === 'function') {
            createdAtTime = student.createdAt.toDate().getTime();
        } else if (typeof student.createdAt.seconds === 'number') {
            createdAtTime = student.createdAt.seconds * 1000;
        } else {
            const t = new Date(student.createdAt).getTime();
            if (!isNaN(t)) createdAtTime = t;
        }
    }

    while (date.getMonth() === month - 1) {
        if (date.getDay() === 5) { // 5 is Friday
            // Construct Friday end time (23:59:59) so if registered on that Friday, it counts
            const fridayEnd = new Date(year, month - 1, date.getDate(), 23, 59, 59).getTime();
            if (createdAtTime === 0 || fridayEnd >= createdAtTime) {
                count++;
            }
        }
        date.setDate(date.getDate() + 1);
    }
    return count > 0 ? count : 1;
};

const DEFAULT_MONTHLY_TEMPLATE = `"فَرِحْتُ بِالْقَائِلِينَ لِي: إِلَى بَيْتِ الرَّبِّ نَذْهَبُ" (مز 122)

سلام ونعمة يا فندم من خدمة مدارس أحد {stageClass}.
حابين نشارك مع حضراتكم تقرير {genderLabel} {firstName} خلال هذا الشهر:
⛪ حضور القداس الإلهي: {massCount}
🏫 حضور حوش الخدمة: {serviceCount}
🕊️ جلسة الاعتراف والافتقاد الدوري: {confessionStatus}.
📝 ملاحظات الخدمة: {notes}
صلوا لأجل الخدمة دائماً.`;

const DEFAULT_WEEKLY_TEMPLATE = `"فَرِحْتُ بِالْقَائِلِينَ لِي: إِلَى بَيْتِ الرَّبِّ نَذْهَبُ" (مز 122)

سلام ونعمة يا فندم من خدمة مدارس أحد {stageClass}.
حابين نشارك مع حضراتكم تقرير {genderLabel} {firstName} خلال هذا الأسبوع:
⛪ حضور القداس الإلهي: {massCount}.
🏫 حضور حوش الخدمة: {serviceCount}.
🌟 صفات تميز بها هذا الأسبوع: {traits}.
🕊️ جلسة الاعتراف والافتقاد الدوري: {confessionStatus}.
📝 ملاحظات الخدمة: {notes}
صلوا لأجل الخدمة دائماً.`;

const DEFAULT_WEBHOOK_TEMPLATE = `"فَرِحْتُ بِالْقَائِلِينَ لِي: إِلَى بَيْتِ الرَّبِّ نَذْهَبُ" (مز 122)

سلام ونعمة يا فندم من خدمة مدارس أحد {stageClass}.
حابين نشارك مع حضراتكم تقرير {genderLabel} {firstName} خلال هذا الشهر:
⛪ حضور القداس الإلهي: {massCount}
🏫 حضور حوش الخدمة: {serviceCount}
🕊️ جلسة الاعتراف والافتقاد الدوري: {confessionStatus}.
📝 ملاحظات الخدمة: {notes}
صلوا لأجل الخدمة دائماً.`;

export default function SendReports() {
    const { servant, isGeneralAdmin, isServant, loading: authLoading, authorizedClasses } = useAuth();
    
    const roleNorm = servant?.role ? normalizeArabic(servant.role) : '';
    const isStageAdmin = roleNorm.includes('مرحله');
    const isGenAdmin = isGeneralAdmin && !isStageAdmin;
    const isClassServant = isServant && !isStageAdmin;

    // Filter states
    const [selectedStage, setSelectedStage] = useState(() => {
        return localStorage.getItem('reports_filter_stage') || servant?.assignedStage || '';
    });
    const [selectedClass, setSelectedClass] = useState(() => {
        return localStorage.getItem('reports_filter_class') || servant?.assignedClass || 'all';
    });
    const [reportType, setReportType] = useState('monthly'); // 'monthly' | 'weekly'
    
    // Date/Time States
    const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
    const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
    
    const weeksList = useMemo(() => generateWeeks(12), []);
    const [selectedWeekKey, setSelectedWeekKey] = useState(() => weeksList[0]?.key || '');

    // Search and search results
    const [searchQuery, setSearchQuery] = useState('');
    
    // Data Loading States
    const [students, setStudents] = useState([]);
    const [studentsLoading, setStudentsLoading] = useState(true);
    const [pointsHistory, setPointsHistory] = useState([]);
    const [pointsLoading, setPointsLoading] = useState(false);
    
    // Template settings
    const [monthlyTemplate, setMonthlyTemplate] = useState(() => {
        return localStorage.getItem('reports_template_monthly') || DEFAULT_MONTHLY_TEMPLATE;
    });
    const [weeklyTemplate, setWeeklyTemplate] = useState(() => {
        return localStorage.getItem('reports_template_weekly') || DEFAULT_WEEKLY_TEMPLATE;
    });
    const [webhookTemplate, setWebhookTemplate] = useState(() => {
        return localStorage.getItem('reports_template_webhook') || DEFAULT_WEBHOOK_TEMPLATE;
    });
    const [showTemplateEditor, setShowTemplateEditor] = useState(false);
    
    // Row-specific state maps
    const [selectedPhones, setSelectedPhones] = useState({}); // { studentId: phoneNum }
    const [editedMessages, setEditedMessages] = useState({}); // { studentId: text }
    const [studentGenders, setStudentGenders] = useState({}); // { studentId: 'boy'|'girl' }
    const [studentNotes, setStudentNotes] = useState({}); // { studentId: notesText }
    
    // Toast state
    const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
    const showToast = (message, type = 'success') => {
        setToast({ show: true, message, type });
        setTimeout(() => {
            setToast(prev => ({ ...prev, show: false }));
        }, 4500);
    };

    // Admin Summary Report States
    const [activeTab, setActiveTab] = useState('students'); // 'students' | 'admin_summary' | 'periodic_schedule' | 'webhook_bot'
    const [adminReportPhone, setAdminReportPhone] = useState(() => localStorage.getItem('reports_admin_phone') || '');
    const [servants, setServants] = useState([]);
    
    // Webhook Bot States
    const [webhookBotEnabled, setWebhookBotEnabled] = useState(true);
    const [webhookLogs, setWebhookLogs] = useState([]);
    const [webhookLogsLoading, setWebhookLogsLoading] = useState(true);
    const [webhookFilterStatus, setWebhookFilterStatus] = useState('all'); // 'all' | 'sent' | 'failed'
    const [servantsLoading, setServantsLoading] = useState(true);
    const [editedAdminMessage, setEditedAdminMessage] = useState('');
    const [adminReportPeriod, setAdminReportPeriod] = useState('weekly'); // 'weekly' | 'monthly'

    // Admin Summary Advanced Filters
    const [selectedStages, setSelectedStages] = useState(() => {
        const defaultStage = servant?.assignedStage || '';
        return defaultStage && defaultStage !== 'all' ? [defaultStage] : ['ابتدائي', 'اعدادي', 'ثانوي'];
    });
    const [selectedClassesList, setSelectedClassesList] = useState([]);
    const [reportContentScope, setReportContentScope] = useState('both'); // 'both' | 'students' | 'servants'
    const [includeServantsDetails, setIncludeServantsDetails] = useState(true);
    const [includeServantsSummary, setIncludeServantsSummary] = useState(true);
    const [servantsScope, setServantsScope] = useState('stages'); // 'stages' | 'classes'

    // Periodic Scheduling list
    const [schedulesList, setSchedulesList] = useState([]);
    const [schedulesLoading, setSchedulesLoading] = useState(true);

    // States for input forms in the tabs
    const [studentsSchedule, setStudentsSchedule] = useState({
        enabled: true,
        scheduleMode: 'recurring',
        days: ['friday'],
        date: new Date().toISOString().split('T')[0],
        time: '18:00',
        channel: 'developer_platform'
    });
    const [adminSchedule, setAdminSchedule] = useState({
        enabled: true,
        scheduleMode: 'recurring',
        days: ['thursday'],
        date: new Date().toISOString().split('T')[0],
        time: '20:00',
        channel: 'developer_platform',
        phoneNumber: ''
    });

    // States for inline editing inside the listing tab
    const [editingScheduleId, setEditingScheduleId] = useState(null);
    const [editFormData, setEditFormData] = useState(null);

    // Fetch periodic schedules from Firestore
    useEffect(() => {
        const q = collection(db, 'periodicSchedules');
        const unsub = onSnapshot(q, (snap) => {
            const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setSchedulesList(list);
            setSchedulesLoading(false);
        }, (error) => {
            console.error("Error loading periodic schedules:", error);
            setSchedulesLoading(false);
        });
        return () => unsub();
    }, []);

    // Logs for API rate limit tracking
    const [sendingLogs, setSendingLogs] = useState([]);
    const [logsLoading, setLogsLoading] = useState(true);

    useEffect(() => {
        const q = query(collection(db, 'reportSendingLogs'), orderBy('timestamp', 'desc'), limit(50));
        const unsub = onSnapshot(q, (snap) => {
            const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setSendingLogs(list);
            setLogsLoading(false);
        }, (error) => {
            console.error("Error fetching report sending logs:", error);
            setLogsLoading(false);
        });
        return () => unsub();
    }, []);

    // Quota tracking calculations
    const getScheduleMessageCount = (sch) => {
        if (!sch.enabled) return 0;
        if (sch.type === 'admin') return 1;
        const { selectedStage, selectedClass } = sch.filters || {};
        let count = 0;
        students.forEach(st => {
            const stageMatch = !selectedStage || selectedStage === 'all' || st.schoolGrade === selectedStage;
            const classMatch = !selectedClass || selectedClass === 'all' || st.assignedClass === selectedClass;
            if (stageMatch && classMatch) {
                count++;
            }
        });
        return count;
    };

    const totalActiveScheduledMessages = useMemo(() => {
        return schedulesList.reduce((acc, sch) => acc + getScheduleMessageCount(sch), 0);
    }, [schedulesList, students]);

    const sentMessagesCount = useMemo(() => {
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        return sendingLogs.filter(log => {
            const isSent = log.status === 'sent';
            const logTime = log.timestamp ? new Date(log.timestamp).getTime() : 0;
            return isSent && logTime >= oneDayAgo;
        }).length;
    }, [sendingLogs]);

    const remainingLimit = useMemo(() => {
        return Math.max(0, 250 - sentMessagesCount);
    }, [sentMessagesCount]);

    const consumptionPercentage = useMemo(() => {
        return Math.min(100, (sentMessagesCount / 250) * 100);
    }, [sentMessagesCount]);

    const resendMessageApi = async (log) => {
        try {
            showToast(`جاري إعادة إرسال الرسالة إلى ${log.recipientName} عبر API...`, "info");
            const logDocRef = doc(db, 'reportSendingLogs', log.id);
            await updateDoc(logDocRef, {
                status: 'sent',
                updatedAt: new Date().toISOString(),
                errorMessage: null
            });
            showToast(`تم إعادة إرسال الرسالة بنجاح وتحديث السجل! 🚀`, "success");
        } catch (err) {
            console.error(err);
            showToast("حدث خطأ أثناء إعادة الإرسال", "error");
        }
    };

    const resendMessageWhatsAppWeb = (log) => {
        const text = log.messageText || "تقرير الحضور والغياب الخاص بالنشاط";
        let cleanPhone = (log.recipientPhone || '').replace(/\D/g, '');
        if (cleanPhone.startsWith('01')) {
            cleanPhone = '20' + cleanPhone.substring(1);
        } else if (cleanPhone.startsWith('+')) {
            cleanPhone = cleanPhone.substring(1);
        }
        const url = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(text)}`;
        window.open(url, '_blank');
        showToast("تم فتح واتساب ويب للإرسال اليدوي 💬", "success");
    };

    // Save/Add schedule helpers
    const saveStudentsSchedule = async () => {
        try {
            const newDocRef = doc(collection(db, 'periodicSchedules'));
            await setDoc(newDocRef, {
                type: 'students',
                ...studentsSchedule,
                filters: {
                    selectedStage,
                    selectedClass,
                    reportType,
                    selectedMonth,
                    selectedYear,
                    selectedWeekKey,
                    monthlyTemplate,
                    weeklyTemplate
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
            showToast("تم إضافة جدول إرسال تقارير المخدومين الجديد بنجاح! 📅", "success");
        } catch (err) {
            console.error(err);
            showToast("حدث خطأ أثناء إضافة الجدولة للمخدومين", "error");
        }
    };

    const saveAdminSchedule = async () => {
        try {
            const newDocRef = doc(collection(db, 'periodicSchedules'));
            await setDoc(newDocRef, {
                type: 'admin',
                ...adminSchedule,
                filters: {
                    selectedStages,
                    selectedClassesList,
                    adminReportPeriod,
                    reportContentScope,
                    includeServantsDetails,
                    includeServantsSummary,
                    servantsScope,
                    selectedMonth,
                    selectedYear,
                    selectedWeekKey
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
            showToast("تم إضافة جدول إرسال تقرير الإدارة الجديد بنجاح! 📅", "success");
        } catch (err) {
            console.error(err);
            showToast("حدث خطأ أثناء إضافة الجدولة للإدارة", "error");
        }
    };

    // Listing Tab Actions: Toggle Enabled, Delete, Edit
    const toggleScheduleEnabled = async (id, currentVal) => {
        try {
            await updateDoc(doc(db, 'periodicSchedules', id), {
                enabled: !currentVal,
                updatedAt: new Date().toISOString()
            });
            showToast("تم تحديث حالة تفعيل الجدولة بنجاح", "success");
        } catch (err) {
            console.error(err);
            showToast("حدث خطأ أثناء تحديث حالة الجدولة", "error");
        }
    };

    const deleteSchedule = async (id) => {
        if (!window.confirm("هل أنت متأكد من رغبتك في حذف هذا الجدول الزمني؟")) return;
        try {
            await deleteDoc(doc(db, 'periodicSchedules', id));
            showToast("تم حذف الجدول الزمني بنجاح 🗑️", "success");
        } catch (err) {
            console.error(err);
            showToast("حدث خطأ أثناء حذف الجدول الزمني", "error");
        }
    };

    const startEditingSchedule = (schedule) => {
        setEditingScheduleId(schedule.id);
        setEditFormData({ ...schedule });
    };

    const saveEditSchedule = async (id) => {
        try {
            await updateDoc(doc(db, 'periodicSchedules', id), {
                ...editFormData,
                updatedAt: new Date().toISOString()
            });
            setEditingScheduleId(null);
            setEditFormData(null);
            showToast("تم حفظ تعديلات الجدول الزمني بنجاح ✅", "success");
        } catch (err) {
            console.error(err);
            showToast("حدث خطأ أثناء حفظ التعديلات", "error");
        }
    };

    // Helper to calculate next scheduled trigger date label in Arabic
    const getNextTriggerDateLabel = (enabled, scheduleMode, selectedDays, dateStr, timeStr) => {
        if (!enabled || !timeStr) return "معطل";
        
        if (scheduleMode === 'one_time') {
            if (!dateStr) return "تاريخ غير محدد";
            const triggerDate = new Date(`${dateStr}T${timeStr}`);
            if (isNaN(triggerDate.getTime())) return "تاريخ غير صالح";
            
            const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
            const dateLabel = triggerDate.toLocaleDateString('ar-EG', options);
            return `مرة واحدة في: ${dateLabel} الساعة ${timeStr}`;
        }

        // Recurring Mode
        if (!selectedDays || selectedDays.length === 0) return "يوم غير محدد";
        const dayMap = {
            'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6
        };

        const now = new Date();
        let closestTrigger = null;
        const [hour, minute] = timeStr.split(':').map(Number);
        
        selectedDays.forEach(dayKey => {
            const targetDayIdx = dayMap[dayKey];
            if (targetDayIdx === undefined) return;
            
            let tempDate = new Date(now);
            tempDate.setHours(hour, minute, 0, 0);
            
            let diff = targetDayIdx - now.getDay();
            if (diff < 0 || (diff === 0 && now.getTime() >= tempDate.getTime())) {
                diff += 7;
            }
            
            tempDate.setDate(now.getDate() + diff);
            
            if (!closestTrigger || tempDate < closestTrigger) {
                closestTrigger = tempDate;
            }
        });
        
        if (!closestTrigger) return "معطل";
        
        const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
        const dateLabel = closestTrigger.toLocaleDateString('ar-EG', options);
        return `متكرر كل: ${dateLabel} الساعة ${timeStr}`;
    };

    useEffect(() => {
        // Automatically check all classes belonging to the selected stages
        const classes = selectedStages.flatMap(st => STAGE_CLASS_MAP[st] || []);
        setSelectedClassesList(classes);
    }, [selectedStages]);

    // Save filters to localStorage
    useEffect(() => {
        if (selectedStage) localStorage.setItem('reports_filter_stage', selectedStage);
        if (selectedClass) localStorage.setItem('reports_filter_class', selectedClass);
    }, [selectedStage, selectedClass]);

    // Sync templates globally from Firestore
    useEffect(() => {
        const unsub = onSnapshot(doc(db, 'report_templates', 'config'), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                if (data.monthlyTemplate) {
                    setMonthlyTemplate(data.monthlyTemplate);
                    localStorage.setItem('reports_template_monthly', data.monthlyTemplate);
                }
                if (data.weeklyTemplate) {
                    setWeeklyTemplate(data.weeklyTemplate);
                    localStorage.setItem('reports_template_weekly', data.weeklyTemplate);
                }
                if (data.webhookTemplate) {
                    setWebhookTemplate(data.webhookTemplate);
                    localStorage.setItem('reports_template_webhook', data.webhookTemplate);
                }
            }
        });
        return () => unsub();
    }, []);

    // Helper to compile weekly/monthly admin summary
    const compileAdminSummary = () => {
        const targetStage = selectedStage || servant?.assignedStage || '';
        const targetClasses = selectedClassesList;
        const includeStudents = reportContentScope === 'both' || reportContentScope === 'students';
        const includeServants = reportContentScope === 'both' || reportContentScope === 'servants';
        
        // Filter students by selected stages and classes
        let stageStudents = students.filter(s => selectedStages.includes(s.schoolGrade));
        if (selectedClassesList.length > 0) {
            stageStudents = stageStudents.filter(s => selectedClassesList.includes(s.assignedClass));
        }

        // Filter servants by scope
        let stageServants = servants.filter(s => s.status === 'approved' && s.isActive !== false);
        if (servantsScope === 'classes') {
            stageServants = stageServants.filter(s => selectedClassesList.includes(s.assignedClass));
        } else {
            stageServants = stageServants.filter(s => {
                if (s.assignedStage && selectedStages.includes(s.assignedStage)) return true;
                const sStage = Object.keys(STAGE_CLASS_MAP).find(st => 
                    STAGE_CLASS_MAP[st].includes(s.assignedClass)
                );
                return sStage && selectedStages.includes(sStage);
            });
        }

        if (adminReportPeriod === 'monthly') {
            const fridays = getFridaysInMonth(selectedMonth, selectedYear);
            const N = fridays.length;
            const monthKey = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
            
            let scopeLabel = "";
            if (reportContentScope === 'both') {
                scopeLabel = selectedStages.length > 1 ? "مخدومي وخدام مراحل" : "مخدومي وخدام مرحلة";
            } else if (reportContentScope === 'servants') {
                scopeLabel = selectedStages.length > 1 ? "خدام مراحل" : "خدام مرحلة";
            } else {
                scopeLabel = selectedStages.length > 1 ? "مخدومي مراحل" : "مخدومي مرحلة";
            }
            let msg = `📊 *تقرير ملخص الشهر للإدارة* 📊\n📅 الشهر: ${selectedMonth}-${selectedYear}\n🏛️ ${scopeLabel}: ${selectedStages.join('، ')}\n\n`;

            if (includeStudents) {
                let classReportsText = "";
                let totalPossibleAll = 0;
                let totalServiceAll = 0;
                let totalMassAll = 0;
                let totalBothAll = 0;

                targetClasses.forEach(cls => {
                    const classSts = stageStudents.filter(s => s.assignedClass === cls);
                    if (classSts.length === 0) return;

                    let classPossible = 0;
                    let classService = 0;
                    let classMass = 0;
                    let classBoth = 0;

                    classSts.forEach(s => {
                        let createdAtTime = 0;
                        if (s.createdAt) {
                            if (typeof s.createdAt.toDate === 'function') {
                                createdAtTime = s.createdAt.toDate().getTime();
                            } else if (typeof s.createdAt.seconds === 'number') {
                                createdAtTime = s.createdAt.seconds * 1000;
                            } else {
                                const t = new Date(s.createdAt).getTime();
                                if (!isNaN(t)) createdAtTime = t;
                            }
                        }

                        fridays.forEach(fStr => {
                            const fDate = new Date(fStr);
                            const fridayEnd = new Date(fDate.getFullYear(), fDate.getMonth(), fDate.getDate(), 23, 59, 59).getTime();
                            
                            if (createdAtTime === 0 || fridayEnd >= createdAtTime) {
                                classPossible++;
                                
                                const attendedService = (s.attendance || []).includes(fStr);
                                
                                const nextThursday = new Date(fDate);
                                nextThursday.setDate(fDate.getDate() + 6);
                                nextThursday.setHours(23, 59, 59, 999);
                                
                                const attendedMass = (s.liturgyAttendance || []).some(dateStr => {
                                    const d = new Date(dateStr);
                                    return d >= fDate && d <= nextThursday;
                                });

                                if (attendedService) classService++;
                                if (attendedMass) classMass++;
                                if (attendedService && attendedMass) classBoth++;
                            }
                        });
                    });

                    if (classPossible === 0) return;

                    totalPossibleAll += classPossible;
                    totalServiceAll += classService;
                    totalMassAll += classMass;
                    totalBothAll += classBoth;

                    const servicePct = Math.round((classService / classPossible) * 100);
                    const massPct = Math.round((classMass / classPossible) * 100);
                    const bothPct = Math.round((classBoth / classPossible) * 100);

                    classReportsText += `*فصل ${cls}:*\n⛪ حضور القداس: ${classMass} من ${classPossible} (${massPct}%)\n🏫 حضور الخدمة: ${classService} من ${classPossible} (${servicePct}%)\n🤝 حضور الاثنين معاً: ${classBoth} من ${classPossible} (${bothPct}%)\n\n`;
                });

                const overallMassPct = totalPossibleAll > 0 ? Math.round((totalMassAll / totalPossibleAll) * 100) : 0;
                const overallServicePct = totalPossibleAll > 0 ? Math.round((totalServiceAll / totalPossibleAll) * 100) : 0;
                const overallBothPct = totalPossibleAll > 0 ? Math.round((totalBothAll / totalPossibleAll) * 100) : 0;

                msg += `=== 🏫 حضور المخدومين بالفصول (تراكمي الشهر) ===\n`;
                msg += classReportsText || "لا يوجد بيانات فصول مسجلة للحضور\n\n";

                msg += `=== 📈 إجمالي حضور المخدومين بالشهر ===\n`;
                msg += `⛪ إجمالي القداس: ${totalMassAll} من ${totalPossibleAll} (${overallMassPct}%)\n`;
                msg += `🏫 إجمالي الخدمة: ${totalServiceAll} من ${totalPossibleAll} (${overallServicePct}%)\n`;
                msg += `🤝 إجمالي الاثنين معاً: ${totalBothAll} من ${totalPossibleAll} (${overallBothPct}%)\n\n`;
            }

            if (includeServants && (includeServantsDetails || includeServantsSummary)) {
                let servantReportsText = "";
                let totalServantsPossible = 0;
                let totalServantsService = 0;
                let totalServantsMass = 0;
                let totalServantsMeeting = 0;
                let totalServantsPrep = 0;
                let totalServantsVisits = 0;

                stageServants.forEach(serv => {
                    let createdAtTime = 0;
                    if (serv.createdAt) {
                        if (typeof serv.createdAt.toDate === 'function') {
                            createdAtTime = serv.createdAt.toDate().getTime();
                        } else if (typeof serv.createdAt.seconds === 'number') {
                            createdAtTime = serv.createdAt.seconds * 1000;
                        } else {
                            const t = new Date(serv.createdAt).getTime();
                            if (!isNaN(t)) createdAtTime = t;
                        }
                    }

                    // Only count Fridays after servant registration
                    const validFridays = fridays.filter(fStr => {
                        if (createdAtTime === 0) return true;
                        const fDate = new Date(fStr);
                        const fridayEnd = new Date(fDate.getFullYear(), fDate.getMonth(), fDate.getDate(), 23, 59, 59).getTime();
                        return fridayEnd >= createdAtTime;
                    });

                    const servPossible = validFridays.length;
                    if (servPossible === 0) return;

                    let servService = 0;
                    let servMass = 0;
                    let servMeeting = 0;
                    let servPrep = 0;

                    validFridays.forEach(fStr => {
                        const followup = serv.weeklyFollowUp?.[fStr] || {};
                        if (followup.attendanceService === true) servService++;
                        if (followup.attendanceLiturgy === true) servMass++;
                        if (followup.attendanceMeeting === true) servMeeting++;
                        if (followup.preparation === true) servPrep++;
                    });

                    // Count monthly visitations for this servant
                    let monthlyVisits = 0;
                    students.forEach(st => {
                        // 1. Home visitations in this month
                        const hv = st.homeVisitations?.[monthKey];
                        if (hv && (hv.status === 'visited' || hv.status === 'late_attended')) {
                            const isByServant = hv.servantId === serv.id || (hv.visitedByIds && hv.visitedByIds.includes(serv.id));
                            if (isByServant) {
                                monthlyVisits++;
                            }
                        }
                        // 2. Phone visitations in this month
                        validFridays.forEach(fStr => {
                            const pv = st.phoneVisitations?.[fStr];
                            if (pv && (pv.status === 'called' || pv.status === 'late_attended') && pv.servantId === serv.id) {
                                monthlyVisits++;
                            }
                        });
                    });

                    totalServantsPossible += servPossible;
                    totalServantsService += servService;
                    totalServantsMass += servMass;
                    totalServantsMeeting += servMeeting;
                    totalServantsPrep += servPrep;
                    totalServantsVisits += monthlyVisits;

                    if (includeServantsDetails) {
                        servantReportsText += `- *${serv.name}* (${serv.assignedClass || serv.assignedStage || 'خادم'}):\n  🏫 الخدمة: ${servService}/${servPossible} | ⛪ القداس: ${servMass}/${servPossible} | 👥 الاجتماع: ${servMeeting}/${servPossible} | 📖 التحضير: ${servPrep}/${servPossible} | 📞 الافتقاد: ${monthlyVisits} مرة\n`;
                    }
                });

                if (includeServantsDetails && servantReportsText) {
                    msg += `=== 👥 تقرير الخدام بالتفصيل (تراكمي الشهر) ===\n`;
                    msg += servantReportsText + `\n`;
                }

                if (includeServantsSummary) {
                    const overallServServicePct = totalServantsPossible > 0 ? Math.round((totalServantsService / totalServantsPossible) * 100) : 0;
                    const overallServMassPct = totalServantsPossible > 0 ? Math.round((totalServantsMass / totalServantsPossible) * 100) : 0;
                    const overallServMeetingPct = totalServantsPossible > 0 ? Math.round((totalServantsMeeting / totalServantsPossible) * 100) : 0;
                    const overallServPrepPct = totalServantsPossible > 0 ? Math.round((totalServantsPrep / totalServantsPossible) * 100) : 0;

                    msg += `=== 📊 ملخص نسب حضور الخدام بالشهر ===\n`;
                    msg += `🏫 نسبة حضور الخدمة: ${overallServServicePct}%\n`;
                    msg += `⛪ نسبة حضور القداس: ${overallServMassPct}%\n`;
                    msg += `👥 نسبة حضور الاجتماع: ${overallServMeetingPct}%\n`;
                    msg += `📖 نسبة التحضير: ${overallServPrepPct}%\n`;
                    msg += `📞 إجمالي الافتقادات (منزلي وتليفوني): ${totalServantsVisits} مرة\n\n`;
                }
            }

            msg += `صلوا لأجل الخدمة دائماً.`;
            return msg;
        } else {
            // Weekly Report (Default)
            const weekObj = weeksList.find(w => w.key === selectedWeekKey);
            if (!weekObj) return "";

            const start = new Date(weekObj.fridayDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(weekObj.thursdayDate);
            end.setHours(23, 59, 59, 999);

            let scopeLabel = "";
            if (reportContentScope === 'both') {
                scopeLabel = selectedStages.length > 1 ? "مخدومي وخدام مراحل" : "مخدومي وخدام مرحلة";
            } else if (reportContentScope === 'servants') {
                scopeLabel = selectedStages.length > 1 ? "خدام مراحل" : "خدام مرحلة";
            } else {
                scopeLabel = selectedStages.length > 1 ? "مخدومي مراحل" : "مخدومي مرحلة";
            }
            let msg = `📊 *تقرير ملخص الأسبوع للإدارة* 📊\n📅 الأسبوع: ${weekObj.label}\n🏛️ ${scopeLabel}: ${selectedStages.join('، ')}\n\n`;

            if (includeStudents) {
                let classReportsText = "";
                let totalStageStudentsCount = 0;
                let totalStageMassCount = 0;
                let totalStageServiceCount = 0;
                let totalStageBothCount = 0;

                targetClasses.forEach(cls => {
                    const classSts = stageStudents.filter(s => s.assignedClass === cls);
                    if (classSts.length === 0) return; // Skip classes with no students

                    const classTotal = classSts.length;
                    
                    const classService = classSts.filter(s => (s.attendance || []).includes(selectedWeekKey)).length;
                    
                    const classMass = classSts.filter(s => {
                        return (s.liturgyAttendance || []).some(dateStr => {
                            const d = new Date(dateStr);
                            return d >= start && d <= end;
                        });
                    }).length;

                    const classBoth = classSts.filter(s => {
                        const attendedService = (s.attendance || []).includes(selectedWeekKey);
                        const attendedMass = (s.liturgyAttendance || []).some(dateStr => {
                            const d = new Date(dateStr);
                            return d >= start && d <= end;
                        });
                        return attendedService && attendedMass;
                    }).length;

                    totalStageStudentsCount += classTotal;
                    totalStageMassCount += classMass;
                    totalStageServiceCount += classService;
                    totalStageBothCount += classBoth;

                    const massPercent = classTotal > 0 ? Math.round((classMass / classTotal) * 100) : 0;
                    const servicePercent = classTotal > 0 ? Math.round((classService / classTotal) * 100) : 0;
                    const bothPercentReal = classTotal > 0 ? Math.round((classBoth / classTotal) * 100) : 0;

                    classReportsText += `*فصل ${cls}:*\n⛪ حضور القداس: ${classMass} من ${classTotal} (${massPercent}%)\n🏫 حضور الخدمة: ${classService} من ${classTotal} (${servicePercent}%)\n🤝 حضور الاثنين معاً: ${classBoth} من ${classTotal} (${bothPercentReal}%)\n\n`;
                });

                const totalMassPercent = totalStageStudentsCount > 0 ? Math.round((totalStageMassCount / totalStageStudentsCount) * 100) : 0;
                const totalServicePercent = totalStageStudentsCount > 0 ? Math.round((totalStageServiceCount / totalStageStudentsCount) * 100) : 0;
                const totalBothPercent = totalStageStudentsCount > 0 ? Math.round((totalStageBothCount / totalStageStudentsCount) * 100) : 0;

                msg += `=== 🏫 حضور المخدومين بالفصول ===\n`;
                msg += classReportsText || "لا يوجد بيانات فصول مسجلة للحضور\n\n";

                msg += `=== 📈 إجمالي حضور المخدومين ===\n`;
                msg += `⛪ إجمالي حضور القداس: ${totalStageMassCount} من ${totalStageStudentsCount} (${totalMassPercent}%)\n`;
                msg += `🏫 إجمالي حضور الخدمة: ${totalStageServiceCount} من ${totalStageStudentsCount} (${totalServicePercent}%)\n`;
                msg += `🤝 إجمالي حضور الاثنين معاً: ${totalStageBothCount} من ${totalStageStudentsCount} (${totalBothPercent}%)\n\n`;
            }

            if (includeServants && (includeServantsDetails || includeServantsSummary)) {
                let servantReportsText = "";
                let servCount = 0;
                let servServiceCount = 0;
                let servMassCount = 0;
                let servMeetingCount = 0;
                let servPrepCount = 0;
                let totalServantsVisits = 0;

                stageServants.forEach(serv => {
                    let createdAtTime = 0;
                    if (serv.createdAt) {
                        if (typeof serv.createdAt.toDate === 'function') {
                            createdAtTime = serv.createdAt.toDate().getTime();
                        } else if (typeof serv.createdAt.seconds === 'number') {
                            createdAtTime = serv.createdAt.seconds * 1000;
                        } else {
                            const t = new Date(serv.createdAt).getTime();
                            if (!isNaN(t)) createdAtTime = t;
                        }
                    }

                    // Skip servants created after this week
                    if (createdAtTime > 0 && createdAtTime > end.getTime()) {
                        return;
                    }

                    servCount++;
                    const followup = serv.weeklyFollowUp?.[selectedWeekKey] || {};
                    const serviceAttended = followup.attendanceService === true;
                    const liturgyAttended = followup.attendanceLiturgy === true;
                    const meetingAttended = followup.attendanceMeeting === true;
                    const prepDone = followup.preparation === true;

                    if (serviceAttended) servServiceCount++;
                    if (liturgyAttended) servMassCount++;
                    if (meetingAttended) servMeetingCount++;
                    if (prepDone) servPrepCount++;

                    // Count weekly visitations for this servant
                    let weeklyVisits = 0;
                    students.forEach(st => {
                        // 1. Phone visitations in this week
                        const pv = st.phoneVisitations?.[selectedWeekKey];
                        if (pv && (pv.status === 'called' || pv.status === 'late_attended') && pv.servantId === serv.id) {
                            weeklyVisits++;
                        }
                        // 2. Home visitations in this week
                        if (st.homeVisitations) {
                            Object.keys(st.homeVisitations).forEach(mKey => {
                                const hv = st.homeVisitations[mKey];
                                if (hv && (hv.status === 'visited' || hv.status === 'late_attended')) {
                                    if (hv.timestamp) {
                                        const t = new Date(hv.timestamp);
                                        const isThisWeek = t >= start && t <= end;
                                        const isByServant = hv.servantId === serv.id || (hv.visitedByIds && hv.visitedByIds.includes(serv.id));
                                        if (isThisWeek && isByServant) {
                                            weeklyVisits++;
                                        }
                                    }
                                }
                            });
                        }
                    });
                    totalServantsVisits += weeklyVisits;

                    if (includeServantsDetails) {
                        servantReportsText += `- *${serv.name}* (${serv.assignedClass || serv.assignedStage || 'خادم'}): الخدمة: ${serviceAttended ? 'حضر' : 'غاب'} | القداس: ${liturgyAttended ? 'حضر' : 'غاب'} | الاجتماع: ${meetingAttended ? 'حضر' : 'غاب'} | التحضير: ${prepDone ? 'تم' : 'لم يتم'} | الافتقاد: ${weeklyVisits} مرة\n`;
                    }
                });

                if (includeServantsDetails && servantReportsText) {
                    msg += `=== 👥 تقرير الخدام بالتفصيل ===\n`;
                    msg += servantReportsText + `\n`;
                }

                if (includeServantsSummary) {
                    const servServicePercent = servCount > 0 ? Math.round((servServiceCount / servCount) * 100) : 0;
                    const servMassPercent = servCount > 0 ? Math.round((servMassCount / servCount) * 100) : 0;
                    const servMeetingPercent = servCount > 0 ? Math.round((servMeetingCount / servCount) * 100) : 0;
                    const servPrepPercent = servCount > 0 ? Math.round((servPrepCount / servCount) * 100) : 0;

                    msg += `=== 📊 ملخص نسب حضور الخدام ===\n`;
                    msg += `🏫 نسبة حضور الخدمة: ${servServicePercent}%\n`;
                    msg += `⛪ نسبة حضور القداس: ${servMassPercent}%\n`;
                    msg += `👥 نسبة حضور الاجتماع: ${servMeetingPercent}%\n`;
                    msg += `📖 نسبة التحضير: ${servPrepPercent}%\n`;
                    msg += `📞 إجمالي الافتقادات (منزلي وتليفوني): ${totalServantsVisits} مرة\n\n`;
                }
            }

            msg += `صلوا لأجل الخدمة دائماً.`;
            return msg;
        }
    };

    // Fetch servants for admin summary
    useEffect(() => {
        if (!isGenAdmin && !isStageAdmin) return;
        setServantsLoading(true);
        const unsub = onSnapshot(collection(db, 'servants'), (snap) => {
            const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setServants(list);
            setServantsLoading(false);
        }, (error) => {
            console.error("Error loading servants:", error);
            setServantsLoading(false);
        });
        return () => unsub();
    }, [isGenAdmin, isStageAdmin]);

    // Compile and set admin message
    useEffect(() => {
        if (activeTab === 'admin_summary') {
            const msg = compileAdminSummary();
            setEditedAdminMessage(msg);
        }
    }, [activeTab, selectedWeekKey, selectedStages, selectedClassesList, reportContentScope, includeServantsDetails, includeServantsSummary, servantsScope, adminReportPeriod, selectedMonth, selectedYear, students, servants]);

    // Enforce role restrictions
    useEffect(() => {
        if (authLoading || !servant) return;
        
        if (isClassServant) {
            if (servant.assignedStage && selectedStage !== servant.assignedStage) {
                setSelectedStage(servant.assignedStage);
            }
            if (servant.assignedClass && selectedClass !== servant.assignedClass) {
                setSelectedClass(servant.assignedClass);
            }
        } else if (isStageAdmin) {
            if (servant.assignedStage && selectedStage !== servant.assignedStage) {
                setSelectedStage(servant.assignedStage);
            }
        }
    }, [authLoading, servant, isClassServant, isStageAdmin]);

    // Fetch students
    useEffect(() => {
        setStudentsLoading(true);
        let q = collection(db, 'students');
        
        if (isStageAdmin && servant?.assignedStage) {
            q = query(q, where('schoolGrade', '==', servant.assignedStage));
        } else if (!isGenAdmin && selectedStage && selectedStage !== 'all') {
            q = query(q, where('schoolGrade', '==', selectedStage));
        }
        
        const unsub = onSnapshot(q, (snap) => {
            const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setStudents(list);
            setStudentsLoading(false);
        }, (error) => {
            console.error("Error loading students:", error);
            showToast("حدث خطأ أثناء تحميل بيانات المخدومين", "error");
            setStudentsLoading(false);
        });
        
        return () => unsub();
    }, [selectedStage, isStageAdmin, isGenAdmin, servant]);

    // Fetch points history for traits determination
    useEffect(() => {
        let start, end;
        if (reportType === 'monthly') {
            start = new Date(selectedYear, selectedMonth - 1, 1, 0, 0, 0);
            end = new Date(selectedYear, selectedMonth, 0, 23, 59, 59);
        } else {
            const weekObj = weeksList.find(w => w.key === selectedWeekKey);
            if (weekObj) {
                start = new Date(weekObj.fridayDate);
                start.setHours(0, 0, 0, 0);
                end = new Date(weekObj.thursdayDate);
                end.setHours(23, 59, 59, 999);
            } else {
                setPointsHistory([]);
                return;
            }
        }
        
        setPointsLoading(true);
        const q = query(
            collection(db, 'pointsHistory'),
            where('createdAt', '>=', start),
            where('createdAt', '<=', end)
        );
        
        const unsub = onSnapshot(q, (snap) => {
            const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setPointsHistory(list);
            setPointsLoading(false);
        }, (error) => {
            console.error("Error loading points history:", error);
            setPointsLoading(false);
        });
        
        return () => unsub();
    }, [reportType, selectedMonth, selectedYear, selectedWeekKey, weeksList]);

    // Sync Webhook Bot Enabled state from settings
    useEffect(() => {
        const unsub = onSnapshot(doc(db, 'settings', 'notifications'), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                setWebhookBotEnabled(data.webhookBotEnabled !== false);
            }
        });
        return () => unsub();
    }, []);

    // Sync Webhook Query Logs
    useEffect(() => {
        if (activeTab !== 'webhook_bot') return;
        
        setWebhookLogsLoading(true);
        const q = query(
            collection(db, 'webhookQueryLogs'),
            orderBy('timestamp', 'desc'),
            limit(50)
        );
        
        const unsub = onSnapshot(q, (snap) => {
            const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setWebhookLogs(list);
            setWebhookLogsLoading(false);
        }, (error) => {
            console.error("Error loading webhook query logs:", error);
            setWebhookLogsLoading(false);
        });
        
        return () => unsub();
    }, [activeTab]);

    const toggleWebhookBot = async () => {
        try {
            const nextState = !webhookBotEnabled;
            await setDoc(doc(db, 'settings', 'notifications'), {
                webhookBotEnabled: nextState
            }, { merge: true });
            showToast(`تم ${nextState ? 'تفعيل' : 'تعطيل'} بوت الاستعلام التفاعلي بنجاح!`, 'success');
        } catch (err) {
            console.error("Error updating webhook bot status:", err);
            showToast("حدث خطأ أثناء تعديل حالة البوت", "error");
        }
    };

    const handleCopyText = (text, label) => {
        navigator.clipboard.writeText(text)
            .then(() => showToast(`تم نسخ ${label} بنجاح! 📋`, 'success'))
            .catch(() => showToast(`فشل نسخ ${label}`, 'error'));
    };

    const filteredWebhookLogs = useMemo(() => {
        if (webhookFilterStatus === 'all') return webhookLogs;
        return webhookLogs.filter(log => log.status === webhookFilterStatus);
    }, [webhookLogs, webhookFilterStatus]);

    const handleDeleteWebhookLog = async (logId) => {
        try {
            await deleteDoc(doc(db, 'webhookQueryLogs', logId));
            showToast("تم مسح محاولة الاستعلام من السجل بنجاح!", "success");
        } catch (err) {
            console.error("Error deleting log:", err);
            showToast("حدث خطأ أثناء مسح السجل", "error");
        }
    };

    const handleClearAllWebhookLogs = async () => {
        if (!window.confirm("هل أنت متأكد من مسح جميع سجلات الاستعلام بالكامل؟ لا يمكن التراجع عن هذا الإجراء.")) return;
        try {
            const deletePromises = webhookLogs.map(log => deleteDoc(doc(db, 'webhookQueryLogs', log.id)));
            await Promise.all(deletePromises);
            showToast("تم تفريغ سجل الاستعلامات بالكامل بنجاح!", "success");
        } catch (err) {
            console.error("Error clearing logs:", err);
            showToast("حدث خطأ أثناء تفريغ السجل", "error");
        }
    };

    // Determine target classes based on Stage selection & permissions
    const availableClasses = useMemo(() => {
        if (!selectedStage || selectedStage === 'all') return [];
        const classes = STAGE_CLASS_MAP[selectedStage] || [];
        
        // If class servant, restrict to their class(es)
        if (isClassServant && servant) {
            const allowed = [servant.assignedClass, ...(authorizedClasses || [])].filter(Boolean);
            return classes.filter(c => allowed.includes(c));
        }
        return classes;
    }, [selectedStage, isClassServant, servant, authorizedClasses]);

    // Apply secondary filters (Stage, Class, Search) in memory
    const filteredStudents = useMemo(() => {
        let list = [...students];
        
        // Filter by stage (since query loads all stages for GenAdmin)
        if (selectedStage && selectedStage !== 'all') {
            list = list.filter(s => s.schoolGrade === selectedStage);
        }
        
        // Filter by class
        if (selectedClass && selectedClass !== 'all') {
            list = list.filter(s => s.assignedClass === selectedClass);
        } else if (isClassServant && servant) {
            // Lock to authorized classes if "all" is somehow selected or empty
            const allowed = [servant.assignedClass, ...(authorizedClasses || [])].filter(Boolean);
            list = list.filter(s => allowed.includes(s.assignedClass));
        }
        
        // Search filter
        if (searchQuery.trim()) {
            const normQuery = normalizeArabic(searchQuery.toLowerCase());
            list = list.filter(s => {
                const normName = normalizeArabic((s.name || '').toLowerCase());
                const code = (s.code || '').toLowerCase();
                return normName.includes(normQuery) || code.includes(normQuery);
            });
        }
        
        // Sort alphabetically
        return list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
    }, [students, selectedStage, selectedClass, searchQuery, isClassServant, servant, authorizedClasses]);

    // Helper to get formatted traits for a student in this month/week
    const getStudentTraits = (studentId) => {
        const studentLogs = pointsHistory.filter(log => log.studentId === studentId && (log.amount || 0) > 0);
        if (studentLogs.length === 0) {
            return "الالتزام وحسن السلوك";
        }
        const reasons = studentLogs.map(log => log.reason).filter(Boolean);
        const uniqueReasons = [...new Set(reasons)];
        return uniqueReasons.length > 0 ? uniqueReasons.join('، ') : "الالتزام وحسن السلوك";
    };

    // Calculate metrics for each student and compile message
    const getCompiledMessage = (student) => {
        if (editedMessages[student.id] !== undefined) {
            return editedMessages[student.id];
        }

        const firstName = (student.name || '').split(' ')[0] || '';
        const stageClass = student.assignedClass || student.schoolGrade || 'مدارس الأحد';
        
        // Determine gender
        const gender = studentGenders[student.id] || guessGender(student.name);
        const genderLabel = gender === 'boy' ? 'ابننا البطل' : 'بنتنا الجميلة';
        
        // Attendance counts
        let massCount = 0;
        let serviceCount = 0;
        
        if (reportType === 'monthly') {
            const monthStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
            const attendedMass = (student.liturgyAttendance || []).filter(d => d.startsWith(monthStr)).length;
            const attendedService = (student.attendance || []).filter(d => d.startsWith(monthStr)).length;
            
            const totalFridays = countFridaysForStudentInMonth(student, selectedMonth, selectedYear);
            
            massCount = `${attendedMass} من ${totalFridays}`;
            serviceCount = `${attendedService} من ${totalFridays}`;
        } else {
            // Weekly
            const weekObj = weeksList.find(w => w.key === selectedWeekKey);
            const isServiceAttended = (student.attendance || []).includes(selectedWeekKey);
            
            // Check liturgy attendance inside the week range
            let isMassAttended = false;
            if (weekObj) {
                const start = new Date(weekObj.fridayDate);
                start.setHours(0, 0, 0, 0);
                const end = new Date(weekObj.thursdayDate);
                end.setHours(23, 59, 59, 999);
                
                isMassAttended = (student.liturgyAttendance || []).some(dateStr => {
                    const d = new Date(dateStr);
                    return d >= start && d <= end;
                });
            }
            
            massCount = isMassAttended ? "حضر" : "لم يحضر";
            serviceCount = isServiceAttended ? "حضر" : "لم يحضر";
        }

        // Confession
        const monthKey = `${String(selectedMonth).padStart(2, '0')}-${selectedYear}`;
        const hasConfessed = student.confessions?.[monthKey]?.status === true;
        const confessionStatus = hasConfessed ? "تم الاعتراف ✅" : "لم يتم الاعتراف بعد";

        // Traits
        const traits = getStudentTraits(student.id);

        // Notes
        const noteText = studentNotes[student.id] !== undefined ? studentNotes[student.id] : (student.notes || '');
        const notesReplacement = noteText.trim() ? noteText.trim() : "لا يوجد";

        // Populate template
        const template = reportType === 'monthly' ? monthlyTemplate : weeklyTemplate;
        
        return template
            .replace(/{stageClass}/g, stageClass)
            .replace(/{genderLabel}/g, genderLabel)
            .replace(/{firstName}/g, firstName)
            .replace(/{massCount}/g, massCount)
            .replace(/{serviceCount}/g, serviceCount)
            .replace(/{traits}/g, traits)
            .replace(/{confessionStatus}/g, confessionStatus)
            .replace(/{notes}/g, notesReplacement);
    };

    // Copy to clipboard
    const handleCopy = (student, text) => {
        navigator.clipboard.writeText(text)
            .then(() => {
                showToast(`تم نسخ تقرير المخدوم "${student.name}" بنجاح! 📋`, 'success');
            })
            .catch(err => {
                console.error("Failed to copy:", err);
                showToast("فشل نسخ النص، يرجى المحاولة يدوياً", "error");
            });
    };

    // Open WhatsApp
    const handleWhatsApp = (student, text) => {
        const phone = selectedPhones[student.id] || getPhoneOptions(student)[0]?.value;
        if (!phone) {
            showToast("لا يوجد رقم هاتف محدد للإرسال إليه!", "warning");
            return;
        }
        
        // Normalize phone number (Egypt country code is 20)
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.startsWith('01')) {
            cleanPhone = '20' + cleanPhone.substring(1);
        } else if (cleanPhone.startsWith('+')) {
            cleanPhone = cleanPhone.substring(1);
        }
        
        const url = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(text)}`;
        window.open(url, '_blank');
    };

    // Save student notes to Firestore
    const handleSaveNotes = async (studentId, notesValue) => {
        try {
            await updateDoc(doc(db, 'students', studentId), { notes: notesValue });
            showToast("تم حفظ ملاحظات المخدوم بنجاح! 📝", "success");
        } catch (err) {
            console.error("Error saving notes:", err);
            showToast("حدث خطأ أثناء حفظ الملاحظات", "error");
        }
    };

    // Get phone options for student
    const getPhoneOptions = (student) => {
        const options = [];
        
        // Parents contacts
        (student.parentsContacts || []).forEach(contact => {
            if (contact.phone) {
                const relationAr = contact.relation === 'father' ? 'الأب' : contact.relation === 'mother' ? 'الأم' : contact.relation || 'ولي الأمر';
                options.push({
                    label: `📱 ${relationAr}: ${contact.phone} (${contact.name || ''})`,
                    value: contact.phone,
                    type: contact.relation
                });
            }
        });

        // Student's own phones
        (student.phones || []).forEach((phone, idx) => {
            if (phone) {
                options.push({
                    label: `📱 المخدوم ${idx + 1}: ${phone}`,
                    value: phone,
                    type: 'student'
                });
            }
        });

        return options;
    };

    // Get default phone selection based on stage/availability
    const getSelectedPhone = (student) => {
        if (selectedPhones[student.id]) return selectedPhones[student.id];
        
        const options = getPhoneOptions(student);
        if (options.length === 0) return '';

        // For secondary (ثانوي) stage, try to default to student's phone
        const isSecondary = student.schoolGrade === 'ثانوي';
        if (isSecondary) {
            const studentPhone = options.find(o => o.type === 'student');
            if (studentPhone) return studentPhone.value;
        }

        // Try father then mother then student
        const fatherPhone = options.find(o => o.type === 'father');
        if (fatherPhone) return fatherPhone.value;

        const motherPhone = options.find(o => o.type === 'mother');
        if (motherPhone) return motherPhone.value;

        return options[0]?.value || '';
    };

    // Reset templates to default (Admin only)
    const resetTemplates = async () => {
        if (!isGenAdmin) return;
        if (window.confirm("هل أنت متأكد من إعادة تعيين القوالب التلقائية؟")) {
            try {
                await setDoc(doc(db, 'report_templates', 'config'), {
                    monthlyTemplate: DEFAULT_MONTHLY_TEMPLATE,
                    weeklyTemplate: DEFAULT_WEEKLY_TEMPLATE,
                    webhookTemplate: DEFAULT_WEBHOOK_TEMPLATE
                });
                setMonthlyTemplate(DEFAULT_MONTHLY_TEMPLATE);
                setWeeklyTemplate(DEFAULT_WEEKLY_TEMPLATE);
                setWebhookTemplate(DEFAULT_WEBHOOK_TEMPLATE);
                localStorage.removeItem('reports_template_monthly');
                localStorage.removeItem('reports_template_weekly');
                localStorage.removeItem('reports_template_webhook');
                showToast("تمت إعادة تعيين القوالب التلقائية بنجاح! ☁️", "success");
            } catch (err) {
                console.error("Error resetting templates:", err);
                showToast("حدث خطأ أثناء إعادة ضبط القوالب سحابياً", "error");
            }
        }
    };

    // Save templates (Admin only)
    const saveTemplates = async () => {
        if (!isGenAdmin) return;
        try {
            await setDoc(doc(db, 'report_templates', 'config'), {
                monthlyTemplate,
                weeklyTemplate,
                webhookTemplate
            });
            localStorage.setItem('reports_template_monthly', monthlyTemplate);
            localStorage.setItem('reports_template_weekly', weeklyTemplate);
            localStorage.setItem('reports_template_webhook', webhookTemplate);
            setShowTemplateEditor(false);
            showToast("تم حفظ القوالب المخصصة في قاعدة البيانات بنجاح! ☁️", "success");
        } catch (err) {
            console.error("Error saving templates to Firestore:", err);
            showToast("حدث خطأ أثناء حفظ القوالب سحابياً", "error");
        }
    };

    if (authLoading) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-[#0f172a] gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600 dark:border-blue-400"></div>
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">جاري تحميل الصلاحيات...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto px-4 py-8" dir="rtl">
            
            {/* Header section with styling */}
            <header className="mb-8 space-y-3 relative overflow-hidden bg-gradient-to-r from-blue-600 to-indigo-650 dark:from-blue-900/60 dark:to-indigo-950/60 p-8 rounded-3xl border border-blue-100 dark:border-blue-900/30 shadow-xl transition-all">
                <div className="absolute -top-10 -left-10 w-40 h-40 bg-white/5 rounded-full blur-2xl"></div>
                <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-white/5 rounded-full blur-2xl"></div>
                
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative z-10">
                    <div className="space-y-1">
                        <div className="inline-flex items-center gap-2 bg-blue-500/20 text-blue-100 px-3.5 py-1.5 rounded-full font-black text-xs border border-white/10">
                            <Sparkles size={14} className="text-yellow-350 animate-pulse" /> لوحة المشرفين والخدام
                        </div>
                        <h1 className="text-3xl font-black text-white tracking-tight">إرسال التقارير المخصصة</h1>
                        <p className="text-blue-100/80 font-semibold text-sm">
                            إدارة وتقارير حضور المخدومين والقداسات وإنجازاتهم، وإرسالها للأهالي بلمسة واحدة.
                        </p>
                    </div>
                    
                    {isGenAdmin && (
                        <button
                            onClick={() => setShowTemplateEditor(!showTemplateEditor)}
                            className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl border border-white/20 backdrop-blur-sm transition-all duration-300 flex items-center gap-2 cursor-pointer shadow-sm hover:scale-[1.02] active:scale-[0.98]"
                        >
                            <MessageSquare size={18} />
                            <span>{showTemplateEditor ? "إغلاق محرر القوالب" : "تعديل قالب الرسالة"}</span>
                        </button>
                    )}
                </div>
            </header>

            {/* Tab Selection */}
            {isGenAdmin && (
                <div className="flex border-b border-slate-200 dark:border-slate-800 mb-6 gap-2">
                    <button
                        onClick={() => setActiveTab('students')}
                        className={`py-3 px-6 font-bold text-sm border-b-2 transition-all cursor-pointer bg-transparent border-none ${
                            activeTab === 'students'
                            ? 'border-blue-600 text-blue-600 dark:text-blue-400 border-b-solid font-black'
                            : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-350'
                        }`}
                    >
                        👥 إرسال تقارير المخدومين
                    </button>
                    <button
                        onClick={() => setActiveTab('admin_summary')}
                        className={`py-3 px-6 font-bold text-sm border-b-2 transition-all cursor-pointer bg-transparent border-none ${
                            activeTab === 'admin_summary'
                            ? 'border-blue-600 text-blue-600 dark:text-blue-400 border-b-solid font-black'
                            : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-350'
                        }`}
                    >
                        📊 تقرير ملخص الإدارة الأسبوعي
                    </button>
                    <button
                        onClick={() => setActiveTab('periodic_schedule')}
                        className={`py-3 px-6 font-bold text-sm border-b-2 transition-all cursor-pointer bg-transparent border-none ${
                            activeTab === 'periodic_schedule'
                            ? 'border-blue-600 text-blue-600 dark:text-blue-400 border-b-solid font-black'
                            : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-350'
                        }`}
                    >
                        📅 الإرسال الدوري والجدولة
                    </button>
                    <button
                        onClick={() => setActiveTab('webhook_bot')}
                        className={`py-3 px-6 font-bold text-sm border-b-2 transition-all cursor-pointer bg-transparent border-none ${
                            activeTab === 'webhook_bot'
                            ? 'border-blue-600 text-blue-600 dark:text-blue-400 border-b-solid font-black'
                            : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-350'
                        }`}
                    >
                        💬 الاستعلام التفاعلي
                    </button>
                </div>
            )}

            {activeTab === 'students' && (
                <>
                    {/* Template Editor Box */}
                    {showTemplateEditor && isGenAdmin && (
                <div className="mb-8 bg-white dark:bg-[#1e293b] p-6 rounded-3xl border-2 border-blue-100 dark:border-blue-900/30 shadow-xl animate-in slide-in-from-top-4 duration-300">
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                        <MessageSquare className="text-blue-500 animate-pulse" size={20} /> تخصيص قالب الرسائل التلقائي
                    </h2>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-2">
                            <label className="block text-sm font-black text-slate-600 dark:text-slate-350">قالب التقرير الشهري:</label>
                            <textarea
                                value={monthlyTemplate}
                                onChange={(e) => setMonthlyTemplate(e.target.value)}
                                rows={6}
                                className="w-full p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl font-bold text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/40 text-sm leading-relaxed"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="block text-sm font-black text-slate-600 dark:text-slate-350">قالب التقرير الأسبوعي:</label>
                            <textarea
                                value={weeklyTemplate}
                                onChange={(e) => setWeeklyTemplate(e.target.value)}
                                rows={6}
                                className="w-full p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl font-bold text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/40 text-sm leading-relaxed"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="block text-sm font-black text-slate-600 dark:text-slate-350">قالب الاستعلام التفاعلي (البوت):</label>
                            <textarea
                                value={webhookTemplate}
                                onChange={(e) => setWebhookTemplate(e.target.value)}
                                rows={6}
                                className="w-full p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl font-bold text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/40 text-sm leading-relaxed"
                            />
                        </div>
                    </div>

                    <div className="mt-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-150 dark:border-blue-900/30 p-4 rounded-2xl text-xs font-semibold text-blue-800 dark:text-blue-300 leading-relaxed">
                        <div className="font-black mb-1.5 flex items-center gap-1.5"><Info size={14}/> العلامات المتاحة للملء التلقائي:</div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div><code className="bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded font-black text-blue-600 dark:text-blue-400">&#123;stageClass&#125;</code>: اسم الفصل/المرحلة</div>
                            <div><code className="bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded font-black text-blue-600 dark:text-blue-400">&#123;genderLabel&#125;</code>: ابننا البطل / بنتنا الجميلة</div>
                            <div><code className="bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded font-black text-blue-650 dark:text-blue-400">&#123;firstName&#125;</code>: الاسم الأول للمخدوم</div>
                            <div><code className="bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded font-black text-blue-600 dark:text-blue-400">&#123;massCount&#125;</code>: مرات حضور القداس</div>
                            <div><code className="bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded font-black text-blue-650 dark:text-blue-400">&#123;serviceCount&#125;</code>: مرات حضور الخدمة</div>
                            <div><code className="bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded font-black text-blue-650 dark:text-blue-400">&#123;traits&#125;</code>: الصفات المميزة من الفايربيز</div>
                            <div><code className="bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded font-black text-blue-650 dark:text-blue-400">&#123;confessionStatus&#125;</code>: حالة الاعتراف</div>
                            <div><code className="bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded font-black text-blue-650 dark:text-blue-400">&#123;notes&#125;</code>: ملاحظات الخدمة للمخدوم</div>
                        </div>
                    </div>

                    <div className="mt-6 flex justify-end gap-3">
                        <button
                            onClick={resetTemplates}
                            className="px-4 py-2 text-xs font-black cursor-pointer bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-slate-300 rounded-xl border-none"
                        >
                            إعادة ضبط افتراضي
                        </button>
                        <button
                            onClick={saveTemplates}
                            className="px-5 py-2.5 bg-blue-650 hover:bg-blue-750 text-white font-black rounded-xl border-none cursor-pointer text-xs shadow-md"
                        >
                            حفظ التعديلات
                        </button>
                    </div>
                </div>
            )}

            {/* Smart Filter Card */}
            <section className="bg-white dark:bg-[#1e293b] p-6 rounded-3xl shadow-md border border-slate-150 dark:border-slate-800/80 mb-8 space-y-6">
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <Filter className="text-blue-600" size={20} /> فرز وتحديد الفئة المستهدفة
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    {/* Stage Dropdown */}
                    <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">قائمة المراحل (Stage)</label>
                        <select
                            value={selectedStage}
                            disabled={!isGenAdmin}
                            onChange={(e) => {
                                setSelectedStage(e.target.value);
                                setSelectedClass('all'); // reset class on stage change
                            }}
                            className="w-full p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500 transition-colors"
                        >
                            {isGenAdmin && <option value="all">كل المراحل</option>}
                            <option value="ابتدائي">مرحلة ابتدائي</option>
                            <option value="اعدادي">مرحلة إعدادي</option>
                            <option value="ثانوي">مرحلة ثانوي</option>
                        </select>
                    </div>

                    {/* Class Dropdown */}
                    <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">قائمة الفصول (Class)</label>
                        <select
                            value={selectedClass}
                            disabled={!selectedStage || selectedStage === 'all' || (isClassServant && availableClasses.length <= 1)}
                            onChange={(e) => setSelectedClass(e.target.value)}
                            className="w-full p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500 transition-colors disabled:opacity-60"
                        >
                            <option value="all">كل الفصول</option>
                            {availableClasses.map(cls => (
                                <option key={cls} value={cls}>{cls}</option>
                            ))}
                        </select>
                    </div>

                    {/* Report Type */}
                    <div className="space-y-1.5">
                        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">نوع التقرير (Report Type)</label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setReportType('monthly')}
                                className={`flex-1 py-3 px-2 rounded-xl font-bold text-xs cursor-pointer border transition-all ${
                                    reportType === 'monthly'
                                    ? 'bg-blue-600 border-blue-650 text-white shadow-sm'
                                    : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-655 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-850'
                                }`}
                            >
                                تقرير شهري
                            </button>
                            <button
                                onClick={() => setReportType('weekly')}
                                className={`flex-1 py-3 px-2 rounded-xl font-bold text-xs cursor-pointer border transition-all ${
                                    reportType === 'weekly'
                                    ? 'bg-blue-600 border-blue-650 text-white shadow-sm'
                                    : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-655 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-850'
                                }`}
                            >
                                تقرير أسبوعي
                            </button>
                        </div>
                    </div>

                    {/* Dynamic Date Picker (Month/Year or Week Selector) */}
                    <div className="space-y-1.5">
                        {reportType === 'monthly' ? (
                            <div className="flex gap-2 w-full">
                                <div className="flex-1 space-y-1">
                                    <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500">الشهر</label>
                                    <select
                                        value={selectedMonth}
                                        onChange={(e) => setSelectedMonth(Number(e.target.value))}
                                        className="w-full p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-black text-slate-800 dark:text-slate-100 outline-none"
                                    >
                                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                                            <option key={m} value={m}>
                                                {new Date(2026, m - 1, 1).toLocaleDateString('ar-EG', { month: 'long' })}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex-1 space-y-1">
                                    <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500">السنة</label>
                                    <select
                                        value={selectedYear}
                                        onChange={(e) => setSelectedYear(Number(e.target.value))}
                                        className="w-full p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-black text-slate-800 dark:text-slate-100 outline-none"
                                    >
                                        {[new Date().getFullYear(), new Date().getFullYear() - 1].map(y => (
                                            <option key={y} value={y}>{y}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-1 w-full">
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">اختر الأسبوع</label>
                                <select
                                    value={selectedWeekKey}
                                    onChange={(e) => setSelectedWeekKey(e.target.value)}
                                    className="w-full p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500"
                                >
                                    {weeksList.map(w => (
                                        <option key={w.key} value={w.key}>{w.label}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                {/* Search input and statistics */}
                <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-4 border-t border-slate-100 dark:border-slate-800/80">
                    <div className="relative w-full sm:max-w-md">
                        <Search className="absolute right-3.5 top-3 text-slate-400" size={18} />
                        <input
                            type="text"
                            placeholder="ابحث باسم المخدوم أو كود التعريف..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pr-10 pl-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl font-bold text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/40"
                        />
                    </div>
                    <div className="text-xs font-black text-slate-500 dark:text-slate-400 flex items-center gap-2">
                        <Users size={16} className="text-blue-600" />
                        <span>عدد المخدومين المطابقين: <strong className="text-slate-800 dark:text-slate-200 text-sm">{filteredStudents.length}</strong> مخدوم</span>
                    </div>
                </div>
            </section>

            {/* Periodic Alerts / Scheduled Auto-Sending Card */}
            <section className="bg-white dark:bg-[#1e293b] p-6 rounded-3xl shadow-md border border-slate-150 dark:border-slate-800/80 mb-8 space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <Clock className="text-blue-650 animate-pulse" size={20} /> الإرسال الدوري التلقائي (جدولة تنبيهات المخدومين)
                        </h2>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 font-bold">تتيح لك هذه الميزة جدولة إرسال تقارير المخدومين تلقائياً لأولياء الأمور في أوقات وأيام محددة عبر السيرفر.</p>
                    </div>
                    
                    {/* Toggle Switch */}
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setStudentsSchedule(prev => ({ ...prev, enabled: !prev.enabled }))}
                            className={`relative w-12 h-6 rounded-full cursor-pointer transition-all duration-300 border-none outline-none ${
                                studentsSchedule.enabled ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-800'
                            }`}
                        >
                            <div 
                                className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300 ${
                                    studentsSchedule.enabled ? 'right-7' : 'right-1'
                                }`}
                            />
                        </button>
                        <span className="text-sm font-bold text-slate-700 dark:text-slate-350 font-black">
                            {studentsSchedule.enabled ? 'مفعل' : 'معطل'}
                        </span>
                    </div>
                </div>

                {studentsSchedule.enabled && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-slate-100 dark:border-slate-800/80 animate-in slide-in-from-top-4 duration-250">
                        {/* Mode & Day Selector */}
                        <div className="space-y-4">
                            {/* Mode selection */}
                            <div className="space-y-1.5">
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">نمط جدولة المخدومين</label>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setStudentsSchedule(prev => ({ ...prev, scheduleMode: 'recurring' }))}
                                        className={`flex-1 py-1.5 px-2 rounded-lg font-bold text-[10px] cursor-pointer border transition-all ${
                                            studentsSchedule.scheduleMode === 'recurring'
                                            ? 'bg-blue-600 border-blue-650 text-white shadow-sm'
                                            : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                                        }`}
                                    >
                                        أسبوعي
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setStudentsSchedule(prev => ({ ...prev, scheduleMode: 'one_time' }))}
                                        className={`flex-1 py-1.5 px-2 rounded-lg font-bold text-[10px] cursor-pointer border transition-all ${
                                            studentsSchedule.scheduleMode === 'one_time'
                                            ? 'bg-blue-600 border-blue-650 text-white shadow-sm'
                                            : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                                        }`}
                                    >
                                        تاريخ محدد
                                    </button>
                                </div>
                            </div>

                            {studentsSchedule.scheduleMode === 'one_time' ? (
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">تاريخ الإرسال</label>
                                    <input
                                        type="date"
                                        value={studentsSchedule.date || ''}
                                        onChange={(e) => setStudentsSchedule(prev => ({ ...prev, date: e.target.value }))}
                                        className="w-full p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-850 dark:text-slate-150 outline-none focus:border-blue-500"
                                    />
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">يوم الإرسال الدوري</label>
                                    <div className="grid grid-cols-2 gap-1">
                                        {[
                                            { key: 'friday', name: 'الجمعة' },
                                            { key: 'saturday', name: 'السبت' },
                                            { key: 'sunday', name: 'الأحد' },
                                            { key: 'monday', name: 'الإثنين' },
                                            { key: 'tuesday', name: 'الثلاثاء' },
                                            { key: 'wednesday', name: 'الأربعاء' },
                                            { key: 'thursday', name: 'الخميس' }
                                        ].map(day => {
                                            const isSelected = (studentsSchedule.days || []).includes(day.key);
                                            return (
                                                <button
                                                    key={day.key}
                                                    type="button"
                                                    onClick={() => {
                                                        const currentDays = studentsSchedule.days || [];
                                                        const newDays = currentDays.includes(day.key)
                                                            ? currentDays.filter(d => d !== day.key)
                                                            : [...currentDays, day.key];
                                                        setStudentsSchedule(prev => ({ ...prev, days: newDays }));
                                                    }}
                                                    className={`p-2 rounded-lg text-[10px] font-black cursor-pointer transition-all border-none ${
                                                        isSelected
                                                        ? 'bg-blue-600 text-white shadow-sm'
                                                        : 'bg-slate-100 dark:bg-slate-900 text-slate-650 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800/50'
                                                    }`}
                                                >
                                                    {day.name}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Time Selector */}
                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">وقت الإرسال</label>
                                <div className="relative">
                                    <Clock className="absolute right-3 top-3 text-slate-450" size={16} />
                                    <input
                                        type="time"
                                        value={studentsSchedule.time || '18:00'}
                                        onChange={(e) => setStudentsSchedule(prev => ({ ...prev, time: e.target.value }))}
                                        className="w-full pr-10 pl-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500"
                                    />
                                </div>
                            </div>
                            
                            <div className="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-150 dark:border-slate-800/80">
                                <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 block">منصة الإرسال المحددة:</span>
                                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">منصة المطورين (WhatsApp API) 🚀</span>
                            </div>
                        </div>

                        {/* Status Card & Action */}
                        <div className="bg-blue-50/40 dark:bg-blue-950/10 border border-blue-150 dark:border-blue-900/30 p-4 rounded-2xl flex flex-col justify-between">
                            <div className="space-y-1.5">
                                <span className="text-[10px] font-black text-blue-700 dark:text-blue-400 block">📊 حالة الجدول الزمني للمخدومين</span>
                                <div className="text-[10px] text-slate-600 dark:text-slate-350 leading-relaxed font-bold">
                                    التنبيه القادم: <span className="text-blue-600 dark:text-blue-400 font-black">{getNextTriggerDateLabel(studentsSchedule.enabled, studentsSchedule.scheduleMode, studentsSchedule.days, studentsSchedule.date, studentsSchedule.time)}</span>
                                </div>
                            </div>
                            
                            <button
                                type="button"
                                onClick={saveStudentsSchedule}
                                className="mt-4 w-full py-2 bg-blue-650 hover:bg-blue-700 text-white font-black rounded-lg border-none cursor-pointer text-[10px] shadow-sm transition-all hover:scale-[1.01] flex items-center justify-center gap-1.5"
                            >
                                <Check size={14} /> حفظ إعدادات الإرسال الدوري
                            </button>
                        </div>
                    </div>
                )}
            </section>

            {/* Data Grid Section */}
            <main className="bg-white dark:bg-[#1e293b] rounded-3xl shadow-md border border-slate-150 dark:border-slate-800/80 overflow-hidden">
                {studentsLoading || pointsLoading ? (
                    <div className="py-24 flex flex-col items-center justify-center gap-4">
                        <RefreshCw className="animate-spin text-blue-600" size={40} />
                        <p className="text-lg font-black text-slate-400 dark:text-slate-500">جاري تحميل بيانات التقارير والصفات...</p>
                    </div>
                ) : filteredStudents.length === 0 ? (
                    <div className="py-24 text-center flex flex-col items-center justify-center gap-4">
                        <AlertCircle className="text-slate-300 dark:text-slate-700" size={48} />
                        <p className="text-lg font-black text-slate-450 dark:text-slate-500">لا يوجد مخدومين يطابقون خيارات البحث والتصفية المحددة</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-right border-collapse">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-[#0f172a]/60 text-slate-500 dark:text-slate-400 text-xs font-black border-b border-slate-100 dark:border-slate-800">
                                    <th className="p-4 w-12 text-center">م</th>
                                    <th className="p-4 w-48">بيانات المخدوم</th>
                                    <th className="p-4 w-56">الرقم المستهدف</th>
                                    <th className="p-4">نص التقرير الديناميكي (Live Preview)</th>
                                    <th className="p-4 w-40 text-center">الإجراءات</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredStudents.map((st, idx) => {
                                    const phoneOpts = getPhoneOptions(st);
                                    const activePhone = getSelectedPhone(st);
                                    const compiledMsg = getCompiledMessage(st);
                                    
                                    const studentGender = studentGenders[st.id] || guessGender(st.name);

                                    return (
                                        <tr 
                                            key={st.id} 
                                            className="border-b border-slate-100 dark:border-slate-800/80 hover:bg-slate-50/40 dark:hover:bg-slate-900/10 transition-colors"
                                        >
                                            {/* Index number */}
                                            <td className="p-4 text-center font-bold text-slate-400 text-sm">{idx + 1}</td>
                                            
                                            {/* Student info */}
                                            <td className="p-4 space-y-2">
                                                <div>
                                                    <span className="font-black text-slate-800 dark:text-slate-100 block leading-snug">{st.name}</span>
                                                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 block mt-0.5">كود: {st.code || 'بدون كود'}</span>
                                                </div>
                                                
                                                {/* Gender Selector Toggle Switch */}
                                                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-900 rounded-lg p-1 w-fit border border-slate-200 dark:border-slate-800">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setStudentGenders(prev => ({ ...prev, [st.id]: 'boy' }));
                                                            // clear custom message to trigger regen
                                                            const updatedMsg = { ...editedMessages };
                                                            delete updatedMsg[st.id];
                                                            setEditedMessages(updatedMsg);
                                                        }}
                                                        className={`px-2 py-0.5 rounded font-black text-[10px] cursor-pointer transition-all border-none ${
                                                            studentGender === 'boy'
                                                            ? 'bg-blue-550 text-white shadow-sm'
                                                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 bg-transparent'
                                                        }`}
                                                    >
                                                        👦 ولد
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setStudentGenders(prev => ({ ...prev, [st.id]: 'girl' }));
                                                            // clear custom message to trigger regen
                                                            const updatedMsg = { ...editedMessages };
                                                            delete updatedMsg[st.id];
                                                            setEditedMessages(updatedMsg);
                                                        }}
                                                        className={`px-2 py-0.5 rounded font-black text-[10px] cursor-pointer transition-all border-none ${
                                                            studentGender === 'girl'
                                                            ? 'bg-rose-500 text-white shadow-sm'
                                                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 bg-transparent'
                                                        }`}
                                                    >
                                                        👧 بنت
                                                    </button>
                                                </div>

                                                {/* Notes Input Field */}
                                                <div className="space-y-1 mt-2">
                                                    <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500">📝 ملاحظات الخدمة:</label>
                                                    <input
                                                        type="text"
                                                        value={studentNotes[st.id] !== undefined ? studentNotes[st.id] : (st.notes || '')}
                                                        onChange={(e) => setStudentNotes(prev => ({ ...prev, [st.id]: e.target.value }))}
                                                        onBlur={() => handleSaveNotes(st.id, studentNotes[st.id] !== undefined ? studentNotes[st.id] : (st.notes || ''))}
                                                        placeholder="اكتب ملاحظة الخدمة..."
                                                        className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-[11px] font-bold text-slate-750 dark:text-slate-200 outline-none focus:border-blue-500 transition-colors shadow-inner"
                                                    />
                                                </div>
                                            </td>
                                            
                                            {/* Phone selector dropdown */}
                                            <td className="p-4">
                                                {phoneOpts.length === 0 ? (
                                                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 dark:bg-rose-955/20 border border-rose-100 dark:border-rose-900/30 text-rose-600 dark:text-rose-400 rounded-xl text-xs font-bold w-full text-center justify-center">
                                                        <AlertCircle size={14} /> لا توجد أرقام مسجلة!
                                                    </span>
                                                ) : (
                                                    <select
                                                        value={activePhone}
                                                        onChange={(e) => setSelectedPhones(prev => ({ ...prev, [st.id]: e.target.value }))}
                                                        className="w-full p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-800 dark:text-slate-100 outline-none text-xs leading-normal"
                                                    >
                                                        {phoneOpts.map(opt => (
                                                            <option key={opt.value} value={opt.value}>
                                                                {opt.label}
                                                            </option>
                                                        ))}
                                                    </select>
                                                )}
                                            </td>
                                            
                                            {/* Message textarea preview */}
                                            <td className="p-4">
                                                <textarea
                                                    value={compiledMsg}
                                                    onChange={(e) => setEditedMessages(prev => ({ ...prev, [st.id]: e.target.value }))}
                                                    rows={4}
                                                    className="w-full p-3 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl font-bold text-slate-750 dark:text-slate-200 outline-none focus:ring-2 focus:ring-blue-500/30 text-xs leading-relaxed"
                                                />
                                            </td>
                                            
                                            {/* Actions */}
                                            <td className="p-4">
                                                <div className="flex flex-col gap-2 justify-center items-slate shadow-inner h-full">
                                                    {/* Copy button */}
                                                    <button
                                                        onClick={() => handleCopy(st, compiledMsg)}
                                                        className="flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/20 dark:hover:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/30 font-black rounded-xl text-xs transition-all cursor-pointer shadow-sm active:scale-95"
                                                    >
                                                        <Copy size={14} />
                                                        <span>نسخ التقرير</span>
                                                    </button>
                                                    
                                                    {/* Send WhatsApp button */}
                                                    <button
                                                        onClick={() => handleWhatsApp(st, compiledMsg)}
                                                        disabled={phoneOpts.length === 0}
                                                        className="flex items-center justify-center gap-1.5 py-2 px-3 bg-green-600 hover:bg-green-700 text-white font-black rounded-xl text-xs transition-all cursor-pointer border-none shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        <ExternalLink size={14} />
                                                        <span>إرسال واتساب</span>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </main>
                </>
            )}

            {/* Admin Summary Tab Content */}
            {activeTab === 'admin_summary' && isGenAdmin && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="bg-white dark:bg-[#1e293b] p-6 rounded-3xl shadow-md border border-slate-150 dark:border-slate-800/80 space-y-6">
                        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <Filter className="text-blue-600" size={20} /> خيارات تصفية وتخصيص تقرير الإدارة
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Period Type Selection */}
                            <div className="space-y-1.5 col-span-1 md:col-span-2">
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">نوع التقرير المطلوب للإدارة</label>
                                <div className="flex gap-6 mt-1.5">
                                    <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-slate-700 dark:text-slate-300">
                                        <input
                                            type="radio"
                                            name="adminReportPeriod"
                                            checked={adminReportPeriod === 'weekly'}
                                            onChange={() => setAdminReportPeriod('weekly')}
                                            className="w-4.5 h-4.5 accent-blue-600 cursor-pointer"
                                        />
                                        <span>ملخص أسبوعي</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-slate-700 dark:text-slate-300">
                                        <input
                                            type="radio"
                                            name="adminReportPeriod"
                                            checked={adminReportPeriod === 'monthly'}
                                            onChange={() => setAdminReportPeriod('monthly')}
                                            className="w-4.5 h-4.5 accent-blue-600 cursor-pointer"
                                        />
                                        <span>ملخص شهري تراكمي</span>
                                    </label>
                                </div>
                            </div>

                            {/* Conditional Selector: Week vs. Month/Year */}
                            {adminReportPeriod === 'weekly' ? (
                                <div className="space-y-1.5 col-span-1 md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">اختر الأسبوع المطلوب</label>
                                    <select
                                        value={selectedWeekKey}
                                        onChange={(e) => setSelectedWeekKey(e.target.value)}
                                        className="w-full p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500"
                                    >
                                        {weeksList.map(w => (
                                            <option key={w.key} value={w.key}>{w.label}</option>
                                        ))}
                                    </select>
                                </div>
                            ) : (
                                <>
                                    {/* Month Selector */}
                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">اختر الشهر المطلوب</label>
                                        <select
                                            value={selectedMonth}
                                            onChange={(e) => setSelectedMonth(Number(e.target.value))}
                                            className="w-full p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500"
                                        >
                                            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                                                <option key={m} value={m}>
                                                    {new Date(2020, m - 1, 1).toLocaleDateString('ar-EG', { month: 'long' })}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Year Selector */}
                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">اختر السنة</label>
                                        <select
                                            value={selectedYear}
                                            onChange={(e) => setSelectedYear(Number(e.target.value))}
                                            className="w-full p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500"
                                        >
                                            {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map(y => (
                                                <option key={y} value={y}>{y}</option>
                                            ))}
                                        </select>
                                    </div>
                                </>
                            )}

                            {/* Stage Selector (Checkboxes) */}
                            <div className="space-y-1.5">
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">المراحل المستهدفة</label>
                                <div className="flex gap-4 mt-2">
                                    {['ابتدائي', 'اعدادي', 'ثانوي'].map(stage => {
                                        const isDisabled = !isGenAdmin;
                                        const isChecked = selectedStages.includes(stage);
                                        return (
                                            <label key={stage} className={`flex items-center gap-2 cursor-pointer text-sm font-bold text-slate-700 dark:text-slate-350 ${isDisabled ? 'opacity-60 cursor-not-allowed' : ''}`}>
                                                <input
                                                    type="checkbox"
                                                    disabled={isDisabled}
                                                    checked={isChecked}
                                                    onChange={() => {
                                                        if (isChecked) {
                                                            if (selectedStages.length > 1) {
                                                                setSelectedStages(selectedStages.filter(st => st !== stage));
                                                            } else {
                                                                showToast("يجب اختيار مرحلة واحدة على الأقل!", "warning");
                                                            }
                                                        } else {
                                                            setSelectedStages([...selectedStages, stage]);
                                                        }
                                                    }}
                                                    className="w-4.5 h-4.5 accent-blue-600 rounded"
                                                />
                                                <span>{stage}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Class Selector (Checkboxes Grid) */}
                            <div className="space-y-2 col-span-1 md:col-span-2 border-t border-slate-100 dark:border-slate-800/60 pt-4">
                                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">الفصول المستهدفة (يمكنك تحديد فصول معينة بالتقرير)</label>
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-40 overflow-y-auto p-3.5 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-150 dark:border-slate-800/60">
                                    {selectedStages.flatMap(st => STAGE_CLASS_MAP[st] || []).map(cls => {
                                        const isChecked = selectedClassesList.includes(cls);
                                        return (
                                            <label key={cls} className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-750 dark:text-slate-350">
                                                <input
                                                    type="checkbox"
                                                    checked={isChecked}
                                                    onChange={() => {
                                                        if (isChecked) {
                                                            setSelectedClassesList(selectedClassesList.filter(c => c !== cls));
                                                        } else {
                                                            setSelectedClassesList([...selectedClassesList, cls]);
                                                        }
                                                    }}
                                                    className="w-4 h-4 accent-blue-600 rounded"
                                                />
                                                <span>{cls}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Report Content Sections & Servants Scope */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 col-span-1 md:col-span-2 border-t border-slate-100 dark:border-slate-800/60 pt-4">
                                <div className="space-y-2">
                                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">محتوى التقرير المستهدف</label>
                                    <div className="flex flex-col gap-3 mt-1.5 font-bold">
                                        <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-slate-700 dark:text-slate-300">
                                            <input
                                                type="radio"
                                                name="reportContentScope"
                                                checked={reportContentScope === 'both'}
                                                onChange={() => setReportContentScope('both')}
                                                className="w-4.5 h-4.5 accent-blue-600"
                                            />
                                            <span>مخدومين وخدام معاً</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-slate-700 dark:text-slate-300">
                                            <input
                                                type="radio"
                                                name="reportContentScope"
                                                checked={reportContentScope === 'students'}
                                                onChange={() => setReportContentScope('students')}
                                                className="w-4.5 h-4.5 accent-blue-600"
                                            />
                                            <span>مخدومين فقط (تقارير حضور الفصول)</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-slate-700 dark:text-slate-300">
                                            <input
                                                type="radio"
                                                name="reportContentScope"
                                                checked={reportContentScope === 'servants'}
                                                onChange={() => setReportContentScope('servants')}
                                                className="w-4.5 h-4.5 accent-blue-600"
                                            />
                                            <span>خدام فقط (حضور ونسب الخدام)</span>
                                        </label>
                                    </div>
                                </div>

                                {(reportContentScope === 'both' || reportContentScope === 'servants') && (
                                    <div className="space-y-4 animate-in slide-in-from-top-2 duration-200">
                                        <div className="space-y-2">
                                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">خيارات تقرير الخدام</label>
                                            <div className="flex flex-col gap-2">
                                                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700 dark:text-slate-300">
                                                    <input
                                                        type="checkbox"
                                                        checked={includeServantsDetails}
                                                        onChange={(e) => setIncludeServantsDetails(e.target.checked)}
                                                        className="w-4 h-4 accent-blue-600 rounded"
                                                    />
                                                    <span>تضمين كشف أسماء وتفاصيل حضور الخدام</span>
                                                </label>
                                                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700 dark:text-slate-300">
                                                    <input
                                                        type="checkbox"
                                                        checked={includeServantsSummary}
                                                        onChange={(e) => setIncludeServantsSummary(e.target.checked)}
                                                        className="w-4 h-4 accent-blue-600 rounded"
                                                    />
                                                    <span>تضمين ملخص نسب حضور الخدام الإجمالية</span>
                                                </label>
                                            </div>
                                        </div>

                                        <div className="space-y-1.5">
                                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">نطاق تقرير حضور الخدام</label>
                                            <select
                                                value={servantsScope}
                                                onChange={(e) => setServantsScope(e.target.value)}
                                                className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500"
                                            >
                                                <option value="stages">جميع خدام المراحل المختارة</option>
                                                <option value="classes">خدام الفصول المختارة فقط</option>
                                            </select>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Periodic Alerts / Scheduled Auto-Sending for Admin Summary */}
                    <section className="bg-white dark:bg-[#1e293b] p-6 rounded-3xl shadow-md border border-slate-150 dark:border-slate-800/80 mb-8 space-y-6">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                            <div>
                                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                    <Clock className="text-blue-650 animate-pulse" size={20} /> الإرسال الدوري التلقائي (جدولة تقارير الإدارة)
                                </h2>
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 font-bold">تتيح لك هذه الميزة جدولة إرسال تقرير ملخص الإدارة تلقائياً في أوقات وأيام محددة للأمين العام أو جهات الاتصال المستهدفة.</p>
                            </div>
                            
                            {/* Toggle Switch */}
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setAdminSchedule(prev => ({ ...prev, enabled: !prev.enabled }))}
                                    className={`relative w-12 h-6 rounded-full cursor-pointer transition-all duration-300 border-none outline-none ${
                                        adminSchedule.enabled ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-800'
                                    }`}
                                >
                                    <div 
                                        className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300 ${
                                            adminSchedule.enabled ? 'right-7' : 'right-1'
                                        }`}
                                    />
                                </button>
                                <span className="text-sm font-bold text-slate-700 dark:text-slate-355 font-black">
                                    {adminSchedule.enabled ? 'مفعل' : 'معطل'}
                                </span>
                            </div>
                        </div>

                        {adminSchedule.enabled && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-slate-100 dark:border-slate-800/80 animate-in slide-in-from-top-4 duration-250">
                                {/* Mode & Day Selector */}
                                <div className="space-y-4">
                                    {/* Mode selection */}
                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">نمط جدولة الإدارة</label>
                                        <div className="flex gap-2">
                                            {['recurring', 'one_time'].map(mode => (
                                                <button
                                                    key={mode}
                                                    type="button"
                                                    onClick={() => setAdminSchedule(prev => ({ ...prev, scheduleMode: mode }))}
                                                    className={`flex-1 py-2 px-3 rounded-xl font-black text-xs border-none cursor-pointer transition-all ${
                                                        adminSchedule.scheduleMode === mode
                                                        ? 'bg-blue-600 text-white shadow-sm'
                                                        : 'bg-slate-100 dark:bg-slate-900 text-slate-655 dark:text-slate-400'
                                                    }`}
                                                >
                                                    {mode === 'recurring' ? 'أسبوعي' : 'تاريخ محدد'}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Date / Day selector */}
                                    {adminSchedule.scheduleMode === 'one_time' ? (
                                        <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-200">
                                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">تاريخ الإرسال</label>
                                            <input
                                                type="date"
                                                value={adminSchedule.date || ''}
                                                onChange={(e) => setAdminSchedule(prev => ({ ...prev, date: e.target.value }))}
                                                className="w-full p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-850 dark:text-slate-150 outline-none focus:border-blue-550/40"
                                            />
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">أيام الإرسال الدوري</label>
                                            <div className="grid grid-cols-2 gap-1">
                                                {[
                                                    { key: 'friday', name: 'الجمعة' },
                                                    { key: 'saturday', name: 'السبت' },
                                                    { key: 'sunday', name: 'الأحد' },
                                                    { key: 'monday', name: 'الإثنين' },
                                                    { key: 'tuesday', name: 'الثلاثاء' },
                                                    { key: 'wednesday', name: 'الأربعاء' },
                                                    { key: 'thursday', name: 'الخميس' }
                                                ].map(day => {
                                                    const isSelected = (adminSchedule.days || []).includes(day.key);
                                                    return (
                                                        <button
                                                            key={day.key}
                                                            type="button"
                                                            onClick={() => {
                                                                const currentDays = adminSchedule.days || [];
                                                                const newDays = currentDays.includes(day.key)
                                                                    ? currentDays.filter(d => d !== day.key)
                                                                    : [...currentDays, day.key];
                                                                setAdminSchedule(prev => ({ ...prev, days: newDays }));
                                                            }}
                                                            className={`p-2 rounded-lg text-[10px] font-black cursor-pointer transition-all border-none ${
                                                                isSelected
                                                                ? 'bg-blue-600 text-white shadow-sm'
                                                                : 'bg-slate-100 dark:bg-slate-900 text-slate-655 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800/50'
                                                            }`}
                                                        >
                                                            {day.name}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Time, Channel & Target Phone Selector */}
                                <div className="space-y-4">
                                    <div className="space-y-1.5">
                                        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">وقت الإرسال</label>
                                        <div className="relative">
                                            <Clock className="absolute right-3.5 top-3 text-slate-405" size={16} />
                                            <input
                                                type="time"
                                                value={adminSchedule.time || '20:00'}
                                                onChange={(e) => setAdminSchedule(prev => ({ ...prev, time: e.target.value }))}
                                                className="w-full pr-10 pl-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">الرقم المستهدف للتلقي (الواتساب)</label>
                                        <input
                                            type="tel"
                                            placeholder="مثال: 201012345678"
                                            value={adminSchedule.phoneNumber || ''}
                                            onChange={(e) => setAdminSchedule(prev => ({ ...prev, phoneNumber: e.target.value }))}
                                            className="w-full p-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-855 dark:text-slate-150 outline-none focus:border-blue-550/40"
                                        />
                                    </div>
                                    
                                    <div className="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-150 dark:border-slate-800/80">
                                        <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 block">منصة الإرسال المحددة:</span>
                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">منصة المطورين (WhatsApp API) 🚀</span>
                                    </div>
                                </div>

                                {/* Status Card & Action */}
                                <div className="bg-blue-50/40 dark:bg-blue-950/10 border border-blue-150 dark:border-blue-900/30 p-4 rounded-2xl flex flex-col justify-between">
                                    <div className="space-y-1.5">
                                        <span className="text-[10px] font-black text-blue-700 dark:text-blue-400 block">📊 حالة الجدول الزمني للإدارة</span>
                                        <div className="text-[10px] text-slate-600 dark:text-slate-355 leading-relaxed font-bold">
                                            التنبيه القادم: <span className="text-blue-600 dark:text-blue-400 font-black">{getNextTriggerDateLabel(adminSchedule.enabled, adminSchedule.scheduleMode, adminSchedule.days, adminSchedule.date, adminSchedule.time)}</span>
                                        </div>
                                    </div>
                                    
                                    <button
                                        type="button"
                                        onClick={saveAdminSchedule}
                                        className="mt-4 w-full py-2.5 bg-blue-650 hover:bg-blue-700 text-white font-black rounded-xl border-none cursor-pointer text-xs shadow-md transition-all hover:scale-[1.01] flex items-center justify-center gap-1.5"
                                    >
                                        <Check size={16} /> حفظ إعدادات الجدولة للإدارة
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>

                    {/* Report Preview & Sharing Card */}
                    <div className="bg-white dark:bg-[#1e293b] p-6 rounded-3xl shadow-md border border-slate-150 dark:border-slate-800/80 space-y-6">
                        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <MessageSquare className="text-blue-650" size={20} /> معاينة تقرير الإدارة الأسبوعي
                        </h2>

                        <div className="space-y-4">
                            <textarea
                                value={editedAdminMessage}
                                onChange={(e) => setEditedAdminMessage(e.target.value)}
                                rows={16}
                                className="w-full p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-blue-500/30 text-xs leading-relaxed"
                            />

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                                {/* Destination Phone Input */}
                                <div className="space-y-1.5">
                                    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400">رقم الهاتف المستهدف للإرسال (اكتبه بنفسك):</label>
                                    <div className="relative">
                                        <Smartphone className="absolute right-3 top-3 text-slate-405" size={18} />
                                        <input
                                            type="tel"
                                            placeholder="مثال: 01012345678"
                                            value={adminReportPhone}
                                            onChange={(e) => {
                                                setAdminReportPhone(e.target.value);
                                                localStorage.setItem('reports_admin_phone', e.target.value);
                                            }}
                                            className="w-full pr-10 pl-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-550/40"
                                        />
                                    </div>
                                </div>

                                {/* Send Actions */}
                                <div className="flex gap-3 mt-6">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigator.clipboard.writeText(editedAdminMessage)
                                                .then(() => showToast("تم نسخ تقرير الإدارة بنجاح! 📋", "success"))
                                                .catch(() => showToast("فشل في نسخ التقرير", "error"));
                                        }}
                                        className="flex-1 flex items-center justify-center gap-1.5 py-3 px-4 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/20 dark:hover:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-250 dark:border-emerald-900/30 font-black rounded-xl text-sm transition-all cursor-pointer shadow-sm active:scale-95"
                                    >
                                        <Copy size={16} />
                                        <span>نسخ التقرير</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!adminReportPhone.trim()) {
                                                showToast("الرجاء كتابة رقم الهاتف المستهدف أولاً!", "warning");
                                                return;
                                            }
                                            let cleanPhone = adminReportPhone.replace(/\D/g, '');
                                            if (cleanPhone.startsWith('01')) {
                                                cleanPhone = '20' + cleanPhone.substring(1);
                                            } else if (cleanPhone.startsWith('+')) {
                                                cleanPhone = cleanPhone.substring(1);
                                            }
                                            const url = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(editedAdminMessage)}`;
                                            window.open(url, '_blank');
                                        }}
                                        className="flex-1 flex items-center justify-center gap-1.5 py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-black rounded-xl text-sm transition-all cursor-pointer border-none shadow-sm active:scale-95"
                                    >
                                        <ExternalLink size={16} />
                                        <span>إرسال عبر واتساب</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'periodic_schedule' && isGenAdmin && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    {/* Header Banner */}
                    <div className="bg-white dark:bg-[#1e293b] p-6 rounded-3xl border border-slate-150 dark:border-slate-800/80 shadow-md">
                        <h2 className="text-xl font-black text-slate-850 dark:text-slate-100 flex items-center gap-2">
                            <Clock className="text-blue-600" size={24} /> قائمة جداول الإرسال الدوري التلقائي سحابياً
                        </h2>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 font-bold">
                            يعرض هذا القسم جميع جداول الإرسال التلقائية التي قمت بإضافتها. يمكنك إدارة تفعيلها، تعديل تفاصيل مواعيدها، أو حذفها نهائياً.
                        </p>
                    </div>

                    {/* API Daily Limit Tracker Card */}
                    <div className="bg-white dark:bg-[#1e293b] p-6 rounded-3xl border border-slate-150 dark:border-slate-800/80 shadow-md space-y-4">
                        <div className="flex justify-between items-center">
                            <div>
                                <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                    <Sparkles className="text-amber-500" size={18} /> معدل استهلاك الحصة اليومية للـ API (٢٥٠ رسالة/يوم)
                                </h3>
                                <p className="text-[10px] text-slate-450 dark:text-slate-500 font-bold mt-0.5">يتم احتساب الاستهلاك الفعلي والخصم من الحصة اليومية فقط للرسائل التي تم إرسالها بنجاح سحابياً.</p>
                            </div>
                            <span className="px-2.5 py-1 bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 rounded-lg text-xs font-black">
                                {sentMessagesCount} / ٢٥٠ رسالة
                            </span>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-slate-100 dark:bg-slate-850 rounded-full h-3.5 overflow-hidden relative">
                            <div 
                                className={`h-full rounded-full transition-all duration-500 ${
                                    consumptionPercentage > 90 
                                    ? 'bg-rose-500' 
                                    : consumptionPercentage > 60 
                                    ? 'bg-amber-500' 
                                    : 'bg-emerald-500'
                                }`}
                                style={{ width: `${consumptionPercentage}%` }}
                            />
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                            <div className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800/60">
                                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 block">الرسائل المرسلة اليوم 🟢</span>
                                <span className="text-base font-black text-emerald-600 dark:text-emerald-450 mt-1 block">{sentMessagesCount}</span>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800/60">
                                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 block">إجمالي المجدول النشط 🕒</span>
                                <span className="text-base font-black text-blue-650 dark:text-blue-400 mt-1 block">{totalActiveScheduledMessages}</span>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800/60">
                                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 block">السعة المتبقية اليوم ☁️</span>
                                <span className={`text-base font-black mt-1 block ${remainingLimit === 0 ? 'text-rose-600 font-black' : 'text-slate-700 dark:text-slate-200'}`}>{remainingLimit}</span>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800/60">
                                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 block">نسبة الاستهلاك الفعلي</span>
                                <span className="text-base font-black text-slate-700 dark:text-slate-200 mt-1 block">{consumptionPercentage.toFixed(0)}%</span>
                            </div>
                        </div>

                        {sentMessagesCount > 250 && (
                            <div className="bg-rose-50 dark:bg-rose-955/20 border border-rose-200 dark:border-rose-900/30 p-3 rounded-2xl text-[11px] font-bold text-rose-700 dark:text-rose-455 leading-normal flex items-start gap-2 animate-bounce">
                                <AlertCircle size={18} className="text-rose-500 shrink-0 mt-0.5" />
                                <span>تنبيه هام: لقد تجاوزت الحد الأقصى اليومي المسموح به للـ API (٢٥٠ رسالة). نوصي بتعطيل أو تعديل فلاتر بعض الجداول لتجنب فشل إرسال التقارير التلقائية.</span>
                            </div>
                        )}
                    </div>

                    {/* Schedules Cards List */}
                    {schedulesLoading ? (
                        <div className="py-24 flex flex-col items-center justify-center gap-4 bg-white dark:bg-[#1e293b] rounded-3xl border border-slate-150 dark:border-slate-800/80">
                            <RefreshCw className="animate-spin text-blue-600" size={40} />
                            <p className="text-sm font-black text-slate-400 dark:text-slate-500">جاري تحميل الجداول الزمنية المخزنة...</p>
                        </div>
                    ) : schedulesList.length === 0 ? (
                        <div className="py-24 text-center bg-white dark:bg-[#1e293b] rounded-3xl p-8 border border-slate-150 dark:border-slate-800/80 shadow-sm flex flex-col items-center justify-center gap-4">
                            <Clock className="text-slate-300 dark:text-slate-700" size={48} />
                            <h3 className="text-base font-black text-slate-750 dark:text-slate-350">لا توجد جداول زمنية مسجلة حالياً</h3>
                            <p className="text-xs text-slate-450 dark:text-slate-500 max-w-lg leading-relaxed font-bold">
                                يمكنك إضافة جدول إرسال دوري جديد بالذهاب إلى تبويب **"إرسال تقارير المخدومين"** أو **"تقرير ملخص الإدارة الأسبوعي"**، وضبط تفاصيل الوقت والأيام ثم النقر على زر **"حفظ إعدادات الإرسال الدوري"**.
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {schedulesList.map(sch => {
                                const isEditing = editingScheduleId === sch.id;
                                return (
                                    <div 
                                        key={sch.id} 
                                        className={`bg-white dark:bg-[#1e293b] p-6 rounded-3xl shadow-sm border transition-all ${
                                            sch.enabled 
                                            ? 'border-slate-150 dark:border-slate-800/80 shadow-blue-500/5' 
                                            : 'border-slate-200 dark:border-slate-900 opacity-80'
                                        }`}
                                    >
                                        {/* Card Header */}
                                        <div className="flex justify-between items-center pb-4 mb-4 border-b border-slate-100 dark:border-slate-800/60">
                                            <div className="flex flex-col gap-1.5">
                                                {sch.type === 'students' ? (
                                                    <span className="px-3 py-1 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 rounded-full text-xs font-black flex items-center gap-1">
                                                        👥 تقارير المخدومين
                                                    </span>
                                                ) : (
                                                    <span className="px-3 py-1 bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 rounded-full text-xs font-black flex items-center gap-1">
                                                        📊 ملخص الإدارة
                                                    </span>
                                                )}
                                                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">
                                                    (يستهلك: {getScheduleMessageCount(sch)} رسائل)
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    disabled={isEditing}
                                                    onClick={() => toggleScheduleEnabled(sch.id, sch.enabled)}
                                                    className={`relative w-10 h-5.5 rounded-full cursor-pointer transition-all duration-300 border-none outline-none ${
                                                        sch.enabled ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-800'
                                                    } ${isEditing ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                >
                                                    <div 
                                                        className={`absolute top-0.75 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300 ${
                                                            sch.enabled ? 'right-5.25' : 'right-0.75'
                                                        }`}
                                                    />
                                                </button>
                                                <span className="text-[11px] font-bold text-slate-655 dark:text-slate-400">
                                                    {sch.enabled ? 'مفعل' : 'معطل'}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Card Body */}
                                        {isEditing ? (
                                            /* Inline Editing Form */
                                            <div className="space-y-4 pt-1 animate-in fade-in duration-200">
                                                {/* scheduleMode Toggle */}
                                                <div className="space-y-1">
                                                    <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">نمط الجدولة</label>
                                                    <div className="flex gap-2">
                                                        {['recurring', 'one_time'].map(mode => (
                                                            <button
                                                                key={mode}
                                                                type="button"
                                                                onClick={() => setEditFormData(prev => ({ ...prev, scheduleMode: mode }))}
                                                                className={`flex-1 py-1.5 px-2 rounded-lg font-bold text-[10px] border-none cursor-pointer transition-all ${
                                                                    editFormData.scheduleMode === mode
                                                                    ? 'bg-blue-600 text-white shadow-sm'
                                                                    : 'bg-slate-100 dark:bg-slate-900 text-slate-655 dark:text-slate-400'
                                                                }`}
                                                            >
                                                                {mode === 'recurring' ? 'أسبوعي' : 'تاريخ محدد'}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* Date / Day selector */}
                                                {editFormData.scheduleMode === 'one_time' ? (
                                                    <div className="space-y-1">
                                                        <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">تاريخ الإرسال</label>
                                                        <input
                                                            type="date"
                                                            value={editFormData.date || ''}
                                                            onChange={(e) => setEditFormData(prev => ({ ...prev, date: e.target.value }))}
                                                            className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-800 dark:text-slate-100 outline-none"
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className="space-y-1.5">
                                                        <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">أيام الإرسال الدوري</label>
                                                        <div className="flex flex-wrap gap-1">
                                                            {[
                                                                { key: 'friday', name: 'الجمعة' },
                                                                { key: 'saturday', name: 'السبت' },
                                                                { key: 'sunday', name: 'الأحد' },
                                                                { key: 'monday', name: 'الإثنين' },
                                                                { key: 'tuesday', name: 'الثلاثاء' },
                                                                { key: 'wednesday', name: 'الأربعاء' },
                                                                { key: 'thursday', name: 'الخميس' }
                                                            ].map(day => {
                                                                const isSelected = (editFormData.days || []).includes(day.key);
                                                                return (
                                                                    <button
                                                                        key={day.key}
                                                                        type="button"
                                                                        onClick={() => {
                                                                            const currentDays = editFormData.days || [];
                                                                            const newDays = currentDays.includes(day.key)
                                                                                ? currentDays.filter(d => d !== day.key)
                                                                                : [...currentDays, day.key];
                                                                            setEditFormData(prev => ({ ...prev, days: newDays }));
                                                                        }}
                                                                        className={`px-2.5 py-1.5 rounded-lg text-[9px] font-bold cursor-pointer transition-all border-none ${
                                                                            isSelected
                                                                            ? 'bg-blue-600 text-white shadow-sm'
                                                                            : 'bg-slate-100 dark:bg-slate-900 text-slate-650 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-850/50'
                                                                        }`}
                                                                    >
                                                                        {day.name}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Time Selector */}
                                                <div className="space-y-1">
                                                    <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">الوقت</label>
                                                    <input
                                                        type="time"
                                                        value={editFormData.time || '18:00'}
                                                        onChange={(e) => setEditFormData(prev => ({ ...prev, time: e.target.value }))}
                                                        className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-800 dark:text-slate-100 outline-none"
                                                    />
                                                </div>

                                                {/* Phone number (for admin only) */}
                                                {sch.type === 'admin' && (
                                                    <div className="space-y-1">
                                                        <label className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">الرقم المستهدف</label>
                                                        <input
                                                            type="tel"
                                                            value={editFormData.phoneNumber || ''}
                                                            onChange={(e) => setEditFormData(prev => ({ ...prev, phoneNumber: e.target.value }))}
                                                            className="w-full p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-855 dark:text-slate-150 outline-none"
                                                        />
                                                    </div>
                                                )}

                                                <div className="flex gap-2 pt-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => saveEditSchedule(sch.id)}
                                                        className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl text-xs cursor-pointer border-none shadow-sm flex items-center justify-center gap-1"
                                                    >
                                                        <Check size={14} /> حفظ التعديلات
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setEditingScheduleId(null);
                                                            setEditFormData(null);
                                                        }}
                                                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-355 font-black rounded-xl text-xs cursor-pointer border-none"
                                                    >
                                                        إلغاء
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            /* Normal Display Card */
                                            <div className="space-y-4">
                                                {/* Next Run Info */}
                                                <div className="text-xs text-slate-700 dark:text-slate-300 font-bold flex items-center gap-2">
                                                    <Clock className="text-blue-600 shrink-0" size={16} />
                                                    <span>موعد الإرسال:</span>
                                                    <strong className="text-blue-600 dark:text-blue-400">
                                                        {getNextTriggerDateLabel(sch.enabled, sch.scheduleMode, sch.days, sch.date, sch.time)}
                                                    </strong>
                                                </div>

                                                {/* Details */}
                                                <div className="grid grid-cols-2 gap-4 text-xs font-bold text-slate-500 dark:text-slate-400">
                                                    <div>نوع الإرسال: <strong className="text-slate-700 dark:text-slate-250">تلقائي سحابي ☁️</strong></div>
                                                    {sch.type === 'admin' && (
                                                        <div>رقم الواتساب: <strong className="text-slate-700 dark:text-slate-250" dir="ltr">{sch.phoneNumber || 'غير محدد'}</strong></div>
                                                    )}
                                                </div>

                                                {/* Frozen Filters badge list */}
                                                {sch.filters && (
                                                    <div className="bg-slate-50 dark:bg-slate-900/40 p-3.5 rounded-2xl border border-slate-150 dark:border-slate-800/80 space-y-2">
                                                        <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 block">🔒 الفلاتر المجمدة لتوليد هذا التقرير:</span>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {sch.type === 'students' ? (
                                                                <>
                                                                    <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 rounded-lg text-[9px] font-black">
                                                                        المرحلة: {sch.filters.selectedStage === 'all' ? 'كل المراحل' : sch.filters.selectedStage}
                                                                    </span>
                                                                    <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 rounded-lg text-[9px] font-black">
                                                                        الفصل: {sch.filters.selectedClass === 'all' ? 'كل الفصول' : sch.filters.selectedClass}
                                                                    </span>
                                                                    <span className="px-2 py-0.5 bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 rounded-lg text-[9px] font-black">
                                                                        تقرير: {sch.filters.reportType === 'monthly' ? 'شهري' : 'أسبوعي'}
                                                                    </span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 rounded-lg text-[9px] font-black">
                                                                        المراحل: {(sch.filters.selectedStages || []).join('، ')}
                                                                    </span>
                                                                    <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 rounded-lg text-[9px] font-black">
                                                                        النوع: {sch.filters.adminReportPeriod === 'weekly' ? 'ملخص أسبوعي' : 'ملخص شهري'}
                                                                    </span>
                                                                    <span className="px-2 py-0.5 bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 rounded-lg text-[9px] font-black">
                                                                        محتوى التقرير: {
                                                                            sch.filters.reportContentScope === 'both' 
                                                                            ? 'خدام ومخدومين' 
                                                                            : sch.filters.reportContentScope === 'students' 
                                                                            ? 'مخدومين فقط' 
                                                                            : 'خدام فقط'
                                                                        }
                                                                    </span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Card Actions */}
                                                <div className="flex gap-2 pt-3 border-t border-slate-100 dark:border-slate-800/60">
                                                    <button
                                                        type="button"
                                                        onClick={() => startEditingSchedule(sch)}
                                                        className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-355 font-black rounded-xl text-xs cursor-pointer border-none flex items-center justify-center gap-1.5"
                                                    >
                                                        تعديل التوقيت والمنصة
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => deleteSchedule(sch.id)}
                                                        className="px-4 py-2 bg-rose-50 hover:bg-rose-100 dark:bg-rose-955/20 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-455 font-black rounded-xl text-xs cursor-pointer border-none"
                                                    >
                                                        حذف
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Sending Logs & Retries Dashboard */}
                    <div className="bg-white dark:bg-[#1e293b] p-6 rounded-3xl border border-slate-150 dark:border-slate-800/80 shadow-md space-y-4 animate-in fade-in duration-300">
                        <div>
                            <h3 className="text-base font-black text-slate-850 dark:text-slate-100 flex items-center gap-2">
                                <Bell className="text-blue-650" size={20} /> سجل الإرسال ومراقبة قناة الاتصال (Logs & Queue Monitor)
                            </h3>
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 font-bold">
                                يعرض هذا السجل آخر عمليات الإرسال التي تمت أو التي فشلت، مع خيارات إعادة الإرسال الفوري لضمان وصول كافة التقارير.
                            </p>
                        </div>

                        {logsLoading ? (
                            <div className="py-12 flex justify-center items-center gap-2">
                                <RefreshCw className="animate-spin text-blue-600" size={24} />
                                <span className="text-xs font-bold text-slate-500">جاري تحميل سجلات الإرسال...</span>
                            </div>
                        ) : sendingLogs.length === 0 ? (
                            <div className="py-12 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col items-center justify-center gap-3">
                                <Info className="text-slate-300 dark:text-slate-700" size={32} />
                                <span className="text-xs font-black text-slate-400 dark:text-slate-500 font-bold">لا توجد سجلات إرسال مسجلة اليوم حتى الآن.</span>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-right border-collapse text-xs font-bold text-slate-700 dark:text-slate-355">
                                    <thead>
                                        <tr className="border-b border-slate-150 dark:border-slate-800/80 text-slate-400 dark:text-slate-500 font-bold">
                                            <th className="pb-3 text-right">المستلم</th>
                                            <th className="pb-3 text-right">نوع التقرير</th>
                                            <th className="pb-3 text-center">التوقيت</th>
                                            <th className="pb-3 text-center">الحالة</th>
                                            <th className="pb-3 text-center">الإجراءات</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                        {sendingLogs.map(log => (
                                            <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/10">
                                                <td className="py-3.5">
                                                    <div className="font-black text-slate-800 dark:text-slate-200">{log.recipientName}</div>
                                                    <div className="text-[10px] text-slate-450 dark:text-slate-500 mt-0.5 font-bold" dir="ltr">{log.recipientPhone}</div>
                                                </td>
                                                <td className="py-3.5">
                                                    {log.type === 'students' ? (
                                                        <span className="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 rounded-lg text-[10px] font-black">👥 مخدومين</span>
                                                    ) : (
                                                        <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 rounded-lg text-[10px] font-black">📊 إدارة</span>
                                                    )}
                                                </td>
                                                <td className="py-3.5 text-center text-[10px] text-slate-500 dark:text-slate-400">
                                                    {log.timestamp ? new Date(log.timestamp).toLocaleString('ar-EG') : 'غير محدد'}
                                                </td>
                                                <td className="py-3.5 text-center">
                                                    {log.status === 'sent' ? (
                                                        <span className="px-2 py-1 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-450 rounded-full text-[10px] font-black flex items-center justify-center gap-1 w-24 mx-auto">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> تم الإرسال
                                                        </span>
                                                    ) : log.status === 'failed' ? (
                                                        <span 
                                                            className="px-2 py-1 bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-455 rounded-full text-[10px] font-black flex items-center justify-center gap-1 w-24 mx-auto cursor-pointer"
                                                            title={log.errorMessage || "فشل غير معروف"}
                                                        >
                                                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> فشل الإرسال
                                                        </span>
                                                    ) : (
                                                        <span className="px-2 py-1 bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 rounded-full text-[10px] font-black flex items-center justify-center gap-1 w-24 mx-auto">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> قيد الانتظار
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="py-3.5 text-center">
                                                    <div className="flex justify-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => resendMessageWhatsAppWeb(log)}
                                                            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 font-black rounded-lg text-[10px] cursor-pointer border-none shadow-sm active:scale-95"
                                                            title="إرسال يدوي عبر واتساب ويب"
                                                        >
                                                            إرسال يدوي 💬
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => resendMessageApi(log)}
                                                            className="px-2 py-1 bg-blue-550 hover:bg-blue-600 text-white font-black rounded-lg text-[10px] cursor-pointer border-none shadow-sm active:scale-95"
                                                            title="إعادة المحاولة تلقائياً عبر API"
                                                        >
                                                            إعادة عبر API 🚀
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'webhook_bot' && isGenAdmin && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    {/* Header Banner */}
                    <div className="bg-white dark:bg-[#1e293b] p-6 rounded-3xl border border-slate-150 dark:border-slate-800/80 shadow-md">
                        <h2 className="text-xl font-black text-slate-850 dark:text-slate-100 flex items-center gap-2">
                            <MessageSquare className="text-blue-600" size={24} /> نظام الاستعلام التفاعلي بالرسائل (Webhook Bot)
                        </h2>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 font-bold">
                            تتيح هذه الميزة لأولياء الأمور إرسال كود المخدوم إلى رقم الواتساب الخاص بالخدمة، ليقوم النظام بالتحقق أمنياً وإرسال التقرير الشهري للطفل تلقائياً وفورياً.
                        </p>
                    </div>

                    {/* Bot Setup Card */}
                    <div className="bg-white dark:bg-[#1e293b] p-6 rounded-3xl border border-slate-150 dark:border-slate-800/80 shadow-md space-y-6">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                            <div>
                                <h3 className="text-sm font-black text-slate-800 dark:text-slate-100">
                                    تفعيل البوت التفاعلي السحابي
                                </h3>
                                <p className="text-[10px] text-slate-450 dark:text-slate-500 font-bold mt-0.5">عند تعطيل البوت، لن يقوم النظام بالرد على رسائل أولياء الأمور الواردة.</p>
                            </div>
                            <button
                                onClick={toggleWebhookBot}
                                className={`px-5 py-2.5 rounded-xl font-bold text-xs transition-all cursor-pointer flex items-center gap-2 border-none ${
                                    webhookBotEnabled
                                    ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-md shadow-emerald-650/20'
                                    : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-700'
                                }`}
                            >
                                <span className={`w-2.5 h-2.5 rounded-full ${webhookBotEnabled ? 'bg-white animate-pulse' : 'bg-slate-400'}`}></span>
                                {webhookBotEnabled ? 'البوت نشط ويعمل حالياً' : 'البوت معطل ومغلق'}
                            </button>
                        </div>

                        {/* Meta API Setup Info */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="text-[11px] font-black text-slate-500 dark:text-slate-400">رابط الـ Webhook (كتابة الرابط في Meta Dashboard)</label>
                                <div className="flex gap-2">
                                    <input 
                                        type="text" 
                                        readOnly 
                                        value="https://server-ochre-one-17.vercel.app/api/webhook" 
                                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 text-xs px-3.5 py-2.5 rounded-xl text-slate-600 dark:text-slate-300 font-mono outline-none"
                                    />
                                    <button 
                                        onClick={() => handleCopyText('https://server-ochre-one-17.vercel.app/api/webhook', 'رابط الـ Webhook')}
                                        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl border-none cursor-pointer transition-all"
                                    >
                                        نسخ
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[11px] font-black text-slate-500 dark:text-slate-400">رمز التحقق (Verify Token في Meta Dashboard)</label>
                                <div className="flex gap-2">
                                    <input 
                                        type="text" 
                                        readOnly 
                                        value="KhidmetyVerifyToken123" 
                                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 text-xs px-3.5 py-2.5 rounded-xl text-slate-600 dark:text-slate-300 font-mono outline-none"
                                    />
                                    <button 
                                        onClick={() => handleCopyText('KhidmetyVerifyToken123', 'رمز التحقق')}
                                        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl border-none cursor-pointer transition-all"
                                    >
                                        نسخ
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Query Logs Dashboard */}
                    <div className="bg-white dark:bg-[#1e293b] p-6 rounded-3xl border border-slate-150 dark:border-slate-800/80 shadow-md space-y-4">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-2 border-b border-slate-100 dark:border-slate-800">
                            <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                <List className="text-blue-600" size={18} /> سجل عمليات الاستعلام اللحظي بالواتساب
                            </h3>
                            
                            {/* Filter Status Buttons */}
                            <div className="flex items-center gap-3 shrink-0">
                                {webhookLogs.length > 0 && (
                                    <button
                                        onClick={handleClearAllWebhookLogs}
                                        className="p-2 text-rose-500 hover:text-rose-700 bg-transparent border-none cursor-pointer hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-xl transition-all flex items-center gap-1 font-bold text-[10px]"
                                        title="مسح السجل بالكامل"
                                    >
                                        <Trash2 size={13} />
                                        تفريغ السجل
                                    </button>
                                )}
                                <div className="flex gap-1 bg-slate-100 dark:bg-slate-900 p-0.5 rounded-xl border border-slate-200/40 dark:border-slate-800">
                                <button
                                    onClick={() => setWebhookFilterStatus('all')}
                                    className={`px-3 py-1 rounded-lg text-[10px] font-black border-none cursor-pointer transition-all ${
                                        webhookFilterStatus === 'all'
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 bg-transparent'
                                    }`}
                                >
                                    الكل
                                </button>
                                <button
                                    onClick={() => setWebhookFilterStatus('sent')}
                                    className={`px-3 py-1 rounded-lg text-[10px] font-black border-none cursor-pointer transition-all ${
                                        webhookFilterStatus === 'sent'
                                        ? 'bg-emerald-600 text-white shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 bg-transparent'
                                    }`}
                                >
                                    تم الرد ✅
                                </button>
                                <button
                                    onClick={() => setWebhookFilterStatus('failed')}
                                    className={`px-3 py-1 rounded-lg text-[10px] font-black border-none cursor-pointer transition-all ${
                                        webhookFilterStatus === 'failed'
                                        ? 'bg-rose-600 text-white shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 bg-transparent'
                                    }`}
                                >
                                    مرفوض ❌
                                </button>
                            </div>
                            </div>
                        </div>

                        {webhookLogsLoading ? (
                            <div className="flex flex-col items-center justify-center py-10 gap-2.5">
                                <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                <span className="text-xs text-slate-400 font-bold">جاري تحميل سجل الاستعلامات...</span>
                            </div>
                        ) : filteredWebhookLogs.length === 0 ? (
                            <div className="text-center py-12 space-y-2">
                                <div className="w-14 h-14 bg-slate-50 dark:bg-slate-900 rounded-full flex items-center justify-center mx-auto text-slate-350 dark:text-slate-700">
                                    <MessageSquare size={24} />
                                </div>
                                <h4 className="text-xs font-black text-slate-700 dark:text-slate-300">لا توجد عمليات استعلام مطابقة</h4>
                                <p className="text-[10px] text-slate-450 dark:text-slate-500 font-bold">لم يتم تسجيل عمليات بالفلتر المحدد حالياً.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-right border-collapse">
                                    <thead>
                                        <tr className="border-b border-slate-150 dark:border-slate-800/80 text-slate-400 dark:text-slate-500 font-bold text-[11px]">
                                            <th className="pb-3 pr-2">رقم المرسل</th>
                                            <th className="pb-3">كود المخدوم</th>
                                            <th className="pb-3">اسم المخدوم</th>
                                            <th className="pb-3">حالة العملية</th>
                                            <th className="pb-3">تفاصيل/السبب</th>
                                            <th className="pb-3">الوقت</th>
                                            <th className="pb-3 pl-2 text-center">مسح</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                                        {filteredWebhookLogs.map((logItem) => (
                                            <tr key={logItem.id} className="text-xs text-slate-650 dark:text-slate-300 font-semibold hover:bg-slate-50/50 dark:hover:bg-slate-900/10 transition-all">
                                                <td className="py-3.5 pr-2 font-mono">
                                                    <div>{logItem.senderPhone}</div>
                                                    {logItem.senderInfo && (
                                                        <div className="text-[10px] text-blue-600 dark:text-blue-400 font-bold mt-0.5" style={{ direction: 'rtl' }}>
                                                            👤 {logItem.senderInfo}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="py-3.5 font-mono">{logItem.studentCode}</td>
                                                <td className="py-3.5 font-black text-slate-800 dark:text-white">{logItem.studentName}</td>
                                                <td className="py-3.5">
                                                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black ${
                                                        logItem.status === 'sent'
                                                        ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400'
                                                        : 'bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-455'
                                                    }`}>
                                                        {logItem.status === 'sent' ? (
                                                            <>
                                                                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                                                                تم الرد والارسال ✅
                                                            </>
                                                        ) : (
                                                            <>
                                                                <span className="w-1.5 h-1.5 bg-rose-500 rounded-full"></span>
                                                                مرفوض ❌
                                                            </>
                                                        )}
                                                    </span>
                                                </td>
                                                <td className="py-3.5 text-[10px] text-slate-450 dark:text-slate-500 font-bold max-w-[200px] truncate">
                                                    {logItem.status === 'sent' ? 'تم تسليم التقرير بنجاح' : (logItem.reason || 'فشل التحقق أمنياً')}
                                                </td>
                                                <td className="py-3.5 text-[10px] text-slate-450 dark:text-slate-500 font-bold">
                                                    {logItem.timestamp ? new Date(logItem.timestamp).toLocaleString('ar-EG', { hour12: true }) : ''}
                                                </td>
                                                <td className="py-3.5 pl-2 text-center">
                                                    <button
                                                        onClick={() => handleDeleteWebhookLog(logItem.id)}
                                                        className="p-1.5 text-slate-400 hover:text-rose-600 bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg border-none cursor-pointer transition-all"
                                                        title="مسح من السجل"
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Custom toast alerts */}
            {toast.show && (
                <div className={`fixed bottom-5 left-5 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-2xl border transition-all duration-300 animate-in fade-in slide-in-from-bottom-5 ${
                    toast.type === 'error' 
                    ? 'bg-rose-50 dark:bg-rose-950/90 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200' 
                    : 'bg-emerald-50 dark:bg-emerald-950/95 border-emerald-250 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                }`}>
                    {toast.type === 'error' ? (
                        <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                    ) : (
                        <Check className="w-5 h-5 text-emerald-500 shrink-0" />
                    )}
                    <span className="font-bold text-sm leading-relaxed">{toast.message}</span>
                    <button onClick={() => setToast(prev => ({ ...prev, show: false }))} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ml-2 bg-transparent border-none cursor-pointer">
                        <X size={16} />
                    </button>
                </div>
            )}
        </div>
    );
}
