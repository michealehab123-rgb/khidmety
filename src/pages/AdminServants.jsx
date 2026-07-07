import { useState, useEffect, useMemo } from 'react';
import { collection, addDoc, onSnapshot, query, where, getDocs, db, doc, deleteDoc, setDoc, updateDoc } from '../firebase';
import { UserPlus, Search, Users, Shield, MapPin, Phone, Hash, Lock, Briefcase, Mail, Trash2, Calendar, Check, ClipboardList, FileSpreadsheet } from 'lucide-react';
import { Navigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { exportServantsToExcel, exportToExcelGeneric } from '../utils/excelExport';

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

const getFridaysInMonth = (year, month) => {
    const fridays = [];
    const minFriday = new Date(2026, 5, 19); // Friday June 19, 2026
    minFriday.setHours(0, 0, 0, 0);
    
    const date = new Date(year, month - 1, 1);
    
    // Find the first Friday of the month
    while (date.getDay() !== 5) {
        date.setDate(date.getDate() + 1);
    }
    
    // Add all Fridays of the month that are >= minFriday
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

export default function AdminServants() {
    const { user, servant, isGeneralAdmin, loading, authorizedClasses } = useAuth();
    const location = useLocation();
    const [servants, setServants] = useState([]);
    const [allServants, setAllServants] = useState([]);
    const [servantsLoading, setServantsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [showAddForm, setShowAddForm] = useState(false);
    const [selectedStage, setSelectedStage] = useState('');
    const [selectedClass, setSelectedClass] = useState('');

    const [activeTab, setActiveTab] = useState('current'); // 'current', 'requests', or 'followup'
    const [selectedWeekKey, setSelectedWeekKey] = useState(() => weeksList[0].key);
    const [reportType, setReportType] = useState('weekly'); // 'weekly' or 'monthly'
    const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
    const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
    const [followUpFilter, setFollowUpFilter] = useState('all');
    const [pendingServants, setPendingServants] = useState([]);
    const [pendingLoading, setPendingLoading] = useState(true);
    const [isRegOpen, setIsRegOpen] = useState(true);

    const handleApprove = async (id) => {
        try {
            await updateDoc(doc(db, 'servants', id), { status: 'approved' });
            alert('تم قبول الخادم وتفعيل الحساب بنجاح ✅');
        } catch (error) {
            console.error("Error approving servant:", error);
            alert("حدث خطأ أثناء القبول");
        }
    };

    const handleReject = async (id) => {
        const confirmReject = window.confirm("هل أنت متأكد من رفض هذا الطلب وحذفه نهائياً؟");
        if (!confirmReject) return;
        try {
            await deleteDoc(doc(db, 'servants', id));
            alert('تم رفض وحذف طلب تسجيل الخادم نهائياً ❌');
        } catch (error) {
            console.error("Error rejecting servant:", error);
            alert("حدث خطأ أثناء الرفض");
        }
    };

    const handleToggleRegistration = async () => {
        try {
            await setDoc(doc(db, 'settings', 'registration'), {
                isRegistrationOpen: !isRegOpen
            }, { merge: true });
        } catch (error) {
            console.error("Error toggling registration:", error);
            alert("حدث خطأ أثناء تعديل إعدادات التسجيل");
        }
    };

    // Resolve Stage Admin / Class Servant
    const roleNorm = servant?.role ? normalizeArabic(servant.role) : '';
    const isStageServant = roleNorm === 'امين مرحله';
    const isClassServant = roleNorm === 'امين فصل' || roleNorm === 'خادم فصل' || roleNorm === 'خادم';
    const isAuthorized = isGeneralAdmin || isStageServant;

    // Resolve Stage Admin's stage scope
    const rawStage = servant ? (servant.assignedStage || servant.grade || '') : '';
    const normalizedRawStage = normalizeArabic(rawStage);
    let myStage = 'الكل';
    if (normalizedRawStage.includes('ابتدائي')) myStage = 'ابتدائي';
    else if (normalizedRawStage.includes('اعدادي')) myStage = 'اعدادي';
    else if (normalizedRawStage.includes('ثانوي')) myStage = 'ثانوي';
    
    const [formData, setFormData] = useState({
        name: '',
        phone: '',
        address: '',
        birthDate: '',
        code: '',
        password: '',
        role: 'امين فصل',
        assignedStage: '',
        assignedClass: '',
        managedClasses: [],
        myClasses: []
    });

    // Auto-populate stage for Stage Servant
    useEffect(() => {
        if (isStageServant && myStage && myStage !== 'الكل') {
            setFormData(prev => ({
                ...prev,
                assignedStage: myStage
            }));
            setSelectedStage(myStage);
        }
    }, [isStageServant, myStage]);

    useEffect(() => {
        const prefilledStage = location.state?.prefilledStage;
        const prefilledClass = location.state?.prefilledClass;

        if (prefilledStage !== undefined && prefilledClass !== undefined) {
            setSelectedStage(prefilledStage);
            setSelectedClass(prefilledClass);
            window.history.replaceState({}, document.title);
        }
    }, [location]);

    const authorizedClassesStr = (authorizedClasses || []).join(',');
    
    // Default selectedClass for non-general admin
    useEffect(() => {
        if (!isGeneralAdmin && authorizedClasses && authorizedClasses.length > 0) {
            if (authorizedClasses.length === 1) {
                setSelectedClass(authorizedClasses[0]);
            } else if (selectedClass !== '' && !authorizedClasses.includes(selectedClass)) {
                setSelectedClass(authorizedClasses[0]);
            }
        }
    }, [isGeneralAdmin, authorizedClassesStr, selectedClass]);

    useEffect(() => {
        // Gate 1: Check Auth loading
        if (loading) {
            console.log("AdminServants Fetch -> Auth is still loading, bypassing listener setup.");
            return;
        }

        // Gate 2: If we are not General Admin, servant must be resolved
        if (!isGeneralAdmin && !servant) {
            console.log("AdminServants Fetch -> Servant data is undefined, bypassing listener setup.");
            return;
        }

        // Gate 3: Check authorization
        if (!isAuthorized) {
            console.log("AdminServants Fetch -> User is not authorized, bypassing listener setup.");
            return;
        }

        console.log("AdminServants Fetch -> Subscribing to 'servants' collection. Admin Stage:", myStage);

        const servantsRef = collection(db, 'servants');

        const unsub = onSnapshot(servantsRef, (snapshot) => {
            console.log("AdminServants Fetch -> Total fetched from Firestore:", snapshot.size, "Admin Stage:", myStage);

            const allList = snapshot.docs.map(doc => {
                const data = doc.data();
                // Sanitize name if it's an object
                const sanitizedName = typeof data.name === 'object' ? data.name.name : data.name;
                return { id: doc.id, ...data, name: sanitizedName || '' };
            });

            setAllServants(allList);

            let list = allList.filter(s => s.status !== 'pending' && s.status !== 'rejected' && s.status !== 'deleted');

            // Client-Side Scoped Filtering for Stage/Class Admins
            if (!isGeneralAdmin) {
                const myAuthorizedNorm = (authorizedClasses || []).map(c => normalizeArabic(c));
                list = list.filter(s => {
                    const sRoleNorm = normalizeArabic(s.role || '');
                    
                    // Strictly exclude other Stage Admins
                    if (sRoleNorm.includes('مرحله')) return false;

                    const sClasses = s.myClasses || (s.assignedClass ? [s.assignedClass] : []);
                    const sClassesNorm = sClasses.map(c => normalizeArabic(c));
                    const sManagedNorm = (s.managedClasses || []).map(c => normalizeArabic(c));
                    const allServantClassesNorm = [...sClassesNorm, ...sManagedNorm];
                    
                    return allServantClassesNorm.some(cls => myAuthorizedNorm.includes(cls));
                });
            }

            setServants(list);
            
            // Auto code assignment
            const targetStage = isStageServant ? myStage : (formData.assignedStage || '');
            const nextCode = calculateFirstAvailableCode(allList, targetStage);
            setFormData(prev => ({ 
                ...prev, 
                code: nextCode, 
                password: nextCode,
                assignedStage: isStageServant ? myStage : prev.assignedStage
            }));

            setServantsLoading(false);
        }, (error) => {
            console.error("Error fetching servants:", error);
            setServantsLoading(false);
        });

        return () => unsub();
    }, [servant, isGeneralAdmin, isAuthorized, loading, myStage, authorizedClassesStr]);

    // 1. Listen to registration settings
    useEffect(() => {
        const docRef = doc(db, 'settings', 'registration');
        const unsub = onSnapshot(docRef, (snap) => {
            if (snap.exists()) {
                setIsRegOpen(snap.data().isRegistrationOpen !== false);
            } else {
                setIsRegOpen(true);
            }
        });
        return () => unsub();
    }, []);

    // 2. Listen to pending requests
    useEffect(() => {
        if (!isAuthorized) return;
        const q = query(collection(db, 'servants'), where('status', '==', 'pending'));
        const unsub = onSnapshot(q, (snapshot) => {
            let list = snapshot.docs.map(doc => {
                const data = doc.data();
                const sanitizedName = typeof data.name === 'object' ? data.name.name : data.name;
                return { id: doc.id, ...data, name: sanitizedName || '' };
            });
            // Client-Side Scoped Filtering for Stage Admins
            if (!isGeneralAdmin) {
                const myAuthorizedNorm = (authorizedClasses || []).map(c => normalizeArabic(c));
                list = list.filter(s => {
                    const sRoleNorm = normalizeArabic(s.role || '');
                    if (sRoleNorm.includes('مرحله')) return false;

                    const sClasses = s.myClasses || (s.assignedClass ? [s.assignedClass] : []);
                    const sClassesNorm = sClasses.map(c => normalizeArabic(c));
                    const sManagedNorm = (s.managedClasses || []).map(c => normalizeArabic(c));
                    const allServantClassesNorm = [...sClassesNorm, ...sManagedNorm];
                    return allServantClassesNorm.some(cls => myAuthorizedNorm.includes(cls));
                });
            }
            setPendingServants(list);
            setPendingLoading(false);
        }, (error) => {
            console.error("Error fetching pending servants:", error);
            setPendingLoading(false);
        });
        return () => unsub();
    }, [isAuthorized, isGeneralAdmin, authorizedClassesStr]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
                <p className="text-lg font-medium text-gray-600 dark:text-slate-400">جاري التحميل...</p>
            </div>
        );
    }

    if (!isAuthorized) {
        return (
            <div className="min-h-[70vh] flex flex-col items-center justify-center p-4">
                <div className="bg-white dark:bg-[#1e293b] p-8 md:p-12 rounded-3xl shadow-xl border border-red-100 dark:border-red-955/30 max-w-md w-full text-center space-y-6 animate-in fade-in zoom-in-95 duration-300">
                    <div className="w-20 h-20 bg-red-50 dark:bg-red-955/20 text-red-500 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                        <Shield className="w-12 h-12" />
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100">وصول غير مصرح به</h2>
                        <p className="text-slate-550 dark:text-slate-400 font-medium leading-relaxed">
                            عذراً، هذه الصفحة مخصصة للمشرفين وأمناء المراحل فقط. لا تملك الصلاحيات الكافية لاستعراض بيانات الخدام.
                        </p>
                    </div>
                    <div className="pt-4">
                        <Link
                            to="/servant/profile"
                            className="inline-flex items-center justify-center w-full px-6 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-200 dark:shadow-none transition-all active:scale-[0.98]"
                        >
                            العودة للرئيسه
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    const handleRoleChange = (newRole) => {
        const nextStage = isStageServant ? myStage : '';
        const nextCode = calculateFirstAvailableCode(allServants, nextStage);
        setFormData(prev => ({
            ...prev,
            role: newRole,
            assignedStage: nextStage,
            code: nextCode,
            password: nextCode,
            assignedClass: '',
            managedClasses: [],
            myClasses: []
        }));
    };

    const handleStageChange = (newStage) => {
        const nextCode = calculateFirstAvailableCode(allServants, newStage);
        setFormData(prev => ({
            ...prev,
            assignedStage: newStage,
            code: nextCode,
            password: nextCode,
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

    const handleAddServant = async (e) => {
        e.preventDefault();
        
        // Basic Validation
        const finalStage = isGeneralAdmin ? formData.assignedStage : myStage;
        if (!formData.name || !formData.password || !finalStage || finalStage === 'الكل') {
            alert('برجاء ملء الحقول الأساسية وتحديد المرحلة الدراسية بشكل صحيح (الاسم، كلمة المرور، المرحلة)');
            return;
        }

        try {
            // Fetch all existing servants to guarantee fresh gap check
            const servantsSnap = await getDocs(collection(db, 'servants'));
            const servantsList = servantsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Dynamically calculate the first available code for the stage
            const finalCode = calculateFirstAvailableCode(servantsList, finalStage);

            // Check if there is an existing rejected or deleted servant with this code
            const rejectedServant = servantsList.find(s => 
                String(s.code || s.servantCode) === String(finalCode) && 
                (s.status === 'rejected' || s.status === 'deleted')
            );

            if (rejectedServant) {
                console.log("Found rejected servant in firestore with code", finalCode, ". Deleting document to avoid duplicate...");
                try {
                    await deleteDoc(doc(db, 'servants', rejectedServant.id));
                } catch (err) {
                    console.error("Error deleting rejected servant document:", err);
                }
            }

            const autoGeneratedEmail = `${finalCode}@church.com`;

            // If they didn't customize the password, update it to match the new code
            const isPasswordDefault = formData.password === formData.code;
            const finalPassword = isPasswordDefault ? finalCode : formData.password;

            const payload = {
                name: formData.name,
                phone: formData.phone,
                address: formData.address,
                birthDate: formData.birthDate || '',
                code: finalCode,
                email: autoGeneratedEmail,
                password: finalPassword,
                role: formData.role,
                assignedStage: finalStage,
                grade: finalStage, // Backward compatibility
                status: 'approved',
                createdAt: new Date().toISOString()
            };

            if (formData.role === 'امين مرحله') {
                payload.managedClasses = formData.managedClasses || [];
                payload.assignedClass = '';
                payload.assignment = '';
                payload.myClasses = [];
            } else {
                payload.myClasses = formData.myClasses || [];
                payload.assignedClass = formData.myClasses?.[0] || '';
                payload.assignment = formData.myClasses?.[0] || ''; // Backward compatibility
                payload.managedClasses = [];
            }

            await setDoc(doc(db, 'servants', finalCode), payload);

            setFormData({
                name: '',
                phone: '',
                address: '',
                birthDate: '',
                code: '',
                password: '',
                role: 'امين فصل',
                assignedStage: isStageServant ? myStage : '',
                assignedClass: '',
                managedClasses: [],
                myClasses: []
            });
            setShowAddForm(false);
            alert(`تم إضافة الخادم بنجاح بكود: ${finalCode}`);
        } catch (error) {
            console.error("Error adding servant:", error);
            alert('حدث خطأ أثناء الإضافة');
        }
    };

    const handleDeleteServant = async (servantId) => {
        const confirmDelete = window.confirm("هل أنت متأكد من حذف هذا الخادم نهائياً؟ لا يمكن التراجع عن هذا الإجراء.");
        if (!confirmDelete) return;

        const targetServant = servants.find(s => s.id === servantId);
        if (!targetServant) {
            alert('عذراً، لم يتم العثور على بيانات الخادم.');
            return;
        }

        if (isStageServant) {
            const targetStageNorm = normalizeArabic(targetServant.assignedStage || targetServant.grade || '');
            const myStageNorm = normalizeArabic(myStage);
            if (targetStageNorm !== myStageNorm) {
                alert('خطأ أمني: لا تملك صلاحية حذف خادم خارج نطاق مرحلتك الدراسية.');
                return;
            }
        }

        try {
            await deleteDoc(doc(db, 'servants', servantId));
            setServants(prev => prev.filter(s => s.id !== servantId));
            alert("تم حذف حساب الخادم نهائياً 🗑️");
        } catch (error) {
            console.error("Error deleting servant:", error);
            alert("حدث خطأ أثناء حذف الخادم. يرجى المحاولة مرة أخرى.");
        }
    };

    const handleExportCurrentServantsExcel = () => {
        if (filteredServants.length === 0) return;
        const headers = [
            'م',
            'اسم الخادم',
            'كود الخادم',
            'رقم التليفون',
            'العنوان',
            'المسؤولية',
            'المرحلة',
            'الفصل المسؤول عنه',
            'تاريخ الميلاد'
        ];
        const rows = filteredServants.map((s, idx) => {
            const nameStr = typeof s.name === 'object' ? s.name.name : s.name;
            return [
                idx + 1,
                nameStr || '',
                s.code || s.servantCode || '',
                s.phone || '',
                s.address || '',
                s.role || '',
                s.assignedStage || '',
                s.myClasses && s.myClasses.length > 0 ? s.myClasses.join('، ') : (s.assignedClass || ''),
                s.birthDate || ''
            ];
        });
        
        exportToExcelGeneric(headers, rows, 'قائمة الخدام الحاليين', `كشف_الخدام_الحاليين_تاريخ_${new Date().toISOString().split('T')[0]}_فصل_${selectedClass || selectedStage || 'الكل'}`);
    };

    const handleExportFollowUpExcel = () => {
        if (followUpFilteredServants.length === 0) return;
        
        let headers = [];
        let rows = [];
        const titleStr = reportType === 'weekly' ? `تقرير متابعة أسبوعي - ${selectedWeekKey}` : `تقرير متابعة شهري`;

        if (reportType === 'weekly') {
            headers = [
                'م',
                'اسم الخادم',
                'كود الخادم',
                'الفصول المسؤولة',
                'حضور الخدمة',
                'حضور القداس',
                'حضور اجتماع الخدام',
                'التحضير للدرس'
            ];
            rows = followUpFilteredServants.map((s, idx) => {
                const nameStr = typeof s.name === 'object' ? s.name.name : s.name;
                const fData = s.weeklyFollowUp?.[selectedWeekKey] || {};
                return [
                    idx + 1,
                    nameStr || '',
                    s.code || s.servantCode || '',
                    s.myClasses && s.myClasses.length > 0 ? s.myClasses.join('، ') : (s.assignedClass || ''),
                    fData.attendanceService ? 'حاضر ✅' : 'غائب ❌',
                    fData.attendanceLiturgy ? 'حاضر ✅' : 'غائب ❌',
                    fData.attendanceMeeting ? 'حاضر ✅' : 'غائب ❌',
                    fData.preparation ? 'تم التحضير ✅' : 'لم يحضر ❌'
                ];
            });
        } else {
            headers = [
                'م',
                'اسم الخادم',
                'كود الخادم',
                'الفصول المسؤولة',
                'نسبة حضور الخدمة',
                'نسبة حضور القداس',
                'نسبة حضور الاجتماع',
                'نسبة التحضير'
            ];
            rows = followUpFilteredServants.map((s, idx) => {
                const nameStr = typeof s.name === 'object' ? s.name.name : s.name;
                
                // Calculate percentages for this month
                const fridays = currentFridaysOfMonth;
                let serviceCount = 0;
                let liturgyCount = 0;
                let meetingCount = 0;
                let prepCount = 0;
                
                fridays.forEach(fri => {
                    const fData = s.weeklyFollowUp?.[fri.key] || {};
                    if (fData.attendanceService) serviceCount++;
                    if (fData.attendanceLiturgy) liturgyCount++;
                    if (fData.attendanceMeeting) meetingCount++;
                    if (fData.preparation) prepCount++;
                });
                
                const total = fridays.length || 1;
                const getPct = count => `${Math.round((count / total) * 100)}% (${count}/${total})`;

                return [
                    idx + 1,
                    nameStr || '',
                    s.code || s.servantCode || '',
                    s.myClasses && s.myClasses.length > 0 ? s.myClasses.join('، ') : (s.assignedClass || ''),
                    getPct(serviceCount),
                    getPct(liturgyCount),
                    getPct(meetingCount),
                    getPct(prepCount)
                ];
            });
        }

        const fileName = `تقرير_متابعة_خدام_تاريخ_${reportType === 'weekly' ? selectedWeekKey : 'شهري'}_فصل_${selectedClass || selectedStage || 'الكل'}`;
        exportToExcelGeneric(headers, rows, titleStr, fileName);
    };

    const handleToggleWeeklyFollowUp = async (servantId, weekKey, field, currentValue) => {
        const s = servants.find(x => x.id === servantId);
        if (!s) return;
        
        const updatedWeeklyFollowUp = {
            ...(s.weeklyFollowUp || {}),
            [weekKey]: {
                ...(s.weeklyFollowUp?.[weekKey] || {}),
                [field]: !currentValue
            }
        };

        try {
            await updateDoc(doc(db, 'servants', servantId), {
                weeklyFollowUp: updatedWeeklyFollowUp
            });
        } catch (error) {
            console.error("Error updating weekly follow-up by admin:", error);
            alert('حدث خطأ أثناء حفظ التحديث');
        }
    };

    const filteredServants = servants.filter(s => {
        const term = searchTerm.toLowerCase();
        const matchesSearch = (
            (s.name && s.name.toLowerCase().includes(term)) ||
            (s.code && s.code.toLowerCase().includes(term))
        );
        if (!matchesSearch) return false;

        if (selectedStage && s.assignedStage !== selectedStage) return false;
        if (selectedClass) {
            const sClasses = s.myClasses || (s.assignedClass ? [s.assignedClass] : []);
            const isManaged = s.managedClasses?.includes(selectedClass);
            const isAssigned = sClasses.includes(selectedClass);
            if (!isManaged && !isAssigned) return false;
        }

        return true;
    });

    const currentFridaysOfMonth = useMemo(() => {
        return getFridaysInMonth(selectedYear, selectedMonth);
    }, [selectedYear, selectedMonth]);

    const followUpActiveServants = useMemo(() => {
        if (activeTab !== 'followup') return [];

        return filteredServants.filter(s => {
            if (reportType === 'weekly') {
                return isServantActiveInWeek(s, selectedWeekKey);
            } else {
                return currentFridaysOfMonth.some(fKey => isServantActiveInWeek(s, fKey));
            }
        });
    }, [filteredServants, activeTab, reportType, selectedWeekKey, currentFridaysOfMonth]);

    const followUpFilteredServants = useMemo(() => {
        if (followUpFilter === 'all') return followUpActiveServants;

        return followUpActiveServants.filter(s => {
            if (reportType === 'weekly') {
                const fData = s.weeklyFollowUp?.[selectedWeekKey] || {};
                switch (followUpFilter) {
                    case 'liturgy_attended': return fData.attendanceLiturgy === true;
                    case 'liturgy_absent': return fData.attendanceLiturgy !== true;
                    case 'service_attended': return fData.attendanceService === true;
                    case 'service_absent': return fData.attendanceService !== true;
                    case 'meeting_attended': return fData.attendanceMeeting === true;
                    case 'meeting_absent': return fData.attendanceMeeting !== true;
                    case 'prep_completed': return fData.preparation === true;
                    case 'prep_absent': return fData.preparation !== true;
                    default: return true;
                }
            } else {
                const servantActiveFridays = currentFridaysOfMonth.filter(fKey => isServantActiveInWeek(s, fKey));
                let attService = 0;
                let attLiturgy = 0;
                let attMeeting = 0;
                let prepLesson = 0;

                servantActiveFridays.forEach(fKey => {
                    const fData = s.weeklyFollowUp?.[fKey] || {};
                    if (fData.attendanceService) attService++;
                    if (fData.attendanceLiturgy) attLiturgy++;
                    if (fData.attendanceMeeting) attMeeting++;
                    if (fData.preparation) prepLesson++;
                });

                switch (followUpFilter) {
                    case 'liturgy_attended': return attLiturgy > 0;
                    case 'liturgy_absent': return attLiturgy === 0;
                    case 'service_attended': return attService > 0;
                    case 'service_absent': return attService === 0;
                    case 'meeting_attended': return attMeeting > 0;
                    case 'meeting_absent': return attMeeting === 0;
                    case 'prep_completed': return prepLesson > 0;
                    case 'prep_absent': return prepLesson === 0;
                    default: return true;
                }
            }
        });
    }, [followUpActiveServants, reportType, selectedWeekKey, currentFridaysOfMonth, followUpFilter]);

    const followUpStats = useMemo(() => {
        const totalServants = followUpActiveServants.length;
        if (totalServants === 0) {
            return { service: 0, liturgy: 0, meeting: 0, prep: 0, details: {} };
        }

        if (reportType === 'weekly') {
            let serviceCount = 0;
            let liturgyCount = 0;
            let meetingCount = 0;
            let prepCount = 0;
            
            followUpActiveServants.forEach(s => {
                const data = s.weeklyFollowUp?.[selectedWeekKey] || {};
                if (data.attendanceService) serviceCount++;
                if (data.attendanceLiturgy) liturgyCount++;
                if (data.attendanceMeeting) meetingCount++;
                if (data.preparation) prepCount++;
            });
            
            return {
                service: Math.round((serviceCount / totalServants) * 100),
                liturgy: Math.round((liturgyCount / totalServants) * 100),
                meeting: Math.round((meetingCount / totalServants) * 100),
                prep: Math.round((prepCount / totalServants) * 100),
                details: {
                    service: `${serviceCount} من ${totalServants}`,
                    liturgy: `${liturgyCount} من ${totalServants}`,
                    meeting: `${meetingCount} من ${totalServants}`,
                    prep: `${prepCount} من ${totalServants}`
                }
            };
        } else {
            const fridaysCount = currentFridaysOfMonth.length;
            if (fridaysCount === 0) {
                return { service: 0, liturgy: 0, meeting: 0, prep: 0, details: {} };
            }
            
            let serviceCount = 0;
            let liturgyCount = 0;
            let meetingCount = 0;
            let prepCount = 0;
            let totalPossible = 0;
            
            followUpActiveServants.forEach(s => {
                const servantActiveFridays = currentFridaysOfMonth.filter(fKey => isServantActiveInWeek(s, fKey));
                totalPossible += servantActiveFridays.length;
                
                servantActiveFridays.forEach(fKey => {
                    const data = s.weeklyFollowUp?.[fKey] || {};
                    if (data.attendanceService) serviceCount++;
                    if (data.attendanceLiturgy) liturgyCount++;
                    if (data.attendanceMeeting) meetingCount++;
                    if (data.preparation) prepCount++;
                });
            });
            
            if (totalPossible === 0) {
                return { service: 0, liturgy: 0, meeting: 0, prep: 0, details: {} };
            }

            return {
                service: Math.round((serviceCount / totalPossible) * 100),
                liturgy: Math.round((liturgyCount / totalPossible) * 100),
                meeting: Math.round((meetingCount / totalPossible) * 100),
                prep: Math.round((prepCount / totalPossible) * 100),
                details: {
                    service: `${serviceCount} من ${totalPossible}`,
                    liturgy: `${liturgyCount} من ${totalPossible}`,
                    meeting: `${meetingCount} من ${totalPossible}`,
                    prep: `${prepCount} من ${totalPossible}`
                }
            };
        }
    }, [followUpActiveServants, selectedWeekKey, reportType, currentFridaysOfMonth]);

    const availableClasses = isGeneralAdmin
        ? (formData.assignedStage ? (STAGE_CLASS_MAP[formData.assignedStage] || []) : [])
        : (authorizedClasses || []);

    return (
        <div className="w-full max-w-7xl mx-auto p-4 md:p-8" dir="rtl">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-6">
                <div className="flex items-center gap-4">
                    <div className="bg-blue-600 p-3.5 rounded-2xl text-white shadow-xl shadow-blue-100 dark:shadow-none">
                        <Shield size={32} />
                    </div>
                    <div>
                        <h1 className="text-2xl md:text-3xl font-black text-slate-800 dark:text-slate-100">إدارة خدام مدارس الأحد</h1>
                        <p className="text-slate-500 dark:text-slate-400 text-sm md:text-base font-medium">معرفة بيانات الخدام وتوزيع المسؤوليّات و سجل متابعة الخادم الأسبوعية والشهرية</p>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                    <div className="relative flex-grow sm:w-72">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={18} />
                        <input
                            type="text"
                            placeholder="بحث بالاسم أو الكود..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pr-10 pl-4 py-3 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-850 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all shadow-sm text-sm text-slate-800 dark:text-slate-100"
                        />
                    </div>
                    {activeTab === 'followup' && followUpFilteredServants.length > 0 && (
                        <button
                            type="button"
                            onClick={handleExportFollowUpExcel}
                            className="flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg transition-all text-sm cursor-pointer border-none shrink-0"
                            title="تصدير كشف المتابعة لإكسيل"
                        >
                            <FileSpreadsheet size={18} />
                            <span>تصدير المتابعة لإكسيل</span>
                        </button>
                    )}
                    {activeTab === 'current' && (
                        <div className="flex gap-2.5">
                            {filteredServants.length > 0 && (
                                <button
                                    type="button"
                                    onClick={handleExportCurrentServantsExcel}
                                    className="flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg transition-all text-sm cursor-pointer border-none shrink-0"
                                    title="تصدير كشف الخدام الحاليين لإكسيل"
                                >
                                    <FileSpreadsheet size={18} />
                                    <span>تصدير لإكسيل</span>
                                </button>
                            )}
                            <button 
                                onClick={() => setShowAddForm(!showAddForm)}
                                className={`flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold transition-all shadow-lg text-sm md:text-base cursor-pointer border-none shrink-0 ${
                                    showAddForm 
                                    ? 'bg-red-50 text-red-600 border border-red-100 dark:bg-red-955/30 dark:text-red-400 dark:border-red-950/50' 
                                    : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95 shadow-blue-200 dark:shadow-none'
                                }`}
                            >
                                {showAddForm ? 'إلغاء الإضافة' : <><UserPlus size={20} /> إضافة خادم</>}
                            </button>
                        </div>
                    )}
                </div>
            </header>

            {/* Tabs Navigation */}
            <div className="flex border-b border-slate-200 dark:border-slate-800 mb-8 gap-6">
                <button
                    onClick={() => setActiveTab('current')}
                    className={`pb-4 text-base font-black transition-all border-b-2 px-2 cursor-pointer ${
                        activeTab === 'current'
                        ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                        : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600'
                    }`}
                >
                    الخدام الحاليين ({filteredServants.length})
                </button>
                <button
                    onClick={() => setActiveTab('requests')}
                    className={`pb-4 text-base font-black transition-all border-b-2 px-2 cursor-pointer relative flex items-center gap-2 ${
                        activeTab === 'requests'
                        ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                        : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600'
                    }`}
                >
                    طلبات التسجيل والتحكم
                    {pendingServants.length > 0 && (
                        <span className="bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded-full shrink-0">
                            {pendingServants.length}
                        </span>
                    )}
                </button>
                <button
                    onClick={() => setActiveTab('followup')}
                    className={`pb-4 text-base font-black transition-all border-b-2 px-2 cursor-pointer ${
                        activeTab === 'followup'
                        ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                        : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600'
                    }`}
                >
                    متابعة خدام مدارس الأحد
                </button>
            </div>

            {/* Stage and Class Filters */}
            {(activeTab === 'current' || activeTab === 'followup') && (
                <div className="flex flex-col md:flex-row gap-3 mb-8 items-center bg-white dark:bg-[#1e293b] p-4 rounded-xl border border-slate-200 dark:border-slate-800 transition-colors duration-300 w-full justify-between">
                    <div className="flex flex-col sm:flex-row gap-3 items-center w-full md:w-auto">
                        <span className="font-bold text-slate-600 dark:text-slate-400">تصفية حسب:</span>
                        <div className="flex gap-3 flex-wrap">
                            <select
                                value={selectedStage}
                                onChange={e => { setSelectedStage(e.target.value); setSelectedClass(''); }}
                                className="w-full sm:w-44 p-3 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={isStageServant}
                            >
                                <option value="">كل المراحل</option>
                                {Object.keys(STAGE_CLASS_MAP).map(stage => (
                                    <option key={stage} value={stage}>{stage}</option>
                                ))}
                            </select>

                            {isGeneralAdmin ? (
                                <select
                                    value={selectedClass}
                                    onChange={e => setSelectedClass(e.target.value)}
                                    className="w-full sm:w-48 p-3 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-300"
                                    disabled={!selectedStage}
                                >
                                    <option value="">{!selectedStage ? 'كل الفصول' : 'كل فصول المرحلة'}</option>
                                    {(STAGE_CLASS_MAP[selectedStage] || []).map(cls => (
                                        <option key={cls} value={cls}>{cls}</option>
                                    ))}
                                </select>
                            ) : (
                                <select
                                    value={selectedClass}
                                    onChange={e => setSelectedClass(e.target.value)}
                                    className="w-full sm:w-48 p-3 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-300"
                                >
                                    {authorizedClasses.length > 1 && <option value="">كل الفصول</option>}
                                    {(authorizedClasses || []).map(cls => (
                                        <option key={cls} value={cls}>{cls}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    </div>

                    {activeTab === 'followup' && (
                        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center mt-4 md:mt-0 w-full md:w-auto justify-end">
                            {/* Report Type Switcher */}
                            <div className="flex bg-slate-100 dark:bg-slate-900 p-1.5 rounded-xl border border-slate-200 dark:border-slate-800 w-full sm:w-auto">
                                <button
                                    type="button"
                                    onClick={() => setReportType('weekly')}
                                    className={`flex-1 sm:flex-none px-4 py-2 rounded-lg font-black text-sm transition-all cursor-pointer border-0 ${
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
                                    className={`flex-1 sm:flex-none px-4 py-2 rounded-lg font-black text-sm transition-all cursor-pointer border-0 ${
                                        reportType === 'monthly'
                                        ? 'bg-white dark:bg-[#1e293b] text-blue-600 dark:text-blue-400 shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                                    }`}
                                >
                                    تقرير شهري
                                </button>
                            </div>

                            {/* Conditional Selectors */}
                            {reportType === 'weekly' ? (
                                <div className="flex gap-2 items-center w-full sm:w-auto">
                                    <span className="font-bold text-slate-600 dark:text-slate-400 shrink-0 text-sm">الأسبوع:</span>
                                    <select
                                        value={selectedWeekKey}
                                        onChange={e => setSelectedWeekKey(e.target.value)}
                                        className="w-full sm:w-auto p-2.5 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-300 cursor-pointer text-sm"
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
                                        className="p-2.5 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-300 cursor-pointer text-sm"
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
                                        className="p-2.5 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-300 cursor-pointer text-sm"
                                    >
                                        {[2025, 2026, 2027].map(year => (
                                            <option key={year} value={year}>{year}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* فلترة الحضور والتحضير */}
                            <div className="flex gap-2 items-center w-full sm:w-auto">
                                <span className="font-bold text-slate-600 dark:text-slate-400 shrink-0 text-sm">حالة المتابعة:</span>
                                <select
                                    value={followUpFilter}
                                    onChange={e => setFollowUpFilter(e.target.value)}
                                    className="p-2.5 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-300 cursor-pointer text-sm"
                                >
                                    <option value="all">الكل</option>
                                    <option value="liturgy_attended">حضر القداس ⛪</option>
                                    <option value="liturgy_absent">لم يحضر القداس ❌</option>
                                    <option value="service_attended">حضر الخدمة ✅</option>
                                    <option value="service_absent">لم يحضر الخدمة ❌</option>
                                    <option value="meeting_attended">حضر اجتماع الخدام 👥</option>
                                    <option value="meeting_absent">لم يحضر الاجتماع ❌</option>
                                    <option value="prep_completed">حضر التحضير 📝</option>
                                    <option value="prep_absent">لم يحضر التحضير ❌</option>
                                </select>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'current' ? (
                <>
                    {showAddForm && (
                        <div className="bg-white dark:bg-[#1e293b] rounded-3xl shadow-2xl border border-slate-50 dark:border-slate-800 p-6 md:p-8 mb-10 transition-all animate-in fade-in slide-in-from-top-6 duration-500">
                            <div className="flex items-center gap-3 mb-8">
                                <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                                   <UserPlus size={24} />
                                </div>
                                <h3 className="text-xl font-black text-slate-800 dark:text-slate-100">بيانات الخادم الجديد</h3>
                            </div>
                            <form onSubmit={handleAddServant} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                <FormInput icon={<Users size={18} />} label="الاسم" placeholder="الاسم الثلاثي" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                                <FormInput icon={<Phone size={18} />} label="رقم التليفون" placeholder="01xxxxxxxxx" type="tel" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                                <FormInput icon={<MapPin size={18} />} label="العنوان" placeholder="عنوان السكن" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} />
                                <FormInput icon={<Calendar size={18} />} label="تاريخ الميلاد" type="date" className="text-right" value={formData.birthDate || ''} onChange={e => setFormData({...formData, birthDate: e.target.value})} required />
                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-slate-600 dark:text-slate-400 mr-1 italic">إيميل الخادم</label>
                                    <div className="relative flex rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 focus-within:ring-2 focus-within:ring-blue-500 focus-within:bg-white dark:focus-within:bg-slate-900 transition-all overflow-hidden items-center" dir="ltr">
                                        <div className="absolute left-3 text-slate-400 dark:text-slate-500 pointer-events-none">
                                            <Mail size={18} />
                                        </div>
                                        <input
                                            type="text"
                                            className="w-full pl-10 pr-3 py-3 bg-slate-100/50 dark:bg-slate-800/20 border-0 outline-none font-medium text-slate-700 dark:text-slate-200 text-left cursor-not-allowed opacity-75"
                                            placeholder="4005"
                                            value={formData.code}
                                            disabled
                                            required
                                        />
                                        <span className="px-3 py-3 bg-slate-200/50 dark:bg-slate-800/50 border-l border-slate-200 dark:border-slate-800 text-sm font-bold text-slate-500 dark:text-slate-400 select-none flex items-center justify-center shrink-0">
                                            @church.com
                                        </span>
                                    </div>
                                </div>
                                <FormInput icon={<Lock size={18} />} label="كلمة المرور" placeholder="كلمة مرور الدخول" type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} required />
                                
                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-slate-600 dark:text-slate-400 mr-1 italic">المسؤولية</label>
                                    <div className="relative">
                                        <Shield className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-400" size={18} />
                                        <select
                                            className="w-full pr-10 pl-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-slate-900 outline-none transition-all appearance-none cursor-pointer font-bold text-slate-700 dark:text-slate-200"
                                            value={formData.role}
                                            onChange={e => handleRoleChange(e.target.value)}
                                        >
                                            <option value="امين فصل">امين فصل</option>
                                            {isGeneralAdmin && <option value="امين مرحله">امين مرحله</option>}
                                        </select>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-slate-600 dark:text-slate-400 mr-1 italic">المرحلة الدراسية المسؤول عنها</label>
                                    <div className="relative">
                                        <Shield className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-400" size={18} />
                                        <select
                                            className="w-full pr-10 pl-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-slate-900 outline-none transition-all appearance-none cursor-pointer font-bold text-slate-700 dark:text-slate-200 disabled:opacity-75 disabled:cursor-not-allowed"
                                            value={formData.assignedStage}
                                            onChange={e => handleStageChange(e.target.value)}
                                            disabled={isStageServant}
                                        >
                                            <option value="">اختر المرحلة</option>
                                            {Object.keys(STAGE_CLASS_MAP).map(stage => (
                                                <option key={stage} value={stage}>{stage}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {formData.role === 'امين فصل' && (
                                    <div className="space-y-3 lg:col-span-3">
                                        <label className="text-sm font-bold text-slate-600 dark:text-slate-400 mr-1 italic">الفصول المسؤول عنها </label>
                                        {formData.assignedStage || !isGeneralAdmin ? (
                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                                {availableClasses.map(cls => {
                                                    const isChecked = (formData.myClasses || []).includes(cls);
                                                    return (
                                                        <label
                                                            key={cls}
                                                            className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-bold text-slate-700 dark:text-slate-200"
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
                                            <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-400 dark:text-slate-500 text-center">
                                                برجاء اختيار المرحلة أولاً لعرض الفصول
                                            </div>
                                        )}
                                    </div>
                                )}

                                {formData.role === 'امين مرحله' && (
                                    <div className="space-y-3 lg:col-span-3">
                                        <label className="text-sm font-bold text-slate-600 dark:text-slate-400 mr-1 italic">الفصول المسؤول عنها (managedClasses)</label>
                                        {formData.assignedStage || !isGeneralAdmin ? (
                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                                {availableClasses.map(cls => {
                                                    const isChecked = (formData.managedClasses || []).includes(cls);
                                                    return (
                                                        <label
                                                            key={cls}
                                                            className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-bold text-slate-700 dark:text-slate-200"
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
                                            <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-400 dark:text-slate-550 text-center">
                                                برجاء اختيار المرحلة أولاً لعرض الفصول
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="lg:col-span-3 pt-4">
                                    <button 
                                        type="submit" 
                                        className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black shadow-xl shadow-blue-200 dark:shadow-none hover:bg-blue-700 transform transition-all active:scale-[0.98] text-lg cursor-pointer"
                                    >
                                        حفظ بيانات الخادم
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}
                    
                    {/* Desktop View: Table */}
                    <div className="hidden md:block bg-white dark:bg-[#1e293b] rounded-3xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden mb-10">
                        <table className="w-full text-right border-collapse">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 uppercase text-xs font-black tracking-wider leading-normal">
                                    <th className="py-5 px-8 border-b border-slate-100 dark:border-slate-800">الاسم والكود</th>
                                    <th className="py-5 px-8 border-b border-slate-100 dark:border-slate-800">رقم التليفون</th>
                                    <th className="py-5 px-8 border-b border-slate-100 dark:border-slate-800">المسؤولية</th>
                                    <th className="py-5 px-8 border-b border-slate-100 dark:border-slate-800">الفصول المسؤول عنها</th>
                                    <th className="py-5 px-8 border-b border-slate-100 dark:border-slate-800 text-center">حذف</th>
                                </tr>
                            </thead>
                            <tbody className="text-slate-600 dark:text-slate-300 text-sm">
                                {filteredServants.map((servant) => {
                                    const nameStr = typeof servant.name === 'object' ? servant.name.name : servant.name;
                                    const initial = nameStr ? nameStr.charAt(0) : '?';
                                    return (
                                    <tr key={servant.id} className="border-b border-slate-50 dark:border-slate-800/80 hover:bg-blue-50/40 dark:hover:bg-blue-900/20 transition-colors">
                                        <td className="py-5 px-8">
                                            <div className="flex items-center gap-4">
                                                <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-black text-xl shadow-inner uppercase shrink-0">
                                                    {initial}
                                                </div>
                                                <div>
                                                    <Link to={`/admin/servant/${servant.id}`} className="font-black text-slate-800 dark:text-slate-200 text-base hover:text-blue-600 dark:hover:text-blue-400 transition-colors block leading-tight">
                                                        {nameStr} - {servant.code || servant.servantCode}
                                                    </Link>
                                                    {servant.isActive === false && <span className="text-xs bg-red-100 dark:bg-red-955/30 text-red-700 dark:text-red-400 px-2 rounded-full font-bold inline-block mt-1">معطل</span>}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-5 px-8 font-bold text-slate-700 dark:text-slate-300" dir="ltr">
                                            {servant.phone || '—'}
                                        </td>
                                        <td className="py-5 px-8">
                                            <div className="flex flex-col gap-1 items-start">
                                                <RoleBadge role={servant.role} />
                                                {(servant.assignedStage || servant.grade) && <span className="text-xs text-slate-400 dark:text-slate-500 font-bold">{servant.assignedStage || servant.grade}</span>}
                                            </div>
                                        </td>
                                        <td className="py-5 px-8 font-black text-blue-600 dark:text-blue-400">
                                            {servant.myClasses && servant.myClasses.length > 0
                                                ? servant.myClasses.join('، ')
                                                : (servant.assignedClass || servant.assignment || '—')}
                                        </td>
                                        <td className="py-5 px-8 text-center">
                                            <button
                                                onClick={() => handleDeleteServant(servant.id)}
                                                className="text-red-500 hover:text-red-700 hover:bg-red-500/10 p-2 rounded-lg transition-colors cursor-pointer"
                                                title="حذف الخادم"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                )})}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile View: Cards */}
                    <div className="md:hidden space-y-4 mb-8">
                        {filteredServants.map((servant) => {
                            const nameStr = typeof servant.name === 'object' ? servant.name.name : servant.name;
                            const initial = nameStr ? nameStr.charAt(0) : '?';
                            return (
                            <div key={servant.id} className="bg-white dark:bg-[#1e293b] p-5 rounded-2xl shadow-md border border-slate-100 dark:border-slate-800 space-y-4 group active:scale-[0.98] transition-transform">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="h-12 w-12 rounded-xl bg-blue-600 flex items-center justify-center text-white font-black text-xl shrink-0">
                                            {initial}
                                        </div>
                                        <div>
                                            <Link to={`/admin/servant/${servant.id}`} className="font-black text-slate-800 dark:text-slate-200 text-lg leading-tight block hover:text-blue-600 dark:hover:text-blue-400">
                                                {nameStr} - <span className="text-slate-500 dark:text-slate-400 text-sm">#{servant.code || servant.servantCode}</span>
                                            </Link>
                                            {servant.isActive === false && <span className="text-xs bg-red-100 dark:bg-red-955/30 text-red-700 dark:text-red-400 px-2 rounded-full font-bold mt-1 inline-block">معطل</span>}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <RoleBadge role={servant.role} />
                                        <button
                                            onClick={() => handleDeleteServant(servant.id)}
                                            className="text-red-500 hover:text-red-700 hover:bg-red-500/10 p-2 rounded-lg transition-colors cursor-pointer"
                                            title="حذف الخادم"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-50 dark:border-slate-800">
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">المسؤولية / المرحلة</p>
                                        <p className="text-sm font-black text-blue-600 dark:text-blue-400">
                                            {servant.myClasses && servant.myClasses.length > 0
                                                ? servant.myClasses.join('، ')
                                                : (servant.assignedClass || servant.assignment || '—')}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">رقم التليفون</p>
                                        <p className="text-sm font-bold text-slate-700 dark:text-slate-300" dir="ltr">
                                            {servant.phone || '—'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                            );
                        })}
                    </div>

                    {filteredServants.length === 0 && !servantsLoading && (
                        <div className="w-full py-20 text-center bg-white dark:bg-[#1e293b] rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-800">
                            <Users size={64} className="mx-auto text-slate-200 dark:text-slate-700 mb-4" />
                            <p className="text-xl font-bold text-slate-400 dark:text-slate-500">لا يوجد خدام حالياً</p>
                        </div>
                    )}
                </>
            ) : activeTab === 'followup' ? (
                <>
                    {/* Stats Indicators */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                        {/* Service Attendance Card */}
                        <div className="bg-gradient-to-br from-blue-500 to-indigo-650 text-white rounded-3xl p-6 shadow-xl relative overflow-hidden transition-all duration-300 hover:shadow-2xl">
                            <div className="absolute right-0 bottom-0 opacity-10 translate-x-4 translate-y-4">
                                <ClipboardList size={120} />
                            </div>
                            <p className="text-sm font-bold text-white mb-2">حضور الخدمة</p>
                            <h3 className="text-2xl font-black mb-4 flex items-baseline gap-2">
                                <span>{followUpStats.service}%</span>
                                {followUpStats.details?.service && (
                                    <span className="text-lg font-black text-white">({followUpStats.details.service})</span>
                                )}
                            </h3>
                            <div className="w-full bg-white/20 h-2 rounded-full overflow-hidden">
                                <div className="bg-white h-full rounded-full transition-all duration-500" style={{ width: `${followUpStats.service}%` }}></div>
                            </div>
                        </div>
                        {/* Liturgy Attendance Card */}
                        <div className="bg-gradient-to-br from-emerald-500 to-teal-650 text-white rounded-3xl p-6 shadow-xl relative overflow-hidden transition-all duration-300 hover:shadow-2xl">
                            <div className="absolute right-0 bottom-0 opacity-10 translate-x-4 translate-y-4">
                                <ClipboardList size={120} />
                            </div>
                            <p className="text-sm font-bold text-white mb-2">حضور القداس</p>
                            <h3 className="text-2xl font-black mb-4 flex items-baseline gap-2">
                                <span>{followUpStats.liturgy}%</span>
                                {followUpStats.details?.liturgy && (
                                    <span className="text-lg font-black text-white">({followUpStats.details.liturgy})</span>
                                )}
                            </h3>
                            <div className="w-full bg-white/20 h-2 rounded-full overflow-hidden">
                                <div className="bg-white h-full rounded-full transition-all duration-500" style={{ width: `${followUpStats.liturgy}%` }}></div>
                            </div>
                        </div>
                        {/* Meeting Attendance Card */}
                        <div className="bg-gradient-to-br from-purple-500 to-violet-650 text-white rounded-3xl p-6 shadow-xl relative overflow-hidden transition-all duration-300 hover:shadow-2xl">
                            <div className="absolute right-0 bottom-0 opacity-10 translate-x-4 translate-y-4">
                                <ClipboardList size={120} />
                            </div>
                            <p className="text-sm font-bold text-white mb-2">حضور اجتماع الخدام</p>
                            <h3 className="text-2xl font-black mb-4 flex items-baseline gap-2">
                                <span>{followUpStats.meeting}%</span>
                                {followUpStats.details?.meeting && (
                                    <span className="text-lg font-black text-white">({followUpStats.details.meeting})</span>
                                )}
                            </h3>
                            <div className="w-full bg-white/20 h-2 rounded-full overflow-hidden">
                                <div className="bg-white h-full rounded-full transition-all duration-500" style={{ width: `${followUpStats.meeting}%` }}></div>
                            </div>
                        </div>
                        {/* Preparation Card */}
                        <div className="bg-gradient-to-br from-amber-500 to-orange-655 text-white rounded-3xl p-6 shadow-xl relative overflow-hidden transition-all duration-300 hover:shadow-2xl">
                            <div className="absolute right-0 bottom-0 opacity-10 translate-x-4 translate-y-4">
                                <ClipboardList size={120} />
                            </div>
                            <p className="text-sm font-bold text-white mb-2">التحضير للدرس</p>
                            <h3 className="text-2xl font-black mb-4 flex items-baseline gap-2">
                                <span>{followUpStats.prep}%</span>
                                {followUpStats.details?.prep && (
                                    <span className="text-lg font-black text-white">({followUpStats.details.prep})</span>
                                )}
                            </h3>
                            <div className="w-full bg-white/20 h-2 rounded-full overflow-hidden">
                                <div className="bg-white h-full rounded-full transition-all duration-500" style={{ width: `${followUpStats.prep}%` }}></div>
                            </div>
                        </div>
                    </div>

                    {/* Desktop View: Table */}
                    <div className="hidden md:block bg-white dark:bg-[#1e293b] rounded-3xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden mb-10">
                        <table className="w-full text-right border-collapse">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-white uppercase text-xs font-black tracking-wider leading-normal">
                                    <th className="py-5 px-8 border-b border-slate-100 dark:border-slate-800">الاسم والكود</th>
                                    <th className="py-5 px-8 border-b border-slate-100 dark:border-slate-800">الفصل المسئول عنه</th>
                                    <th className="py-5 px-6 border-b border-slate-100 dark:border-slate-800 text-center">حضور الخدمة</th>
                                    <th className="py-5 px-6 border-b border-slate-100 dark:border-slate-800 text-center">حضور القداس</th>
                                    <th className="py-5 px-6 border-b border-slate-100 dark:border-slate-800 text-center">حضور الاجتماع</th>
                                    <th className="py-5 px-6 border-b border-slate-100 dark:border-slate-800 text-center">التحضير للدرس</th>
                                </tr>
                            </thead>
                            <tbody className="text-slate-600 dark:text-slate-300 text-sm">
                                {followUpFilteredServants.map((s) => {
                                    const nameStr = typeof s.name === 'object' ? s.name.name : s.name;
                                    const initial = nameStr ? nameStr.charAt(0) : '?';
                                    
                                    if (reportType === 'weekly') {
                                        const fData = s.weeklyFollowUp?.[selectedWeekKey] || {};
                                        return (
                                            <tr key={s.id} className="border-b border-slate-50 dark:border-slate-800/80 hover:bg-blue-50/40 dark:hover:bg-blue-900/20 transition-colors">
                                                <td className="py-5 px-8">
                                                    <div className="flex items-center gap-4">
                                                        <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-black text-xl shadow-inner uppercase shrink-0">
                                                            {initial}
                                                        </div>
                                                        <div>
                                                            <Link to={`/admin/servant/${s.id}`} className="font-black text-slate-800 dark:text-slate-200 text-base hover:text-blue-600 dark:hover:text-blue-400 transition-colors block leading-tight">
                                                                {nameStr} - {s.code || s.servantCode}
                                                            </Link>
                                                            {(s.assignedStage || s.grade) && <span className="text-xs text-slate-400 dark:text-slate-500 font-bold block mt-1">{s.assignedStage || s.grade}</span>}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="py-5 px-8 font-black text-blue-600 dark:text-blue-400">
                                                    {s.myClasses && s.myClasses.length > 0
                                                        ? s.myClasses.join('، ')
                                                        : (s.assignedClass || s.assignment || '—')}
                                                </td>
                                                <td className="py-5 px-6 text-center">
                                                    <button
                                                        onClick={() => handleToggleWeeklyFollowUp(s.id, selectedWeekKey, 'attendanceService', !!fData.attendanceService)}
                                                        className={`inline-flex items-center justify-center w-8 h-8 rounded-full transition-all cursor-pointer border-0 ${
                                                            fData.attendanceService 
                                                            ? 'bg-emerald-100 hover:bg-emerald-250 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400' 
                                                            : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-400 dark:text-slate-600'
                                                        }`}
                                                        title="تعديل حضور الخدمة"
                                                    >
                                                        {fData.attendanceService ? <Check size={18} strokeWidth={3} /> : <span className="text-lg leading-none font-bold">—</span>}
                                                    </button>
                                                </td>
                                                <td className="py-5 px-6 text-center">
                                                    <button
                                                        onClick={() => handleToggleWeeklyFollowUp(s.id, selectedWeekKey, 'attendanceLiturgy', !!fData.attendanceLiturgy)}
                                                        className={`inline-flex items-center justify-center w-8 h-8 rounded-full transition-all cursor-pointer border-0 ${
                                                            fData.attendanceLiturgy 
                                                            ? 'bg-emerald-100 hover:bg-emerald-250 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400' 
                                                            : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-400 dark:text-slate-600'
                                                        }`}
                                                        title="تعديل حضور القداس"
                                                    >
                                                        {fData.attendanceLiturgy ? <Check size={18} strokeWidth={3} /> : <span className="text-lg leading-none font-bold">—</span>}
                                                    </button>
                                                </td>
                                                <td className="py-5 px-6 text-center">
                                                    <button
                                                        onClick={() => handleToggleWeeklyFollowUp(s.id, selectedWeekKey, 'attendanceMeeting', !!fData.attendanceMeeting)}
                                                        className={`inline-flex items-center justify-center w-8 h-8 rounded-full transition-all cursor-pointer border-0 ${
                                                            fData.attendanceMeeting 
                                                            ? 'bg-emerald-100 hover:bg-emerald-250 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400' 
                                                            : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-400 dark:text-slate-600'
                                                        }`}
                                                        title="تعديل حضور اجتماع الخدام"
                                                    >
                                                        {fData.attendanceMeeting ? <Check size={18} strokeWidth={3} /> : <span className="text-lg leading-none font-bold">—</span>}
                                                    </button>
                                                </td>
                                                <td className="py-5 px-6 text-center">
                                                    <button
                                                        onClick={() => handleToggleWeeklyFollowUp(s.id, selectedWeekKey, 'preparation', !!fData.preparation)}
                                                        className={`inline-flex items-center justify-center w-8 h-8 rounded-full transition-all cursor-pointer border-0 ${
                                                            fData.preparation 
                                                            ? 'bg-emerald-100 hover:bg-emerald-250 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60 text-emerald-650 dark:text-emerald-400' 
                                                            : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-400 dark:text-slate-600'
                                                        }`}
                                                        title="تعديل تحضير الدرس"
                                                    >
                                                        {fData.preparation ? <Check size={18} strokeWidth={3} /> : <span className="text-lg leading-none font-bold">—</span>}
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    } else {
                                        const servantActiveFridays = currentFridaysOfMonth.filter(fKey => isServantActiveInWeek(s, fKey));
                                        const fCount = servantActiveFridays.length;
                                        let attService = 0;
                                        let attLiturgy = 0;
                                        let attMeeting = 0;
                                        let prepLesson = 0;

                                        servantActiveFridays.forEach(fKey => {
                                            const fData = s.weeklyFollowUp?.[fKey] || {};
                                            if (fData.attendanceService) attService++;
                                            if (fData.attendanceLiturgy) attLiturgy++;
                                            if (fData.attendanceMeeting) attMeeting++;
                                            if (fData.preparation) prepLesson++;
                                        });

                                        return (
                                            <tr key={s.id} className="border-b border-slate-50 dark:border-slate-800/80 hover:bg-blue-50/40 dark:hover:bg-blue-900/20 transition-colors">
                                                <td className="py-5 px-8">
                                                    <div className="flex items-center gap-4">
                                                        <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-black text-xl shadow-inner uppercase shrink-0">
                                                            {initial}
                                                        </div>
                                                        <div>
                                                            <Link to={`/admin/servant/${s.id}`} className="font-black text-slate-800 dark:text-slate-200 text-base hover:text-blue-600 dark:hover:text-blue-400 transition-colors block leading-tight">
                                                                {nameStr} - {s.code || s.servantCode}
                                                            </Link>
                                                            {(s.assignedStage || s.grade) && <span className="text-xs text-slate-400 dark:text-slate-500 font-bold block mt-1">{s.assignedStage || s.grade}</span>}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="py-5 px-8 font-black text-blue-600 dark:text-blue-400">
                                                    {s.myClasses && s.myClasses.length > 0
                                                        ? s.myClasses.join('، ')
                                                        : (s.assignedClass || s.assignment || '—')}
                                                </td>
                                                <td className="py-5 px-6 text-center font-bold">
                                                    <span className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-sm font-black ${
                                                        attService === fCount
                                                        ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
                                                        : attService >= fCount / 2
                                                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                                                        : 'bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-450'
                                                    }`}>
                                                        {attService} / {fCount}
                                                    </span>
                                                </td>
                                                <td className="py-5 px-6 text-center font-bold">
                                                    <span className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-sm font-black ${
                                                        attLiturgy === fCount
                                                        ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
                                                        : attLiturgy >= fCount / 2
                                                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                                                        : 'bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-450'
                                                    }`}>
                                                        {attLiturgy} / {fCount}
                                                    </span>
                                                </td>
                                                <td className="py-5 px-6 text-center font-bold">
                                                    <span className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-sm font-black ${
                                                        attMeeting === fCount
                                                        ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
                                                        : attMeeting >= fCount / 2
                                                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                                                        : 'bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-450'
                                                    }`}>
                                                        {attMeeting} / {fCount}
                                                    </span>
                                                </td>
                                                <td className="py-5 px-6 text-center font-bold">
                                                    <span className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-sm font-black ${
                                                        prepLesson === fCount
                                                        ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
                                                        : prepLesson >= fCount / 2
                                                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                                                        : 'bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-450'
                                                    }`}>
                                                        {prepLesson} / {fCount}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    }
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile View: Cards */}
                    <div className="md:hidden space-y-4 mb-8">
                        {followUpFilteredServants.map((s) => {
                            const nameStr = typeof s.name === 'object' ? s.name.name : s.name;
                            const initial = nameStr ? nameStr.charAt(0) : '?';
                            
                            if (reportType === 'weekly') {
                                const fData = s.weeklyFollowUp?.[selectedWeekKey] || {};
                                return (
                                    <div key={s.id} className="bg-white dark:bg-[#1e293b] p-5 rounded-2xl shadow-md border border-slate-100 dark:border-slate-800 space-y-4 group">
                                        <div className="flex items-center gap-3">
                                            <div className="h-12 w-12 rounded-xl bg-blue-600 flex items-center justify-center text-white font-black text-xl shrink-0">
                                                {initial}
                                            </div>
                                            <div>
                                                <Link to={`/admin/servant/${s.id}`} className="font-black text-slate-800 dark:text-slate-200 text-lg leading-tight block hover:text-blue-600 dark:hover:text-blue-400">
                                                    {nameStr} - <span className="text-slate-500 dark:text-slate-400 text-sm">#{s.code || s.servantCode}</span>
                                                </Link>
                                                {(s.assignedStage || s.grade) && <span className="text-xs text-slate-400 dark:text-slate-500 font-bold block mt-1">{s.assignedStage || s.grade}</span>}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-sm">
                                            <div>
                                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1.5">حضور الخدمة</p>
                                                <button
                                                    onClick={() => handleToggleWeeklyFollowUp(s.id, selectedWeekKey, 'attendanceService', !!fData.attendanceService)}
                                                    className={`flex items-center gap-2 px-3 py-2 rounded-xl font-bold text-sm transition-all cursor-pointer border w-full ${
                                                        fData.attendanceService
                                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700/40 dark:text-emerald-300'
                                                        : 'bg-slate-50 border-slate-200 text-slate-400 dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-500'
                                                    }`}
                                                >
                                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                                                        fData.attendanceService
                                                        ? 'bg-emerald-500 text-white'
                                                        : 'bg-slate-200 dark:bg-slate-700'
                                                    }`}>
                                                        {fData.attendanceService && <Check size={11} strokeWidth={3.5} />}
                                                    </span>
                                                    <span>{fData.attendanceService ? 'حضر' : 'غائب'}</span>
                                                </button>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1.5">حضور القداس</p>
                                                <button
                                                    onClick={() => handleToggleWeeklyFollowUp(s.id, selectedWeekKey, 'attendanceLiturgy', !!fData.attendanceLiturgy)}
                                                    className={`flex items-center gap-2 px-3 py-2 rounded-xl font-bold text-sm transition-all cursor-pointer border w-full ${
                                                        fData.attendanceLiturgy
                                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700/40 dark:text-emerald-300'
                                                        : 'bg-slate-50 border-slate-200 text-slate-400 dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-500'
                                                    }`}
                                                >
                                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                                                        fData.attendanceLiturgy
                                                        ? 'bg-emerald-500 text-white'
                                                        : 'bg-slate-200 dark:bg-slate-700'
                                                    }`}>
                                                        {fData.attendanceLiturgy && <Check size={11} strokeWidth={3.5} />}
                                                    </span>
                                                    <span>{fData.attendanceLiturgy ? 'حضر' : 'غائب'}</span>
                                                </button>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1.5">حضور اجتماع الخدام</p>
                                                <button
                                                    onClick={() => handleToggleWeeklyFollowUp(s.id, selectedWeekKey, 'attendanceMeeting', !!fData.attendanceMeeting)}
                                                    className={`flex items-center gap-2 px-3 py-2 rounded-xl font-bold text-sm transition-all cursor-pointer border w-full ${
                                                        fData.attendanceMeeting
                                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700/40 dark:text-emerald-300'
                                                        : 'bg-slate-50 border-slate-200 text-slate-400 dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-500'
                                                    }`}
                                                >
                                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                                                        fData.attendanceMeeting
                                                        ? 'bg-emerald-500 text-white'
                                                        : 'bg-slate-200 dark:bg-slate-700'
                                                    }`}>
                                                        {fData.attendanceMeeting && <Check size={11} strokeWidth={3.5} />}
                                                    </span>
                                                    <span>{fData.attendanceMeeting ? 'حضر' : 'غائب'}</span>
                                                </button>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1.5">التحضير</p>
                                                <button
                                                    onClick={() => handleToggleWeeklyFollowUp(s.id, selectedWeekKey, 'preparation', !!fData.preparation)}
                                                    className={`flex items-center gap-2 px-3 py-2 rounded-xl font-bold text-sm transition-all cursor-pointer border w-full ${
                                                        fData.preparation
                                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700/40 dark:text-emerald-300'
                                                        : 'bg-slate-50 border-slate-200 text-slate-400 dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-500'
                                                    }`}
                                                >
                                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                                                        fData.preparation
                                                        ? 'bg-emerald-500 text-white'
                                                        : 'bg-slate-200 dark:bg-slate-700'
                                                    }`}>
                                                        {fData.preparation && <Check size={11} strokeWidth={3.5} />}
                                                    </span>
                                                    <span>{fData.preparation ? 'حضر' : 'غائب'}</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            } else {
                                const servantActiveFridays = currentFridaysOfMonth.filter(fKey => isServantActiveInWeek(s, fKey));
                                const fCount = servantActiveFridays.length;
                                let attService = 0;
                                let attLiturgy = 0;
                                let attMeeting = 0;
                                let prepLesson = 0;

                                servantActiveFridays.forEach(fKey => {
                                    const fData = s.weeklyFollowUp?.[fKey] || {};
                                    if (fData.attendanceService) attService++;
                                    if (fData.attendanceLiturgy) attLiturgy++;
                                    if (fData.attendanceMeeting) attMeeting++;
                                    if (fData.preparation) prepLesson++;
                                });

                                return (
                                    <div key={s.id} className="bg-white dark:bg-[#1e293b] p-5 rounded-2xl shadow-md border border-slate-100 dark:border-slate-800 space-y-4 group">
                                        <div className="flex items-center gap-3">
                                            <div className="h-12 w-12 rounded-xl bg-blue-600 flex items-center justify-center text-white font-black text-xl shrink-0">
                                                {initial}
                                            </div>
                                            <div>
                                                <Link to={`/admin/servant/${s.id}`} className="font-black text-slate-800 dark:text-slate-200 text-lg leading-tight block hover:text-blue-600 dark:hover:text-blue-400">
                                                    {nameStr} - <span className="text-slate-500 dark:text-slate-400 text-sm">#{s.code || s.servantCode}</span>
                                                </Link>
                                                {(s.assignedStage || s.grade) && <span className="text-xs text-slate-400 dark:text-slate-500 font-bold block mt-1">{s.assignedStage || s.grade}</span>}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-50 dark:border-slate-800 text-sm">
                                            <div>
                                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">حضور الخدمة</p>
                                                <p className="text-sm font-black text-slate-700 dark:text-slate-200">
                                                    {attService} من {fCount} أسابيع
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">حضور القداس</p>
                                                <p className="text-sm font-black text-slate-700 dark:text-slate-200">
                                                    {attLiturgy} من {fCount} أسابيع
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">حضور اجتماع الخدام</p>
                                                <p className="text-sm font-black text-slate-700 dark:text-slate-200">
                                                    {attMeeting} من {fCount} أسابيع
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1">التحضير</p>
                                                <p className="text-sm font-black text-slate-700 dark:text-slate-200">
                                                    {prepLesson} من {fCount} أسابيع
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            }
                        })}
                    </div>

                    {followUpFilteredServants.length === 0 && !servantsLoading && (
                        <div className="w-full py-20 text-center bg-white dark:bg-[#1e293b] rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-800">
                            <Users size={64} className="mx-auto text-slate-200 dark:text-slate-700 mb-4" />
                            <p className="text-xl font-bold text-slate-400 dark:text-slate-500">لا يوجد خدام حالياً</p>
                        </div>
                    )}
                </>
            ) : (
                <>
                    {/* Registration Toggle Switch */}
                    <div className="bg-white dark:bg-[#1e293b] p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 transition-colors duration-300">
                        <div className="space-y-1">
                            <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                {isRegOpen ? '🔓 التسجيل مفتوح حالياً' : '🔒 التسجيل مغلق حالياً'}
                            </h3>
                            <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">
                                عند إغلاق التسجيل، لن يتمكن الخدام الجدد من إنشاء حسابات عبر الرابط الخارجي.
                            </p>
                        </div>
                        <button
                            onClick={handleToggleRegistration}
                            className={`px-6 py-3 rounded-xl font-bold text-sm md:text-base transition-all shadow-md cursor-pointer flex items-center gap-2 ${
                                isRegOpen
                                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200 dark:shadow-none'
                            }`}
                        >
                            {isRegOpen ? 'إغلاق التسجيل 🔒' : 'فتح التسجيل 🔓'}
                        </button>
                    </div>

                    {/* Pending Requests List */}
                    <div>
                        <h3 className="text-xl font-black text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2">
                            <span>طلبات التسجيل المعلقة</span>
                            <span className="text-sm bg-slate-100 dark:bg-slate-850 text-slate-500 dark:text-slate-400 px-2.5 py-1 rounded-lg font-bold">
                                {pendingServants.length} طلب
                            </span>
                        </h3>

                        {pendingLoading ? (
                            <div className="flex flex-col items-center justify-center py-12 gap-4">
                                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-600"></div>
                                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">جاري تحميل الطلبات...</p>
                            </div>
                        ) : pendingServants.length === 0 ? (
                            <div className="w-full py-16 text-center bg-white dark:bg-[#1e293b] rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-800">
                                <span className="text-4xl block mb-3">🎉</span>
                                <p className="text-lg font-bold text-slate-400 dark:text-slate-500">لا توجد طلبات تسجيل معلقة حالياً</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {pendingServants.map((req) => (
                                    <div key={req.id} className="bg-white dark:bg-[#1e293b] p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-md flex flex-col justify-between gap-6 transition-all hover:shadow-lg">
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-12 w-12 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xl font-black uppercase shrink-0">
                                                        {req.name ? req.name.charAt(0) : '?'}
                                                    </div>
                                                    <div>
                                                        <h4 className="font-black text-slate-800 dark:text-slate-100 text-lg leading-tight">{req.name}</h4>
                                                        <span className="text-xs text-slate-400 dark:text-slate-500 font-bold">تاريخ الطلب: {req.createdAt ? new Date(req.createdAt).toLocaleDateString('ar-EG') : '—'}</span>
                                                    </div>
                                                </div>
                                                <RoleBadge role={req.role} />
                                            </div>

                                            <div className="grid grid-cols-2 gap-4 text-sm bg-slate-50 dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-850">
                                                <div>
                                                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1">المرحلة المطلوبة</p>
                                                    <p className="font-black text-slate-700 dark:text-slate-200">{req.assignedStage || '—'}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1">رقم التليفون</p>
                                                    <p className="font-bold text-slate-700 dark:text-slate-200" dir="ltr">{req.phone || '—'}</p>
                                                </div>
                                                <div className="col-span-2">
                                                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1">الفصول المطلوبة</p>
                                                    <p className="font-black text-blue-600 dark:text-blue-400">
                                                        {req.role === 'امين مرحله'
                                                            ? (req.managedClasses && req.managedClasses.length > 0 ? req.managedClasses.join('، ') : '—')
                                                            : (req.myClasses && req.myClasses.length > 0 ? req.myClasses.join('، ') : '—')
                                                        }
                                                    </p>
                                                </div>
                                                <div className="col-span-2">
                                                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mb-1">الكود المقترح / الإيميل</p>
                                                    <p className="font-bold text-slate-600 dark:text-slate-350">{req.code} / {req.email}</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex gap-3">
                                            <button
                                                onClick={() => handleApprove(req.id)}
                                                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-all shadow-md active:scale-95 cursor-pointer text-center text-sm md:text-base font-bold"
                                            >
                                                قبول ✅
                                            </button>
                                            <button
                                                onClick={() => handleReject(req.id)}
                                                className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl transition-all shadow-md active:scale-95 cursor-pointer text-center text-sm md:text-base font-bold"
                                            >
                                                رفض ❌
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

// Helper Components
const FormInput = ({ icon, label, className = '', ...props }) => (
    <div className="space-y-2">
        <label className="text-sm font-bold text-slate-600 dark:text-slate-400 mr-1 italic">{label}</label>
        <div className="relative">
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-400">
                {icon}
            </div>
            <input
                {...props}
                className={`w-full pr-10 pl-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-slate-900 outline-none transition-all font-medium text-slate-800 dark:text-slate-200 ${className}`}
            />
        </div>
    </div>
);

const RoleBadge = ({ role }) => {
    const norm = role ? role.replace(/[أإآا]/g, 'ا').replace(/[ىي]/g, 'ي').replace(/[ةه]/g, 'ه').trim() : '';
    const colors = {
        'امين مرحله': 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-900/50',
        'امين فصل': 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-955/30 dark:text-orange-400 dark:border-orange-900/50',
        'default': 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-900/50'
    };
    const style = colors[norm] || colors.default;
    return (
        <span className={`py-1 px-3 rounded-lg text-xs font-black border ${style} shadow-sm inline-block`}>
            {role}
        </span>
    );
};
