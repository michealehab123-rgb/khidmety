import { useState, useEffect, useMemo, useRef } from 'react';
import NotificationSettings from '../components/NotificationSettings';
import { exportStudentsToExcel, downloadExcelTemplate } from '../utils/excelExport';
import * as XLSX from 'xlsx';



import { collection, addDoc, updateDoc, doc, deleteDoc, onSnapshot, increment, arrayUnion, arrayRemove, query, where, getDocs, serverTimestamp, db, setDoc, runTransaction, getDoc, writeBatch } from '../firebase';



import { 



    Plus, 
    Settings,



    Check, 



    Search, 



    UserPlus, 



    Wifi, 



    WifiOff, 



    Trash2, 



    X, 



    CalendarDays, 



    Key, 



    LogOut,



    LayoutDashboard,



    Printer,



    Users,



    UserCheck,



    Calendar,



    Heart,



    Flame,



    BarChart2,



    ArrowLeftRight,



    ShoppingBag,



    Gift,



    AlertCircle,



    AlertTriangle,



    CheckCircle,



    Camera,



    User,



    Award,



    Church,



    Bell,
    FileSpreadsheet



} from 'lucide-react';



import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';



import { useAuth } from '../context/AuthContext';



import { QRCodeSVG } from 'qrcode.react';



import { isStoreVisibleForStudent } from '../utils/storeConfig';







const normalizeArabic = (str) => {



    if (!str) return '';



    return str



        .replace(/[أإآا]/g, 'ا')



        .replace(/[ىي]/g, 'ي')



        .replace(/[ةه]/g, 'ه')



        .trim();



};



const sanitizeBirthDate = (rawDate, stage) => {
    if (!rawDate) return '';
    const str = String(rawDate).trim();
    if (!str) return '';
    
    const convertArabicNumerals = (s) => {
        return s.replace(/[٠١٢٣٤٥٦٧٨٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    };
    
    const cleanArabicText = (text) => {
        return text
            .replace(/[أإآا]/g, 'ا')
            .replace(/[ىي]/g, 'ي')
            .replace(/[ةه]/g, 'ه')
            .trim();
    };

    const getApproximateYearForStage = (stg) => {
        const currentYear = new Date().getFullYear();
        const normStage = cleanArabicText(stg || '');
        if (normStage.includes('حضانه') || normStage.includes('ملائكه')) {
            return currentYear - 4;
        }
        if (normStage.includes('ابتدائي') || normStage.includes('ابتدائى')) {
            return currentYear - 9;
        }
        if (normStage.includes('اعدادي') || normStage.includes('اعدادى')) {
            return currentYear - 13;
        }
        if (normStage.includes('ثانوي') || normStage.includes('ثانوى')) {
            return currentYear - 16;
        }
        return currentYear - 10;
    };

    let cleanedStr = convertArabicNumerals(str);
    let normalized = cleanedStr.replace(/[\/\\]/g, '-');
    
    // Try parsing excel serial number
    if (/^\d{5}$/.test(normalized)) {
        const excelDate = Number(normalized);
        const dateObj = new Date((excelDate - 25569) * 86400 * 1000);
        if (!isNaN(dateObj.getTime())) {
            return dateObj.toISOString().split('T')[0];
        }
    }

    // Try YYYY-MM-DD
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)) {
        const parts = normalized.split('-');
        const y = parts[0];
        const m = parts[1].padStart(2, '0');
        const d = parts[2].padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    // Try DD-MM-YYYY
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(normalized)) {
        const parts = normalized.split('-');
        const d = parts[0].padStart(2, '0');
        const m = parts[1].padStart(2, '0');
        const y = parts[2];
        return `${y}-${m}-${d}`;
    }

    // Smart Arabic Month Parsing
    const rawMonthsMap = {
        'يناير': '01', 'كانون الثاني': '01',
        'فبراير': '02', 'شباط': '02',
        'مارس': '03', 'آذار': '03',
        'ابريل': '04', 'أبريل': '04', 'نيسان': '04',
        'مايو': '05', 'أيار': '05',
        'يونيو': '06', 'حزيران': '06',
        'يوليو': '07', 'تموز': '07',
        'اغسطس': '08', 'أغسطس': '08', 'آب': '08',
        'سبتمبر': '09', 'أيلول': '09',
        'اكتوبر': '10', 'أكتوبر': '10', 'تشرين الأول': '10', 'تشرين الاول': '10',
        'نوفمبر': '11', 'تشرين الثاني': '11',
        'ديسمبر': '12', 'كانون الأول': '12', 'كانون الاول': '12'
    };

    const normalizedMonthsMap = {};
    Object.keys(rawMonthsMap).forEach(key => {
        normalizedMonthsMap[cleanArabicText(key)] = rawMonthsMap[key];
    });

    const normInput = cleanArabicText(cleanedStr.toLowerCase());
    const monthKeys = Object.keys(normalizedMonthsMap).sort((a, b) => b.length - a.length);
    let matchedMonthNum = null;
    let matchedMonthKey = null;

    for (const key of monthKeys) {
        if (normInput.includes(key)) {
            matchedMonthNum = normalizedMonthsMap[key];
            matchedMonthKey = key;
            break;
        }
    }

    if (matchedMonthNum) {
        const numbersStr = normInput.replace(matchedMonthKey, ' ');
        const digits = numbersStr.match(/\d+/g) || [];
        
        let day = '01';
        let year = null;
        
        if (digits.length >= 2) {
            const first = parseInt(digits[0], 10);
            const second = parseInt(digits[1], 10);
            if (digits[0].length === 4) {
                year = digits[0];
                day = String(second).padStart(2, '0');
            } else if (digits[1].length === 4) {
                year = digits[1];
                day = String(first).padStart(2, '0');
            } else {
                if (first > 31) {
                    year = String(first + (first < 50 ? 2000 : 1900));
                    day = String(second).padStart(2, '0');
                } else if (second > 31) {
                    year = String(second + (second < 50 ? 2000 : 1900));
                    day = String(first).padStart(2, '0');
                } else {
                    year = String(second + 2000);
                    day = String(first).padStart(2, '0');
                }
            }
        } else if (digits.length === 1) {
            const val = parseInt(digits[0], 10);
            if (digits[0].length === 4) {
                year = digits[0];
                day = '01';
            } else if (val > 31) {
                year = String(val + (val < 50 ? 2000 : 1900));
                day = '01';
            } else {
                day = String(val).padStart(2, '0');
                year = String(getApproximateYearForStage(stage));
            }
        } else {
            day = '01';
            year = String(getApproximateYearForStage(stage));
        }
        
        return `${year}-${matchedMonthNum}-${day}`;
    }

    const parsed = new Date(normalized);
    if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
    }

    return str;
};

const autoDetectMappings = (headers) => {
    const mappings = {
        name: '',
        birthDate: '',
        fatherOfConfession: '',
        phone: '',
        addressColumns: [''],
        fatherPhone: '',
        motherPhone: ''
    };

    headers.forEach(h => {
        const cleanH = normalizeArabic(String(h || ''));
        if (cleanH.includes('الاسم') || cleanH.includes('اسم')) {
            mappings.name = h;
        } else if (cleanH.includes('تاريخ الميلاد') || cleanH.includes('ميلاد')) {
            mappings.birthDate = h;
        } else if ((cleanH.includes('رقم') || cleanH.includes('تليفون') || cleanH.includes('موبايل') || cleanH.includes('هاتف')) && (cleanH.includes('اب') || cleanH.includes('والد') || cleanH.includes('father'))) {
            mappings.fatherPhone = h;
        } else if ((cleanH.includes('رقم') || cleanH.includes('تليفون') || cleanH.includes('موبايل') || cleanH.includes('هاتف')) && (cleanH.includes('ام') || cleanH.includes('والدة') || cleanH.includes('mother'))) {
            mappings.motherPhone = h;
        } else if (cleanH.includes('الهاتف') || cleanH.includes('تليفون') || cleanH.includes('موبايل') || cleanH.includes('رقم')) {
            mappings.phone = h;
        } else if (cleanH.includes('اعتراف') || cleanH.includes('ابونا') || cleanH.includes('اب الاعتراف')) {
            mappings.fatherOfConfession = h;
        }
    });

    const addrCol = headers.find(h => normalizeArabic(String(h || '')).includes('العنوان'));
    if (addrCol) {
        mappings.addressColumns = [addrCol];
    }

    return mappings;
};







const calculateStreak = (dates) => {



    if (!dates || dates.length === 0) return 0;



    const sortedDates = [...dates].map(d => {
        const dt = new Date(d);
        dt.setHours(0, 0, 0, 0);
        return dt;
    }).sort((a, b) => b - a);



    let streak = 0;



    let current = sortedDates[0];



    const today = new Date();



    today.setHours(0, 0, 0, 0);



    const diffDays = Math.round((today - current) / (1000 * 60 * 60 * 24));



    if (diffDays > 8) {



        return 0;



    }



    streak = 1;



    for (let i = 1; i < sortedDates.length; i++) {



        const prev = sortedDates[i];



        const diff = Math.round((current - prev) / (1000 * 60 * 60 * 24));



        if (diff >= 6 && diff <= 8) {



            streak++;



            current = prev;



        } else if (diff < 6) {



            continue;



        } else {



            break;



        }



    }



    return streak;



};







const getBaseCodeForStage = (stage, existingStages = []) => {



    const stageNorm = stage ? normalizeArabic(stage) : '';



    if (stageNorm.includes('ابتدائي')) return 1001;



    if (stageNorm.includes('اعدادي')) return 2001;



    if (stageNorm.includes('ثانوي')) return 3001;



    



    const standardNorms = ['ابتدائي', 'اعدادي', 'ثانوي'].map(normalizeArabic);



    



    const uniqueCustomStages = [];



    existingStages.forEach(s => {



        const sNorm = normalizeArabic(s);



        if (sNorm && !standardNorms.includes(sNorm) && !uniqueCustomStages.includes(sNorm)) {



            uniqueCustomStages.push(sNorm);



        }



    });



    



    let idx = uniqueCustomStages.indexOf(stageNorm);



    if (idx === -1) {



        idx = uniqueCustomStages.length;



    }



    return 4001 + (idx * 1000);



};







const getSafeClassId = (className) => {



    if (!className) return '';



    return className.replace(/\//g, '-');



};







function StudentRow({ student, addPoints, markAttendance, markLiturgy, deleteStudent, openAttendanceModal, resetPassword, shortcuts, addShortcut, removeShortcut, consecutiveGiftEnabled, claimGift, isBonus = false, storeVisible = true }) {
    const [amount, setAmount] = useState(0);
    const [showAddShortcut, setShowAddShortcut] = useState(false);
    const [newShortcut, setNewShortcut] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSubmittingLiturgy, setIsSubmittingLiturgy] = useState(false);
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const [isMutatingBonus, setIsMutatingBonus] = useState(false);
    const [attendancePointsInput, setAttendancePointsInput] = useState('');

    const isPointsValid = storeVisible === false
        ? /^\d*$/.test(attendancePointsInput)
        : /^\d+$/.test(attendancePointsInput);

    const handleAdd = () => {
        if (amount > 0) {
            addPoints(student.id, amount);
            setAmount(0);
        }
    };

    const handleSubtract = () => {
        if (amount > 0) {
            addPoints(student.id, -amount);
            setAmount(0);
        }
    };

    const addNewShortcut = () => {
        const val = parseInt(newShortcut);
        if (val > 0 && !shortcuts.includes(val)) {
            addShortcut(val);
            setNewShortcut('');
            setShowAddShortcut(false);
        }
    };

    const handleMark = async () => {
        if (isSubmitting) return;
        if (!isPointsValid) return;
        setIsSubmitting(true);
        try {
            await markAttendance(student.id, Number(attendancePointsInput));
        } catch (error) {
            console.error("Error marking attendance:", error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const isFriday = new Date().getDay() === 5;
    const isAttendedToday = student.attendance?.some(dateStr => {
        const d = new Date(dateStr);
        const today = new Date();
        return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    });

    return (
        <div className={`bg-white dark:bg-[#1e293b] p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 mb-4 transition-colors duration-300 ${isAttendedToday && !isBonus ? 'attended-today dark:bg-[#1e293b]/70' : ''}`}>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        <Link to={`/admin/student/${student.id}`} className="text-xl font-bold text-slate-800 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                            {student.name}
                        </Link>
                        <span className="text-slate-400 dark:text-slate-555 font-mono text-sm">#{student.code}</span>
                    </div>
                    
                    <div className="flex flex-col gap-1.5 text-sm font-medium text-slate-555 dark:text-slate-400 mb-4">
                        <div className="flex flex-wrap gap-4">
                            <div className="flex items-center gap-1">
                                <span className="text-blue-600 dark:text-blue-400 font-bold">صفات:</span> <span className="text-slate-800 dark:text-slate-200">{student.points || 0}</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <span className="text-emerald-600 dark:text-emerald-400 font-bold">حضور:</span> <span className="text-slate-800 dark:text-slate-200">{student.attendance ? student.attendance.length : 0}</span>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-4 items-center">
                            <div className="flex items-center gap-1">
                                <span className="text-purple-600 dark:text-purple-400 font-bold">حضور القداس:</span> <span className="text-slate-800 dark:text-slate-200">{student.liturgyAttendance ? student.liturgyAttendance.length : 0}</span>
                            </div>
                            {(() => {
                                const today = new Date();
                                const monthKey = `${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
                                const hasConfessedThisMonth = student.confessions?.[monthKey]?.status === true;
                                return (
                                    <div className="flex items-center gap-1">
                                        <span className="text-amber-600 dark:text-amber-400 font-bold">اعتراف الشهر:</span>
                                        <span>{hasConfessedThisMonth ? '✅' : '❌'}</span>
                                    </div>
                                );
                            })()}
                            <div className="flex items-center gap-2">
                               <span className="text-slate-400 dark:text-slate-555">{student.schoolGrade}</span>
                               {student.assignedClass && (
                                   <span className="text-xs text-slate-500 dark:text-white font-bold">
                                       فصل: {student.assignedClass}
                                   </span>
                               )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0 w-full md:w-auto">
                    <div className="flex flex-wrap gap-2 items-center justify-end w-full">
                        {!isBonus && consecutiveGiftEnabled && ((student.attendanceStreak || 0) > 0 || (student.pendingGifts || 0) > 0) && (
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg self-center">
                                {(student.attendanceStreak || 0) > 0 && (
                                    <span className="text-xs font-bold text-orange-500 flex items-center gap-0.5" dir="ltr">
                                        🔥 {student.attendanceStreak}
                                    </span>
                                )}
                                {(student.pendingGifts || 0) > 0 && (
                                    <button
                                        onClick={() => claimGift(student.id, student.pendingGifts)}
                                        className="bg-amber-500/20 text-amber-500 hover:bg-amber-500/40 px-2 py-0.5 rounded text-xs font-bold transition-colors shrink-0 flex items-center gap-0.5"
                                    >
                                        🎁 إستلام ({student.pendingGifts})
                                    </button>
                                )}
                            </div>
                        )}
                        {!isBonus && (
                            <button onClick={() => openAttendanceModal(student.id)} className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 font-bold">
                                السجل
                            </button>
                        )}
                        {!isBonus && (
                            <button onClick={() => resetPassword(student.id, student.name, student.code)} className="p-2 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-955/30 rounded-lg" title="تصفير الباسورد">
                                <Key size={18} />
                            </button>
                        )}
                        {!isBonus && (
                            <button onClick={() => deleteStudent(student.id, student.name)} className="p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-955/30 rounded-lg" title="حذف">
                                <Trash2 size={18} />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2.5 p-2 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                    <span className="text-sm font-black text-slate-700 dark:text-slate-300 select-none px-1">
                        {isBonus ? 'نقاط البونص:' : 'نقاط الحضور:'}
                    </span>
                    <input 
                        type="number" 
                        value={attendancePointsInput} 
                        onChange={(e) => setAttendancePointsInput(e.target.value)}
                        className={`w-20 text-center bg-transparent border-none outline-none focus:outline-none focus:ring-0 font-black text-lg \${
                            !isPointsValid && attendancePointsInput !== ''
                            ? 'text-whitebg-rose-50 dark:bg-rose-955/20 border border-rose-300 dark:border-rose-800 rounded-lg' 
                            : 'text-slate-900 dark:text-white'
                        }`}
                        placeholder="النقاط"
                        min="0"
                    />
                </div>

                <div className="flex flex-wrap gap-1.5 items-center">
                    {shortcuts.map(val => (
                        <div key={val} className="flex items-center bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800 rounded-lg overflow-hidden text-xs">
                            <button type="button" onClick={() => setAttendancePointsInput(String(val))} className="pl-2.5 pr-1.5 py-1 font-black bg-transparent transition-all hover:bg-purple-100/50 dark:hover:bg-purple-900/30">
                                {val}+
                            </button>
                            <button type="button" onClick={() => removeShortcut(val)} className="pr-2 pl-1 py-1 text-slate-400 hover:text-rose-500 transition-colors bg-transparent border-none">
                                <X size={12} />
                            </button>
                        </div>
                    ))}
                    <button type="button" onClick={() => setShowAddShortcut(true)} className="px-2 py-1 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800 border-dashed rounded-lg text-xs hover:bg-purple-50 dark:hover:bg-purple-955/20 font-bold">+</button>
                </div>

                {isBonus && (
                    <div className="mr-auto flex gap-2">
                        <button 
                            type="button"
                            onClick={async () => {
                                if (isMutatingBonus) return;
                                if (isPointsValid && Number(attendancePointsInput) > 0) {
                                    if (!window.confirm(`هل أنت متأكد أنك تريد خصم {attendancePointsInput} صفة بونص للمخدوم؟`)) {
                                        return;
                                    }
                                    setIsMutatingBonus(true);
                                    try {
                                        await addPoints(student.id, -Number(attendancePointsInput));
                                        setAttendancePointsInput('');
                                    } catch (error) {
                                        console.error(error);
                                    } finally {
                                        setIsMutatingBonus(false);
                                    }
                                }
                            }}
                            disabled={isMutatingBonus || !isPointsValid || Number(attendancePointsInput) <= 0}
                            className={`px-6 py-2 rounded-lg font-bold transition-all ${
                                isPointsValid && Number(attendancePointsInput) > 0 && !isMutatingBonus
                                ? 'bg-rose-500 text-white hover:bg-rose-600 shadow-sm'
                                : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-555 cursor-not-allowed'
                            }`}
                        >
                            خصم بونص
                        </button>
                        <button 
                            type="button"
                            onClick={async () => {
                                if (isMutatingBonus) return;
                                if (isPointsValid && Number(attendancePointsInput) > 0) {
                                    setIsMutatingBonus(true);
                                    try {
                                        await addPoints(student.id, Number(attendancePointsInput));
                                        setAttendancePointsInput('');
                                    } catch (error) {
                                        console.error(error);
                                    } finally {
                                        setIsMutatingBonus(false);
                                    }
                                }
                            }}
                            disabled={isMutatingBonus || !isPointsValid || Number(attendancePointsInput) <= 0}
                            className={`px-6 py-2 rounded-lg font-bold transition-all ${
                                isPointsValid && Number(attendancePointsInput) > 0 && !isMutatingBonus
                                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                                : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-555 cursor-not-allowed'
                            }`}
                        >
                            إضافة بونص
                        </button>
                    </div>
                )}

                {!isBonus && (
                    <div className="mr-auto flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 cursor-pointer font-bold text-sm bg-slate-100 dark:bg-slate-800 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm text-slate-700 dark:text-slate-350 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all select-none">
                            <input
                                type="checkbox"
                                checked={!!student.liturgyAttendance?.includes(todayStr)}
                                onChange={(e) => {
                                    if (isSubmittingLiturgy) return;
                                    setIsSubmittingLiturgy(true);
                                    markLiturgy(student.id, e.target.checked).finally(() => setIsSubmittingLiturgy(false));
                                }}
                                disabled={!isFriday}
                                className="w-5 h-5 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500 cursor-pointer"
                            />
                            <span className="text-black dark:text-white font-bold">حضور القداس ⛪</span>
                        </label>
                        <button 
                            onClick={handleMark} 
                            disabled={isAttendedToday || !isFriday || isSubmitting || !isPointsValid}
                            className={`px-8 py-3 rounded-xl font-black text-base transition-all active:scale-95 ${
                                isAttendedToday 
                                ? 'bg-slate-150 dark:bg-slate-800 text-slate-400 dark:text-slate-555 cursor-not-allowed pointer-events-none' 
                                : (isFriday && !isSubmitting && isPointsValid ? 'bg-emerald-500 text-white shadow-md' : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-555 cursor-not-allowed')
                            }`}
                        >
                            {isSubmitting ? 'جاري التسجيل...' : (isAttendedToday ? 'تم التحضير اليوم' : (isFriday ? 'تسجيل حضور' : 'متاح الجمعة فقط'))}
                        </button>
                    </div>
                )}
            </div>

            {showAddShortcut && (
                <div className="mt-3 flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                    <input 
                        type="number" 
                        value={newShortcut}
                        onChange={e => setNewShortcut(e.target.value)}
                        className="w-20 px-2 py-1 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-sm"
                        placeholder="القيمة..."
                    />
                    <button onClick={addNewShortcut} className="bg-indigo-600 dark:bg-indigo-700 hover:bg-indigo-700 dark:hover:bg-indigo-600 text-white px-3 py-1 rounded-lg text-xs font-bold">إضافة اختصار</button>
                    <button onClick={() => setShowAddShortcut(false)} className="text-slate-400 dark:text-slate-555 hover:text-slate-655 dark:hover:text-slate-400"><X size={16}/></button>
                </div>
            )}
        </div>
    );
}
const STAGE_CLASS_MAP = {



    'ابتدائي': ['حضانة/ملائكة', 'أولى ابتدائى', 'ثانية ابتدائى', 'ثالثة ابتدائى', 'رابعة ابتدائى', 'خامسة ابتدائى', 'سادسة ابتدائي'],



    'اعدادي': ['اولي اعدادي', 'تانيه اعدادي', 'تالته اعدادي'],



    'ثانوي': ['اولي ثانوي', 'تانيه ثانوي', 'تالته ثانوي']



};







export function MasterAdminConsole({ studentsList = [], servantsList = [], attendanceRecords = [], visitationRecords = [] }) {



  const navigate = useNavigate();



  const { isStageServant, servant, isGeneralAdmin, authorizedClasses } = useAuth();







  const myStage = useMemo(() => {



    const rawStage = servant ? (servant.assignedStage || servant.grade || '') : '';



    if (rawStage.includes('ابتدائي') || rawStage.includes('ابتدائى')) return 'ابتدائي';



    if (rawStage.includes('اعدادي') || rawStage.includes('اعدادى')) return 'اعدادي';



    if (rawStage.includes('ثانوي') || rawStage.includes('ثانوى')) return 'ثانوي';



    return '';



  }, [servant]);







  const [selectedStage, setSelectedStage] = useState(() => isStageServant ? myStage : (localStorage.getItem('master_console_stage') || ''));



  const [selectedClass, setSelectedClass] = useState(() => localStorage.getItem('master_console_class') || '');







  useEffect(() => {



    if (isStageServant && myStage) {



        setSelectedStage(myStage);



    }



  }, [isStageServant, myStage]);







  const classesJoin = (authorizedClasses || []).join(',');



  useEffect(() => {



    if (!isGeneralAdmin && authorizedClasses && authorizedClasses.length > 0) {



      if (!selectedClass || !authorizedClasses.includes(selectedClass)) {



        setSelectedClass(authorizedClasses[0]);



        localStorage.setItem('master_console_class', authorizedClasses[0]);



      }



    }



  }, [isGeneralAdmin, classesJoin, selectedClass]);







  const handleStageChange = (e) => {



    if (isStageServant) return;



    const val = e.target.value;



    setSelectedStage(val);



    setSelectedClass('');



    localStorage.setItem('master_console_stage', val);



    localStorage.removeItem('master_console_class');



  };







  const handleClassChange = (e) => {



    const val = e.target.value;



    setSelectedClass(val);



    localStorage.setItem('master_console_class', val);



  };







  const stats = useMemo(() => {



    if (!selectedStage || !selectedClass) return null;



    const filteredStudents = studentsList.filter(s => s.stage === selectedStage && s.class === selectedClass);



    const filteredServants = servantsList.filter(s => {



      // Normalize stage comparison to handle spelling variants (e.g. ابتدائى vs ابتدائي)



      const stageMatch = normalizeArabic(s.assignedStage || s.grade || '') === normalizeArabic(selectedStage);



      if (!stageMatch) return false;



      // Check all class fields: myClasses (primary), managedClasses (stage servant), assignedClass (legacy)



      const allClasses = [



        ...(s.myClasses || []),



        ...(s.managedClasses || []),



        ...(s.assignedClass ? [s.assignedClass] : []),



        ...(s.assignment ? [s.assignment] : []),



      ];



      return allClasses.includes(selectedClass);



    });



    const classAttendance = attendanceRecords.filter(r => r.stage === selectedStage && r.class === selectedClass) || [];



    const lastRecord = classAttendance.sort((a, b) => b.date?.seconds - a.date?.seconds)[0];







    let targetFridayStr = '';



    let targetFridayEndTime = 0;







    if (lastRecord && lastRecord.date?.seconds) {



      const lastRecordDate = new Date(lastRecord.date.seconds * 1000);



      const y = lastRecordDate.getFullYear();



      const m = String(lastRecordDate.getMonth() + 1).padStart(2, '0');



      const d = String(lastRecordDate.getDate()).padStart(2, '0');



      targetFridayStr = `${y}-${m}-${d}`;



      targetFridayEndTime = new Date(y, lastRecordDate.getMonth(), lastRecordDate.getDate(), 23, 59, 59).getTime();



    } else {



      const today = new Date();



      const lastFriday = new Date();



      lastFriday.setDate(today.getDate() - ((today.getDay() + 2) % 7));



      const y = lastFriday.getFullYear();



      const m = String(lastFriday.getMonth() + 1).padStart(2, '0');



      const d = String(lastFriday.getDate()).padStart(2, '0');



      targetFridayStr = `${y}-${m}-${d}`;



      targetFridayEndTime = new Date(y, lastFriday.getMonth(), lastFriday.getDate(), 23, 59, 59).getTime();



    }







    const today = new Date();



    const currentMonthEndTime = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59).getTime();



    const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;







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







    let totalStudentsForAttendance = 0;



    let totalStudentsForMonthly = 0;



    let lastFridayCount = 0;



    let lastFridayLiturgyCount = 0;



    let absentStudentsCount = 0;



    let phoneCalledCount = 0;



    let homeVisitedCount = 0;







    filteredStudents.forEach(st => {



        const createdAtTime = getCleanCreatedAtTime(st);

        const isAttended = st.attendance && st.attendance.some(dStr => {
            if (!dStr) return false;
            return dStr.startsWith(targetFridayStr);
        });

        const isLiturgyAttended = st.liturgyAttendance && st.liturgyAttendance.some(dStr => {
            if (!dStr) return false;
            return dStr.startsWith(targetFridayStr);
        });

        const existedLastFriday = (targetFridayEndTime >= createdAtTime) || isAttended || isLiturgyAttended;

        const existedInMonth = currentMonthEndTime >= createdAtTime;



        if (existedLastFriday) {

            totalStudentsForAttendance++;

            if (isAttended) {

                lastFridayCount++;

            } else {

                absentStudentsCount++;

                const phoneStatus = st.phoneVisitations?.[targetFridayStr]?.status;

                if (phoneStatus === 'called' || phoneStatus === 'visited' || phoneStatus === 'late_attended') {

                    phoneCalledCount++;

                }

            }

            if (isLiturgyAttended) {

                lastFridayLiturgyCount++;

            }



        }







        if (existedInMonth) {



            totalStudentsForMonthly++;



            const hv = st.homeVisitations || {};



            const isHomeVisited = hv[currentMonthStr] && (hv[currentMonthStr].status === 'visited' || hv[currentMonthStr].status === 'late_attended');



            if (isHomeVisited) {



                homeVisitedCount++;



            }



        }



    });







    const homeRate = totalStudentsForMonthly ? Math.round((homeVisitedCount / totalStudentsForMonthly) * 100) : 0;



    const phoneRate = absentStudentsCount > 0 ? Math.round((phoneCalledCount / absentStudentsCount) * 100) : 100;



    const totalStreak = filteredStudents.reduce((acc, curr) => acc + (curr.currentStreak || 0), 0);







    return {



      totalStudents: filteredStudents.length,



      totalStudentsForAttendance: totalStudentsForAttendance,



      totalServants: filteredServants.length,



      lastFriday: lastFridayCount,



      lastFridayLiturgy: lastFridayLiturgyCount,



      phoneRate: phoneRate,



      homeRate: homeRate,



      streak: totalStreak



    };



  }, [selectedStage, selectedClass, studentsList, servantsList, attendanceRecords, visitationRecords]);







  const handleNavigation = (path, extraState = {}) => {



    if (!selectedStage || !selectedClass) return;



    navigate(path, { state: { prefilledStage: selectedStage, prefilledClass: selectedClass, ...extraState } });



  };







  return (



    <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl w-full text-right mt-6">



      <div className="flex items-center gap-2 mb-6 border-b border-slate-800 pb-3">



        <BarChart2 className="text-blue-500" size={24} />



        <h2 className="text-xl font-bold text-white">



            {isStageServant ? `لوحة التحكم المخصصة لمرحلة ${myStage} 🏫` : 'الرئيسه للأمين العام'}



        </h2>



      </div>







      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">



        <div>



          <label className="block text-slate-400 text-sm mb-2 font-medium">المرحلة الدراسية</label>



          <select value={selectedStage} onChange={handleStageChange} disabled={isStageServant} className="w-full bg-[#1e293b]/60 border border-slate-700/50 text-white rounded-xl p-3 focus:outline-none focus:border-blue-500 disabled:opacity-75 disabled:cursor-not-allowed font-bold">



            <option value="" className="bg-[#0f172a] text-white">-- اختر المرحلة الدراسية --</option>



            {Object.keys(STAGE_CLASS_MAP).map(stage => <option key={stage} value={stage} className="bg-[#0f172a] text-white">{stage}</option>)}



          </select>



        </div>



        <div>



          <label className="block text-slate-400 text-sm mb-2 font-medium">اختر الفصل</label>



          <select value={selectedClass} onChange={handleClassChange} disabled={!selectedStage} className="w-full bg-[#1e293b]/60 border border-slate-700/50 text-white rounded-xl p-3 focus:outline-none focus:border-blue-500 disabled:opacity-50 font-bold">



            {isGeneralAdmin ? (



              <>



                <option value="" className="bg-[#0f172a] text-white">-- اختر الفصل --</option>



                {selectedStage && STAGE_CLASS_MAP[selectedStage].map(cls => <option key={cls} value={cls} className="bg-[#0f172a] text-white">{cls}</option>)}



              </>



            ) : (



              selectedStage && (authorizedClasses || []).map(cls => <option key={cls} value={cls} className="bg-[#0f172a] text-white">{cls}</option>)



            )}



          </select>



        </div>



      </div>







      {stats ? (



        <>



          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">



            <div className="bg-[#1e293b]/40 p-4 rounded-xl border border-slate-700/40">



              <div className="flex justify-between items-center mb-2"><Users className="text-blue-400" size={20} /><span className="text-xs text-slate-400 font-bold">إجمالي الطلاب</span></div>



              <p className="text-2xl font-bold text-white">{stats.totalStudents}</p>



            </div>



            <div className="bg-[#1e293b]/40 p-4 rounded-xl border border-slate-700/40">



              <div className="flex justify-between items-center mb-2"><UserCheck className="text-green-400" size={20} /><span className="text-xs text-slate-400 font-bold">عدد خدام مدارس الأحد</span></div>



              <p className="text-2xl font-bold text-white">{stats.totalServants}</p>



            </div>



            <div className="bg-[#1e293b]/40 p-4 rounded-xl border border-slate-700/40">



              <div className="flex justify-between items-center mb-2"><Calendar className="text-purple-400" size={20} /><span className="text-xs text-slate-400 font-bold">حضور آخر جمعة</span></div>



              <p className="text-2xl font-bold text-white">{stats.lastFriday}/{stats.totalStudentsForAttendance}</p>



            </div>



            <div className="bg-[#1e293b]/40 p-4 rounded-xl border border-slate-700/40">



              <div className="flex justify-between items-center mb-2"><Church className="text-teal-400" size={20} /><span className="text-xs text-slate-400 font-bold">حضور القداس</span></div>



              <p className="text-2xl font-bold text-white">{stats.lastFridayLiturgy}/{stats.totalStudentsForAttendance}</p>



            </div>



            



            <div className="bg-[#1e293b]/40 p-3 rounded-xl border border-slate-700/40 flex flex-col justify-between">



              <div className="flex justify-between items-center mb-1 pb-1 border-b border-slate-700/30">



                <Heart className="text-rose-400" size={16} />



                <span className="text-xs text-slate-400 font-bold">نسبة الافتقاد</span>



              </div>



              <div className="flex flex-col gap-1 text-right mt-1">



                <div className="flex justify-between items-center text-xs">



                  <span className="text-slate-300 font-medium">الافتقاد الأسبوعي:</span>



                  <span className="font-bold text-white text-sm">{stats.phoneRate}%</span>



                </div>



                <div className="flex justify-between items-center text-xs">



                  <span className="text-slate-300 font-medium">الافتقاد المنزلي:</span>



                  <span className="font-bold text-white text-sm">{stats.homeRate}%</span>



                </div>



              </div>



            </div>



          </div>







          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">



            <button type="button" onClick={() => handleNavigation('/admin/attendance')} className="flex items-center justify-center gap-2 p-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-all cursor-pointer border-none"><Calendar size={18} /><span>كشوف حضور المخدومين للفصل</span></button>



            <button type="button" onClick={() => handleNavigation('/admin/visitation')} className="flex items-center justify-center gap-2 p-4 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-xl transition-all cursor-pointer border-none"><Heart size={18} /><span>كشوف الافتقاد للفصل</span></button>



            <button type="button" onClick={() => handleNavigation('/admin/servants')} className="flex items-center justify-center gap-2 p-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-all cursor-pointer border-none"><UserCheck size={18} /><span>إدارة خدام مدارس الأحد للفصل</span></button>



            <button type="button" onClick={() => handleNavigation('/admin/store')} className="flex items-center justify-center gap-2 p-4 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-xl border border-slate-700 transition-all cursor-pointer"><ShoppingBag size={18} /><span>المعرض</span></button>



            <button type="button" onClick={() => handleNavigation('/admin/orders')} className="flex items-center justify-center gap-2 p-4 bg-violet-600 hover:bg-violet-700 text-white font-medium rounded-xl transition-all cursor-pointer border-none"><ArrowLeftRight size={18} /><span>طلبات معرض الصفات</span></button>



            <button type="button" onClick={() => handleNavigation('/admin/gifts', { activeTab: 'four_weeks' })} className="flex items-center justify-center gap-2 p-4 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-xl transition-all cursor-pointer border-none"><Flame size={18} /><span>نظام متابعة الـ 4 أسابيع</span></button>



            <button type="button" onClick={() => handleNavigation('/admin/gifts', { activeTab: 'birthdays' })} className="flex items-center justify-center gap-2 p-4 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-xl transition-all cursor-pointer border-none"><Gift size={18} /><span>نظام متابعة أعياد الميلاد</span></button>



            <button type="button" onClick={() => navigate('/admin?tab=notifications')} className="flex items-center justify-center gap-2 p-4 bg-[#271e48] hover:bg-[#34275e] text-white font-medium rounded-xl transition-all cursor-pointer border-none"><Bell size={18} /><span>لوحة تحكم الإشعارات 🔔</span></button>



          </div>



        </>



      ) : (



        <div className="text-center py-6 text-slate-500 text-sm bg-slate-950/40 rounded-xl border border-slate-800/50 border-dashed">يرجى اختيار المرحلة والفصل لعرض الإحصائيات الفورية والوصول السريع.</div>



      )}



    </div>



  );



}







export default function AdminDashboard() {



    const { user, loading, logout, isGeneralAdmin, isStageServant, servant, authorizedClasses } = useAuth();



    const navigate = useNavigate();



    const originalTitleRef = useRef(document.title);







    const myStage = useMemo(() => {



        const rawStage = servant ? (servant.assignedStage || servant.grade || '') : '';



        if (rawStage.includes('ابتدائي') || rawStage.includes('ابتدائى')) return 'ابتدائي';



        if (rawStage.includes('اعدادي') || rawStage.includes('اعدادى')) return 'اعدادي';



        if (rawStage.includes('ثانوي') || rawStage.includes('ثانوى')) return 'ثانوي';



        return '';



    }, [servant]);







    // State Variables



    const [searchParams, setSearchParams] = useSearchParams();



    const tabParam = searchParams.get('tab');



    const activeTab = tabParam || 'master_console';



    const [selectedStageTab1, setSelectedStageTab1] = useState('الكل');



    const [selectedClassTab1, setSelectedClassTab1] = useState('الكل');



    const [selectedStageTab2, setSelectedStageTab2] = useState('الكل');



    const [selectedClassTab2, setSelectedClassTab2] = useState('الكل');



    const [selectedStagePrint, setSelectedStagePrint] = useState('الكل');



    const [selectedClassPrint, setSelectedClassPrint] = useState('الكل');



    const [selectedStudentsPrint, setSelectedStudentsPrint] = useState([]);

    const [newStudent, setNewStudent] = useState({ name: '', code: '', password: '', birthDate: '', addresses: [''], phones: [''], fatherOfConfession: '', schoolGrade: '', assignedClass: '', parentsContacts: [] });

    const [addMode, setAddMode] = useState('single');
    const [bulkStudents, setBulkStudents] = useState([]);
    const [isParsing, setIsParsing] = useState(false);

    const [excelHeaders, setExcelHeaders] = useState([]);
    const [excelRows, setExcelRows] = useState([]);
    const [mappingStep, setMappingStep] = useState('upload'); // 'upload', 'map', 'preview'
    const [fieldMappings, setFieldMappings] = useState({
        name: '',
        birthDate: '',
        fatherOfConfession: '',
        phone: '',
        addressColumns: [''],
        fatherPhone: '',
        motherPhone: ''
    });

    const [selectedClassPromoteCurrent, setSelectedClassPromoteCurrent] = useState('');
    const [selectedClassPromoteNew, setSelectedClassPromoteNew] = useState('');
    const [selectedStudentsPromote, setSelectedStudentsPromote] = useState([]);

    const [students, setStudents] = useState([]);



    const [studentsLoading, setStudentsLoading] = useState(true);



    const [servants, setServants] = useState([]);



    const [searchTerm, setSearchTerm] = useState('');



    const [isOnline, setIsOnline] = useState(navigator.onLine);



    const [showAddForm, setShowAddForm] = useState(false);



    const [isAdding, setIsAdding] = useState(false);

    const [bulkTargetStage, setBulkTargetStage] = useState('');
    const [bulkTargetClass, setBulkTargetClass] = useState('');

    useEffect(() => {
        if (showAddForm) {
            if (!isGeneralAdmin && myStage) {
                setBulkTargetStage(myStage);
                if (authorizedClasses && authorizedClasses.length === 1) {
                    setBulkTargetClass(authorizedClasses[0]);
                } else {
                    setBulkTargetClass('');
                }
            } else {
                setBulkTargetStage('');
                setBulkTargetClass('');
            }
            setBulkStudents([]);
            setExcelHeaders([]);
            setExcelRows([]);
            setMappingStep('upload');
            setFieldMappings({
                name: '',
                birthDate: '',
                fatherOfConfession: '',
                phone: '',
                addressColumns: [''],
                fatherPhone: '',
                motherPhone: ''
            });
        }
    }, [showAddForm, isGeneralAdmin, myStage, authorizedClasses]);







    const [systemCounters, setSystemCounters] = useState({ primary: 1000, middle: 2000, high: 3000 });







    const [toast, setToast] = useState({ show: false, message: '', type: 'success' });



    const [isPrintingBulk, setIsPrintingBulk] = useState(false);



    const [storeConfigs, setStoreConfigs] = useState([]);







    useEffect(() => {



        const unsub = onSnapshot(collection(db, 'store_config'), (snapshot) => {



            const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));



            setStoreConfigs(list);



        });



        return () => unsub();



    }, []);







    const showToast = (message, type = 'success') => {



        setToast({ show: true, message, type });



        setTimeout(() => {



            setToast(prev => ({ ...prev, show: false }));



        }, 4500);



    };







    // تصفير وتثبيت الفلاتر فورياً لأمين المرحلة عند التحميل لمنع تسريب الرؤية للعام



    useEffect(() => {



        if (isStageServant && myStage) {



            setSelectedStageTab1(myStage);



            setSelectedStageTab2(myStage);



            setSelectedStagePrint(myStage);



        }



    }, [isStageServant, myStage]);







    const authorizedClassesStr = (authorizedClasses || []).join(',');







    // تحصين استمارة الإضافة لجميع المستخدمين غير الأمناء العاميين



    useEffect(() => {



        // Use strict !isGeneralAdmin check — covers both stage and class servants without fragile subtype conditionals



        if (showAddForm && !isGeneralAdmin && myStage && students.length > 0) {



            setNewStudent(prev => {



                if (prev.schoolGrade !== myStage) {



                    const standardNorms = ['ابتدائي', 'اعدادي', 'ثانوي'].map(normalizeArabic);



                    const existingStages = Array.from(new Set(students.map(s => s.schoolGrade).filter(Boolean)));



                    const uniqueCustomStages = [];



                    existingStages.forEach(s => {



                        const sNorm = normalizeArabic(s);



                        if (sNorm && !standardNorms.includes(sNorm) && !uniqueCustomStages.includes(sNorm)) {



                            uniqueCustomStages.push(sNorm);



                        }



                    });



                    



                    let baseCode = 4001;



                    if (myStage === 'ابتدائي') baseCode = 1001;



                    else if (myStage === 'اعدادي') baseCode = 2001;



                    else if (myStage === 'ثانوي') baseCode = 3001;







                    const existingCodes = students.map(s => Number(s.code)).filter(Boolean);



                    let nextCode = baseCode;



                    while (existingCodes.includes(nextCode)) {



                        nextCode++;



                    }







                    return {



                        ...prev,



                        schoolGrade: myStage,



                        // Auto-lock assignedClass if the restricted servant only manages one class



                        assignedClass: (authorizedClasses && authorizedClasses.length === 1) ? authorizedClasses[0] : '',



                        code: nextCode.toString(),



                        password: nextCode.toString()



                    };



                }



                return prev;



            });



        }



    }, [showAddForm, isGeneralAdmin, myStage, students, authorizedClassesStr]);







    const mappedStudentsList = useMemo(() => {



        return students.map(s => ({



            ...s,



            stage: s.schoolGrade,



            class: s.assignedClass,



            currentStreak: s.attendanceStreak || 0



        }));



    }, [students]);







    const attendanceRecords = useMemo(() => {



        const groups = {};



        students.forEach(st => {



            const stage = st.schoolGrade || '';



            const cls = st.assignedClass || '';



            if (!stage || !cls) return;



            



            (st.attendance || []).forEach(dateStr => {



                const date = new Date(dateStr);



                const y = date.getFullYear();



                const m = String(date.getMonth() + 1).padStart(2, '0');



                const d = String(date.getDate()).padStart(2, '0');



                const normDateStr = `${y}-${m}-${d}`;



                



                const key = `${stage}|${cls}|${normDateStr}`;



                if (!groups[key]) {



                    groups[key] = {



                        stage,



                        class: cls,



                        date: { seconds: date.getTime() / 1000 },



                        presentCount: 0



                    };



                }



                groups[key].presentCount++;



            });



        });



        return Object.values(groups);



    }, [students]);







    const visitationRecords = useMemo(() => {



        const records = [];



        const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;



        



        const today = new Date();



        const lastFriday = new Date();



        lastFriday.setDate(today.getDate() - ((today.getDay() + 2) % 7));



        const y = lastFriday.getFullYear();



        const m = String(lastFriday.getMonth() + 1).padStart(2, '0');



        const d = String(lastFriday.getDate()).padStart(2, '0');



        const lastFridayStr = `${y}-${m}-${d}`;







        students.forEach(st => {



            const stage = st.schoolGrade || '';



            const cls = st.assignedClass || '';



            if (!stage || !cls) return;



            



            const hv = st.homeVisitations || {};



            const pv = st.phoneVisitations || {};



            



            const isHomeVisited = hv[currentMonth] && (hv[currentMonth].status === 'visited' || hv[currentMonth].status === 'late_attended');



            const isPhoneVisited = pv[lastFridayStr] && (pv[lastFridayStr].status === 'called' || pv[lastFridayStr].status === 'visited' || pv[lastFridayStr].status === 'late_attended');



            



            if (isHomeVisited) {



                records.push({ stage, class: cls, studentId: st.id, type: 'home' });



            }



            if (isPhoneVisited) {



                records.push({ stage, class: cls, studentId: st.id, type: 'phone' });



            }



        });



        return records;



    }, [students]);







    useEffect(() => {



        const unsub = onSnapshot(doc(db, 'system_counters', 'student_codes'), (docSnap) => {



            if (docSnap.exists()) {



                const data = docSnap.data();



                setSystemCounters({



                    primary: data.primary !== undefined ? data.primary : 1000,



                    middle: data.middle !== undefined ? data.middle : 2000,



                    high: data.high !== undefined ? data.high : 3000



                });



            }



        });



        return () => unsub();



    }, []);







    useEffect(() => {



        const originalTitle = document.title;



        const handleBeforePrint = () => {



            if (activeTab === 'directory') {



                const today = new Date();



                const dateStr = `${today.getDate()}-${today.getMonth() + 1}-${today.getFullYear()}`;



                const stage = selectedStageTab2 || 'الكل';



                const cls = selectedClassTab2 || 'الكل';



                document.title = `كشف المخدومين - مرحلة ${stage} - فصل ${cls} - ${dateStr}`;



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



    }, [activeTab, selectedStageTab2, selectedClassTab2]);







    useEffect(() => {



        const handleAfterPrintBulk = () => {



            document.body.classList.remove('printing-bulk');



            setIsPrintingBulk(false);



            if (originalTitleRef.current) {



                document.title = originalTitleRef.current;



            }



        };



        window.addEventListener('afterprint', handleAfterPrintBulk);



        return () => window.removeEventListener('afterprint', handleAfterPrintBulk);



    }, []);







    const handleBulkPrint = () => {



        originalTitleRef.current = document.title;



        const stageName = selectedStagePrint === 'الكل' ? 'كل المراحل' : selectedStagePrint;



        const className = selectedClassPrint === 'الكل' ? 'كل الفصول' : selectedClassPrint;



        const printDate = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'numeric', day: 'numeric' }).replace(/\//g, '-');



        document.title = `${stageName} - ${className} - ${printDate}`;







        setIsPrintingBulk(true);



        document.body.classList.add('printing-bulk');



        // Small delay to ensure render updates are processed before print dialog pops



        setTimeout(() => {



            window.print();



        }, 150);



    };







    const handleStageChange = (stage) => {



        if (isStageServant) return; // منع التلاعب بأي شكل



        if (!stage) {



            setNewStudent(prev => ({ ...prev, schoolGrade: stage, assignedClass: '', code: '', password: '' }));



            return;



        }







        const stageNorm = normalizeArabic(stage);



        const standardNorms = ['ابتدائي', 'اعدادي', 'ثانوي'].map(normalizeArabic);



        const existingStages = Array.from(new Set(students.map(s => s.schoolGrade).filter(Boolean)));



        const uniqueCustomStages = [];



        existingStages.forEach(s => {



            const sNorm = normalizeArabic(s);



            if (sNorm && !standardNorms.includes(sNorm) && !uniqueCustomStages.includes(sNorm)) {



                uniqueCustomStages.push(sNorm);



            }



        });



        



        let baseCode = 4001;



        if (stageNorm.includes('ابتدائي')) baseCode = 1001;



        else if (stageNorm.includes('اعدادي')) baseCode = 2001;



        else if (stageNorm.includes('ثانوي')) baseCode = 3001;



        else {



            let idx = uniqueCustomStages.indexOf(stageNorm);



            if (idx === -1) idx = uniqueCustomStages.length;



            baseCode = 4001 + (idx * 1000);



        }







        const existingCodes = students.map(s => Number(s.code)).filter(Boolean);



        let nextCode = baseCode;



        while (existingCodes.includes(nextCode)) {



            nextCode++;



        }







        setNewStudent(prev => ({



            ...prev,



            schoolGrade: stage,



            assignedClass: isGeneralAdmin ? '' : (authorizedClasses?.[0] || ''),



            code: nextCode.toString(),



            password: nextCode.toString()



        }));



    };







    const [attendanceModalStudentId, setAttendanceModalStudentId] = useState(null);



    const [classShortcuts, setClassShortcuts] = useState({});



    const [attendanceConfigs, setAttendanceConfigs] = useState({});







    useEffect(() => {



        const unsub = onSnapshot(collection(db, 'class_shortcuts_config'), (snapshot) => {



            const configMap = {};



            snapshot.docs.forEach(doc => { configMap[doc.id] = doc.data().buttons || []; });



            setClassShortcuts(configMap);



        });



        return () => unsub();



    }, []);







    useEffect(() => {



        const unsub = onSnapshot(collection(db, 'attendance_config'), (snapshot) => {



            const configMap = {};



            snapshot.docs.forEach(doc => { configMap[doc.id] = doc.data(); });



            setAttendanceConfigs(configMap);



        });



        return () => unsub();



    }, []);







    const getShortcutsForClass = (clsName) => {



        const key = getSafeClassId(clsName) || 'عام';



        const config = classShortcuts[key];



        return Array.isArray(config) && config.length > 0 ? config : [5, 10, 20];



    };







    const addShortcutForClass = async (clsName, value) => {



        const key = getSafeClassId(clsName) || 'عام';



        if (!key || typeof key !== 'string') return;



        const current = getShortcutsForClass(key);



        if (current.includes(value)) return;



        const updated = [...current, value].sort((a, b) => a - b);



        try {



            await setDoc(doc(db, 'class_shortcuts_config', key), { buttons: updated }, { merge: true });



        } catch (error) {



            console.error("Error adding shortcut:", error);



        }



    };







    const removeShortcutForClass = async (clsName, value) => {



        const key = getSafeClassId(clsName) || 'عام';



        if (!key || typeof key !== 'string') return;



        const current = getShortcutsForClass(key);



        const updated = current.filter(val => val !== value);



        try {



            await setDoc(doc(db, 'class_shortcuts_config', key), { buttons: updated }, { merge: true });



        } catch (error) {



            console.error("Error removing shortcut:", error);



        }



    };







    // جلب وحماية البيانات اللحظية بناءً على نطاق أمين المرحلة لمنع التسريب كلياً



    useEffect(() => {



        if (!user || loading) return;







        const handleStatusChange = () => setIsOnline(navigator.onLine);



        window.addEventListener('online', handleStatusChange);



        window.addEventListener('offline', handleStatusChange);







        const unsub = onSnapshot(collection(db, 'students'), (snapshot) => {



            const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));



            const scopedStudents = isGeneralAdmin 



                ? list 



                : list.filter(s => normalizeArabic(s.schoolGrade || '') === normalizeArabic(myStage));



            setStudents(scopedStudents);



            setStudentsLoading(false);



        }, (error) => {



            console.error("Error fetching students:", error);



            setStudentsLoading(false);



        });







        const unsubServants = onSnapshot(collection(db, 'servants'), (snapshot) => {



            const list = snapshot.docs.map(doc => {



                const data = doc.data();



                const sanitizedName = typeof data.name === 'object' ? data.name.name : data.name;



                return { id: doc.id, ...data, name: sanitizedName || '' };



            });



            // Exclude pending applications and rejected/deleted accounts — only count approved servants



            const approvedList = list.filter(s => s.status !== 'pending' && s.status !== 'rejected' && s.status !== 'deleted');



            const scopedServants = isGeneralAdmin



                ? approvedList



                : approvedList.filter(s => normalizeArabic(s.assignedStage || s.grade || '') === normalizeArabic(myStage));



            setServants(scopedServants);



        }, (error) => {



            console.error("Error fetching servants:", error);



        });







        return () => {



            window.removeEventListener('online', handleStatusChange);



            window.removeEventListener('offline', handleStatusChange);



            unsub();



            unsubServants();



        };



    }, [user, loading, isGeneralAdmin, myStage]);







    const handleLogout = async () => {



        try {



            await logout();



            navigate('/admin/login');



        } catch (error) {



            console.error("Logout error:", error);



        }



    };







    const handleAddStudent = async (e) => {



        e.preventDefault();



        if (!newStudent.name || !newStudent.schoolGrade || isAdding) return;

        if (!newStudent.assignedClass) {
            setToast({ show: true, message: 'يجب اختيار الفصل قبل إضافة المخدوم', type: 'error' });
            return;
        }







        setIsAdding(true);



        try {



            const metadataRef = doc(db, 'metadata', 'students_keys');



            const metadataSnap = await getDoc(metadataRef);



            if (!metadataSnap.exists()) {



                const studentsSnap = await getDocs(collection(db, 'students'));



                const usedCodesByStage = {};



                studentsSnap.docs.forEach(d => {



                    const data = d.data();



                    const code = Number(data.code);



                    const st = data.schoolGrade || '';



                    if (code && st) {



                        if (!usedCodesByStage[st]) usedCodesByStage[st] = [];



                        if (!usedCodesByStage[st].includes(code)) usedCodesByStage[st].push(code);



                    }



                });



                await setDoc(metadataRef, { usedCodesByStage });



            }







            let transactionResultCode = '';







            await runTransaction(db, async (transaction) => {



                const metaSnap = await transaction.get(metadataRef);



                const metaData = metaSnap.data();



                const usedCodesByStage = metaData.usedCodesByStage || {};



                const finalStage = isStageServant ? myStage : newStudent.schoolGrade;



                



                const stageKey = Object.keys(usedCodesByStage).find(k => normalizeArabic(k) === normalizeArabic(finalStage)) || finalStage;



                const codesList = usedCodesByStage[stageKey] || [];



                



                const sortedCodes = [...codesList].map(Number).filter(Boolean).sort((a, b) => a - b);



                const baseCode = getBaseCodeForStage(finalStage, Object.keys(usedCodesByStage));



                



                let newCodeInt = baseCode;



                while (sortedCodes.includes(newCodeInt)) {



                    newCodeInt++;



                }



                const finalCode = String(newCodeInt);



                transactionResultCode = finalCode;







                const newStudentRef = doc(collection(db, 'students'));



                transaction.set(newStudentRef, {
                    name: newStudent.name,
                    code: finalCode,
                    birthDate: newStudent.birthDate,
                    addresses: newStudent.addresses.filter(a => a.trim() !== ''),
                    phones: newStudent.phones.filter(p => p.trim() !== ''),
                    parentsContacts: (newStudent.parentsContacts || []).filter(c => c.phone.trim() !== ''),
                    fatherOfConfession: newStudent.fatherOfConfession,
                    schoolGrade: finalStage,
                    assignedClass: newStudent.assignedClass,
                    points: 0,
                    attendance: [],
                    password: finalCode,
                    isPasswordChanged: false,
                    homeVisitations: {},
                    phoneVisitations: {},
                    createdAt: serverTimestamp(),
                    addedViaBulk: false,
                    studentEditedBirthDate: false
                });







                if (!usedCodesByStage[stageKey]) usedCodesByStage[stageKey] = [];



                usedCodesByStage[stageKey].push(newCodeInt);



                usedCodesByStage[stageKey].sort((a, b) => a - b);







                transaction.update(metadataRef, { usedCodesByStage });



            });







            setNewStudent({ name: '', code: '', password: '', birthDate: '', addresses: [''], phones: [''], fatherOfConfession: '', schoolGrade: '', assignedClass: '', parentsContacts: [] });



            setShowAddForm(false);



            alert(`تم إضافة المخدوم بنجاح بكود: ${transactionResultCode} ✅`);



        } catch (error) {



            console.error("Error adding student:", error);



            alert('حدث خطأ أثناء الإضافة');



        } finally {



            setIsAdding(false);



        }



    };

    const handleExcelUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!bulkTargetStage || !bulkTargetClass) {
            showToast('برجاء اختيار المرحلة والفصل المستهدفين أولاً ⚠️', 'warning');
            return;
        }

        setIsParsing(true);
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                if (jsonData.length <= 1) {
                    showToast('ملف إكسيل فارغ أو لا يحتوي على بيانات ⚠️', 'warning');
                    setIsParsing(false);
                    return;
                }

                const headers = jsonData[0].map(h => String(h || '').trim()).filter(Boolean);
                if (headers.length === 0) {
                    showToast('لم يتم العثور على عناوين أعمدة في الصف الأول ⚠️', 'error');
                    setIsParsing(false);
                    return;
                }

                setExcelHeaders(headers);
                setExcelRows(jsonData);
                
                const detected = autoDetectMappings(headers);
                setFieldMappings(detected);

                setMappingStep('map');
                showToast('تم قراءة الملف بنجاح! يرجى ربط الأعمدة.', 'success');
            } catch (err) {
                console.error("Error reading excel file:", err);
                showToast('حدث خطأ أثناء قراءة ملف إكسيل ❌', 'error');
            } finally {
                setIsParsing(false);
            }
        };
        reader.readAsArrayBuffer(file);
    };

    const handleExtractData = () => {
        if (!fieldMappings.name) {
            showToast('برجاء اختيار عمود "الاسم" أولاً ⚠️', 'warning');
            return;
        }

        const nameIdx = excelHeaders.indexOf(fieldMappings.name);
        const birthDateIdx = fieldMappings.birthDate ? excelHeaders.indexOf(fieldMappings.birthDate) : -1;
        const fatherIdx = fieldMappings.fatherOfConfession ? excelHeaders.indexOf(fieldMappings.fatherOfConfession) : -1;
        const phoneIdx = fieldMappings.phone ? excelHeaders.indexOf(fieldMappings.phone) : -1;

        const fatherPhoneIdx = fieldMappings.fatherPhone ? excelHeaders.indexOf(fieldMappings.fatherPhone) : -1;
        const motherPhoneIdx = fieldMappings.motherPhone ? excelHeaders.indexOf(fieldMappings.motherPhone) : -1;

        const addressIndices = fieldMappings.addressColumns
            .map(colName => excelHeaders.indexOf(colName))
            .filter(idx => idx !== -1);

        const parsedList = [];
        for (let i = 1; i < excelRows.length; i++) {
            const row = excelRows[i];
            if (!row || row.length === 0) continue;

            const name = row[nameIdx] ? String(row[nameIdx]).trim() : '';
            if (!name) continue; // Skip empty rows

            const birthDateRaw = birthDateIdx !== -1 && row[birthDateIdx] ? String(row[birthDateIdx]).trim() : '';
            const father = fatherIdx !== -1 && row[fatherIdx] ? String(row[fatherIdx]).trim() : '';
            const phoneRaw = phoneIdx !== -1 && row[phoneIdx] ? String(row[phoneIdx]).trim() : '';
            const fatherPhoneRaw = fatherPhoneIdx !== -1 && row[fatherPhoneIdx] ? String(row[fatherPhoneIdx]).trim() : '';
            const motherPhoneRaw = motherPhoneIdx !== -1 && row[motherPhoneIdx] ? String(row[motherPhoneIdx]).trim() : '';

            // Merge address columns in order separated by " - "
            const addressParts = addressIndices.map(idx => row[idx] ? String(row[idx]).trim() : '').filter(Boolean);
            const address = addressParts.join(' - ');

            // Split phones if containing /, -, or _
            const phonesArray = phoneRaw.split(/[\/\-_]/).map(p => p.trim()).filter(Boolean);

            const parentsContacts = [];

            const parseParentContact = (rawValue, defaultRelation, defaultName) => {
                if (!rawValue) return [];
                const formatted = rawValue.replace(/(01[0125]\d{8})/g, '|$1');
                const parts = formatted.split(/[|/\\\-_\n\r,و]/);
                const results = [];

                parts.forEach(part => {
                    const trimmedPart = part.trim();
                    if (!trimmedPart) return;

                    const phoneMatch = trimmedPart.match(/01[0125]\d{8}/); 
                    const cleanPhone = phoneMatch ? phoneMatch[0] : "";
                    if (!cleanPhone) return;

                    let relationship = defaultRelation;
                    let name = defaultName;

                    if (trimmedPart.includes("ام") || trimmedPart.includes("الأم") || trimmedPart.includes("الام")) {
                        relationship = "mother";
                        name = "أم";
                    } else if (trimmedPart.includes("اب") || trimmedPart.includes("الأب") || trimmedPart.includes("الاب")) {
                        relationship = "father";
                        name = "أب";
                    }

                    results.push({ phone: cleanPhone, relation: relationship, name: name });
                });

                return results;
            };

            const parsedPhones = [];
            phonesArray.forEach(p => {
                const parentOpts = parseParentContact(p, 'other', 'ولي أمر');
                if (parentOpts.length > 0 && (p.includes("اب") || p.includes("ام") || p.includes("الاب") || p.includes("الام") || p.includes("الأب") || p.includes("الأم"))) {
                    parentOpts.forEach(parentOpt => {
                        if (!parentsContacts.some(pc => pc.phone === parentOpt.phone)) {
                            parentsContacts.push(parentOpt);
                        }
                    });
                } else {
                    const phoneMatch = p.match(/01[0125]\d{8}/); 
                    const clean = phoneMatch ? phoneMatch[0] : p.trim();
                    if (clean) parsedPhones.push(clean);
                }
            });

            const fatherContacts = parseParentContact(fatherPhoneRaw, 'father', 'أب');
            fatherContacts.forEach(contact => {
                if (!parentsContacts.some(pc => pc.phone === contact.phone)) {
                    parentsContacts.push(contact);
                }
            });

            const motherContacts = parseParentContact(motherPhoneRaw, 'mother', 'أم');
            motherContacts.forEach(contact => {
                if (!parentsContacts.some(pc => pc.phone === contact.phone)) {
                    parentsContacts.push(contact);
                }
            });

            // Sanitize birth date
            const sanitizedBirthDate = sanitizeBirthDate(birthDateRaw, bulkTargetStage);

            let error = '';
            
            // Validate if selected target class is allowed for this role
            const validClassesForStage = STAGE_CLASS_MAP[bulkTargetStage] || [];
            const cleanClass = normalizeArabic(bulkTargetClass);
            const isValidClassForStage = validClassesForStage.map(normalizeArabic).includes(cleanClass);

            if (!isValidClassForStage) {
                error = `الفصل ${bulkTargetClass} غير تابع لمرحلة ${bulkTargetStage}`;
            } else if (!isGeneralAdmin) {
                const cleanAuthorizedClasses = (authorizedClasses || []).map(normalizeArabic);
                const isClassAuthorized = isStageServant || cleanAuthorizedClasses.includes(cleanClass);
                if (!isClassAuthorized) {
                    error = 'الفصل غير مصرح لك بالإضافة إليه';
                }
            }

            parsedList.push({
                name,
                birthDate: sanitizedBirthDate,
                fatherOfConfession: father,
                address,
                phones: parsedPhones,
                parentsContacts,
                schoolGrade: bulkTargetStage,
                assignedClass: bulkTargetClass,
                isValid: !error,
                errorMsg: error
            });
        }

        setBulkStudents(parsedList);
        setMappingStep('preview');
        showToast(`تم استخراج ${parsedList.length} مخدوم بنجاح. برجاء مراجعة البيانات قبل الحفظ.`, 'success');
    };

    const handleConfirmImport = async () => {
        const validStudents = bulkStudents.filter(s => s.isValid);
        if (validStudents.length === 0) {
            showToast('لا يوجد مخدومين صالحين للحفظ ⚠️', 'warning');
            return;
        }

        setIsAdding(true);
        try {
            const metadataRef = doc(db, 'metadata', 'students_keys');
            let successCount = 0;

            await runTransaction(db, async (transaction) => {
                const metaSnap = await transaction.get(metadataRef);
                let metaData = metaSnap.data();
                if (!metaData) {
                    metaData = { usedCodesByStage: {} };
                }
                const usedCodesByStage = metaData.usedCodesByStage || {};

                for (const student of validStudents) {
                    const finalStage = student.schoolGrade;
                    const stageKey = Object.keys(usedCodesByStage).find(k => normalizeArabic(k) === normalizeArabic(finalStage)) || finalStage;
                    if (!usedCodesByStage[stageKey]) {
                        usedCodesByStage[stageKey] = [];
                    }
                    const codesList = usedCodesByStage[stageKey];
                    const sortedCodes = [...codesList].map(Number).filter(Boolean).sort((a, b) => a - b);
                    const baseCode = getBaseCodeForStage(finalStage, Object.keys(usedCodesByStage));
                    
                    let newCodeInt = baseCode;
                    while (sortedCodes.includes(newCodeInt)) {
                        newCodeInt++;
                    }
                    const finalCode = String(newCodeInt);
                    
                    codesList.push(newCodeInt);

                    const newStudentRef = doc(collection(db, 'students'));
                    
                    const mergedAddresses = student.address ? [student.address.trim()] : [];

                    transaction.set(newStudentRef, {
                        name: student.name,
                        code: finalCode,
                        birthDate: student.birthDate,
                        fatherOfConfession: student.fatherOfConfession || '',
                        addresses: mergedAddresses,
                        phones: student.phones || [],
                        parentsContacts: student.parentsContacts || [],
                        schoolGrade: finalStage,
                        assignedClass: student.assignedClass,
                        points: 0,
                        attendance: [],
                        password: finalCode,
                        isPasswordChanged: false,
                        homeVisitations: {},
                        createdAt: new Date(),
                        createdBy: user?.email || 'System',
                        addedViaBulk: true,
                        studentEditedBirthDate: false
                    });

                    successCount++;
                }

                transaction.set(metadataRef, { usedCodesByStage });
            });

            showToast(`تم استيراد وإضافة عدد (${successCount}) مخدوم(ة) بنجاح 🎉`, 'success');
            setBulkStudents([]);
            setAddMode('single');
            setShowAddForm(false);
        } catch (err) {
            console.error("Error importing bulk students:", err);
            showToast('حدث خطأ أثناء حفظ المخدومين جماعياً ❌', 'error');
        } finally {
            setIsAdding(false);
        }
    };







    const addPoints = async (id, amount) => {



        const student = students.find(s => s.id === id);



        if (!student) return;







        const isStudentAttendedToday = student.attendance?.some(dateStr => {



            const d = new Date(dateStr);



            const today = new Date();



            return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();



        });







        if (amount > 0) {



            const message = isStudentAttendedToday



                ? "تنبيه: أنت الآن تضيف مكافأة إضافية (Bonus) لهذا الطالب بجانب صفات الحضور"



                : "تنبيه: هذا المخدوم لم يتم تحضيره، هذه إضافة صفات منفصلة";



            if (!window.confirm(message + "\n\nهل تريد الاستمرار؟")) {



                return;



            }



        }







        try {



            const studentRef = doc(db, 'students', id);



            await updateDoc(studentRef, { points: increment(amount) });



            await addDoc(collection(db, 'pointsHistory'), {



                studentId: id,



                amount: Number(amount),



                points: Number(amount),



                reason: amount > 0 ? 'إضافة عامة من لوحة التحكم' : 'خصم عام من لوحة التحكم',



                createdAt: serverTimestamp()



            });



            showToast(amount > 0 ? 'تم إضافة النقاط بنجاح ✅' : 'تم خصم النقاط بنجاح ✅', 'success');



        } catch (error) {



            console.error("Error updating points:", error);



            showToast('حدث خطأ أثناء تعديل النقاط ❌', 'error');



        }



    };







    const markAttendance = async (id, pointsToAdd = 5) => {



        const student = students.find(s => s.id === id);



        if (!student) return;







        if (new Date().getDay() !== 5) {



            showToast('تسجيل الحضور متاح فقط يوم الجمعة ⚠️', 'warning');



            return;



        }







        const today = new Date();



        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;







        try {



            const studentRef = doc(db, 'students', id);



            const attendanceDocId = `${student.id}_${todayStr}`;



            const attendanceRef = doc(db, 'attendance', attendanceDocId);



            const servantName = servant?.name || 'الخادم العام';







            // 1. Read student document (from cache or network)



            const studentSnap = await getDoc(studentRef);



            if (!studentSnap.exists()) {



                throw new Error('المخدوم غير موجود في قاعدة البيانات');



            }



            const currentStudentData = studentSnap.data();







            // 2. Check duplicate



            const currentAttendance = currentStudentData.attendance || [];



            if (currentAttendance.includes(todayStr)) {



                let existingServantName = 'غير معروف';



                let regTimeStr = 'غير محدد';



                try {



                    const attendanceSnap = await getDoc(attendanceRef);



                    if (attendanceSnap.exists()) {



                        const data = attendanceSnap.data();



                        existingServantName = data.servantName || 'غير معروف';



                        if (data.updatedAt) {



                            const regDate = data.updatedAt.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt);



                            regTimeStr = regDate.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });



                        }



                    }



                } catch (e) {



                    console.log("Could not load attendance details", e);



                }



                throw new Error(`عذراً، الخادم ${existingServantName} قام بتحضير هذا المخدوم بالفعل في تمام الساعة ${regTimeStr}`);



            }







            const batch = writeBatch(db);







            // 3. Write attendance doc



            batch.set(attendanceRef, {



                studentId: student.id,



                date: todayStr,



                stage: currentStudentData.schoolGrade || '',



                class: currentStudentData.assignedClass || '',



                status: 'present',



                servantName: servantName,



                pointsAdded: pointsToAdd,



                updatedAt: new Date()



            }, { merge: true });







            // 4. Update student record



            const safeClassId = currentStudentData.assignedClass ? getSafeClassId(currentStudentData.assignedClass) : '';



            const consecutiveGiftEnabled = !!attendanceConfigs[safeClassId]?.consecutiveGiftEnabled;







            const newAttendance = [...currentAttendance, todayStr];



            const newPoints = (currentStudentData.points || 0) + pointsToAdd;







            const studentUpdates = {



                attendance: newAttendance,



                points: newPoints



            };







            if (consecutiveGiftEnabled) {



                const newStreak = (currentStudentData.attendanceStreak || 0) + 1;



                let newGifts = currentStudentData.pendingGifts || 0;



                if (newStreak > 0 && newStreak % 4 === 0) {



                    newGifts += 1;



                }



                studentUpdates.attendanceStreak = newStreak;



                studentUpdates.pendingGifts = newGifts;



            }







            batch.update(studentRef, studentUpdates);







            // 5. Add pointsHistory document



            const historyRef = doc(collection(db, 'pointsHistory'));



            batch.set(historyRef, {



                studentId: student.id,



                amount: Number(pointsToAdd),



                points: Number(pointsToAdd),



                reason: `حضور يوم الجمعة (${servantName})`,



                createdAt: new Date()



            });







            // Commit batch (works offline)



            await batch.commit();



            // Optimistic local state update so UI reflects changes immediately (even offline)
            setStudents(prev => prev.map(s => {
                if (s.id !== id) return s;
                const updated = {
                    ...s,
                    attendance: newAttendance,
                    points: newPoints
                };
                if (consecutiveGiftEnabled) {
                    updated.attendanceStreak = (s.attendanceStreak || 0) + 1;
                    if (updated.attendanceStreak > 0 && updated.attendanceStreak % 4 === 0) {
                        updated.pendingGifts = (s.pendingGifts || 0) + 1;
                    }
                }
                return updated;
            }));




            showToast('تم تسجيل الحضور وإضافة النقاط بنجاح ✅', 'success');



        } catch (error) {



            console.error("Error marking attendance:", error);



            showToast(error.message || 'حدث خطأ أثناء تسجيل الحضور', 'error');



        }



    };



    const markLiturgy = async (id, isChecked) => {

        const student = students.find(s => s.id === id);

        if (!student) return;



        if (new Date().getDay() !== 5) {

            showToast('تسجيل حضور القداس متاح فقط يوم الجمعة ⚠️', 'warning');

            return;

        }



        const today = new Date();

        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;



        try {

            const studentRef = doc(db, 'students', id);

            const attendanceDocId = `${id}_${todayStr}`;

            const attendanceRef = doc(db, 'attendance', attendanceDocId);

            const servantName = servant?.name || 'الخادم';

            const stage = student.schoolGrade || '';

            const className = student.assignedClass || '';



            const batch = writeBatch(db);



            if (isChecked) {

                batch.update(studentRef, {

                    liturgyAttendance: arrayUnion(todayStr)

                });

                batch.set(attendanceRef, {

                    studentId: id,

                    date: todayStr,

                    stage: stage,

                    class: className,

                    servantName: servantName,

                    attendedLiturgy: true,

                    updatedAt: new Date()

                }, { merge: true });

            } else {

                batch.update(studentRef, {

                    liturgyAttendance: arrayRemove(todayStr)

                });

                batch.set(attendanceRef, {

                    attendedLiturgy: false,

                    updatedAt: new Date()

                }, { merge: true });

            }



            await batch.commit();

            showToast('تم تحديث حضور القداس بنجاح ⛪', 'success');

        } catch (error) {

            console.error("Error marking liturgy attendance:", error);

            showToast('حدث خطأ أثناء تحديث حضور القداس', 'error');

        }

    };







    const removeAttendance = async (id, dateStr) => {



        if (window.confirm("هل أنت متأكد من مسح هذا الحضور؟")) {



            try {



                const student = students.find(s => s.id === id);



                const studentRef = doc(db, 'students', id);



                const safeClassId = student ? getSafeClassId(student.assignedClass) : '';



                const consecutiveGiftEnabled = !!attendanceConfigs[safeClassId]?.consecutiveGiftEnabled;



                



                const currentAttendance = student?.attendance || [];



                const newAttendance = currentAttendance.filter(d => d !== dateStr);



                



                // Get pointsAdded from attendance record before deleting it



                const attendanceDocId = `${id}_${dateStr}`;



                const attendanceRef = doc(db, 'attendance', attendanceDocId);



                const attendanceSnap = await getDoc(attendanceRef);



                let pointsAdded = 0;



                if (attendanceSnap.exists()) {



                    pointsAdded = attendanceSnap.data().pointsAdded || 0;



                }







                const updates = { 



                    attendance: newAttendance,



                    points: Math.max(0, (student?.points || 0) - pointsAdded)



                };



                if (student?.liturgyAttendance) {



                    updates.liturgyAttendance = student.liturgyAttendance.filter(d => d !== dateStr);



                }



                if (consecutiveGiftEnabled) {



                    updates.attendanceStreak = calculateStreak(newAttendance);



                }







                await updateDoc(studentRef, updates);



                await deleteDoc(attendanceRef);







                // Find and delete corresponding pointsHistory document



                const q = query(collection(db, 'pointsHistory'), where('studentId', '==', id));



                const querySnap = await getDocs(q);



                querySnap.forEach(async (docSnap) => {



                    const data = docSnap.data();



                    if (data.reason && data.reason.includes('حضور')) {



                        const createdAtDate = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);



                        const createdAtStr = `${createdAtDate.getFullYear()}-${String(createdAtDate.getMonth() + 1).padStart(2, '0')}-${String(createdAtDate.getDate()).padStart(2, '0')}`;



                        if (createdAtStr === dateStr) {



                            await deleteDoc(docSnap.ref);



                        }



                    }



                });



            } catch (error) {



                console.error("Error removing attendance:", error);



            }



        }



    };







    const claimGift = async (studentId, currentPendingGifts) => {



        if (!window.confirm('هل أنت متأكد من تسليم الهدية للمخدوم؟')) return;



        try {



            const studentRef = doc(db, 'students', studentId);



            await updateDoc(studentRef, { pendingGifts: Math.max(0, currentPendingGifts - 1) });



            alert('تم تسليم الهدية للمخدوم بنجاح 🎁');



        } catch (error) {



            console.error("Error claim gift:", error);



        }



    };







    const handleDeleteStudent = async (id, name) => {



        if (window.confirm(`هل أنت متأكد من حذف المخدوم ${name}؟`)) {



            try {



                const metadataRef = doc(db, 'metadata', 'students_keys');



                const studentRef = doc(db, 'students', id);



                



                await runTransaction(db, async (transaction) => {



                    const studentSnap = await transaction.get(studentRef);



                    const studentData = studentSnap.data();



                    const schoolGrade = studentData.schoolGrade || '';



                    const codeToDelete = Number(studentData.code);



                    



                    const metaSnap = await transaction.get(metadataRef);



                    transaction.delete(studentRef);



                    



                    if (schoolGrade && codeToDelete && metaSnap.exists()) {



                        const metaData = metaSnap.data();



                        const usedCodesByStage = metaData.usedCodesByStage || {};



                        const stageKey = Object.keys(usedCodesByStage).find(k => normalizeArabic(k) === normalizeArabic(schoolGrade)) || schoolGrade;



                        if (usedCodesByStage[stageKey]) {



                            usedCodesByStage[stageKey] = usedCodesByStage[stageKey]



                                .map(Number)



                                .filter(c => c !== codeToDelete)



                                .sort((a, b) => a - b);



                            transaction.update(metadataRef, { usedCodesByStage });



                        }



                    }



                });







                // Delete attendance records for this student



                const attendanceQuery = query(collection(db, 'attendance'), where('studentId', '==', id));



                const attendanceQuerySnap = await getDocs(attendanceQuery);



                for (const docSnap of attendanceQuerySnap.docs) {



                    await deleteDoc(docSnap.ref);



                }







                // Delete points history logs for this student



                const historyQuery = query(collection(db, 'pointsHistory'), where('studentId', '==', id));



                const historyQuerySnap = await getDocs(historyQuery);



                for (const docSnap of historyQuerySnap.docs) {



                    await deleteDoc(docSnap.ref);



                }







                alert('تم حذف المخدوم بنجاح');



            } catch (error) {



                console.error("Deletion failed:", error);



            }



        }



    };







    const resetPassword = async (id, name, code) => {
        if (window.confirm(`تصفير كلمة مرور ${name}؟`)) {
            try {
                const studentDoc = await getDoc(doc(db, 'students', id));
                if (!studentDoc.exists()) {
                    showToast('المخدوم غير موجود ⚠️', 'error');
                    return;
                }
                const currentCode = studentDoc.data().code || code;

                await updateDoc(doc(db, 'students', id), { 
                    password: currentCode, 
                    isPasswordChanged: false,
                    lastPasswordUpdate: serverTimestamp() 
                });
                alert('تم التصفير بنجاح');
            } catch (error) {
                console.error("Error resetting password:", error);
            }
        }
    };







    const filteredStudentsTab1 = students.filter(s => {



        const term = searchTerm.toLowerCase();



        const searchInPhones = (s.phones || []).some(phone => (phone || '').toLowerCase().includes(term));



        const matchesSearch = ((s.name || '').toLowerCase().includes(term) || (s.code || '').toLowerCase().includes(term) || searchInPhones);



        if (!matchesSearch) return false;







        if (selectedStageTab1 !== 'الكل' && s.schoolGrade !== selectedStageTab1) return false;



        if (selectedClassTab1 !== 'الكل' && s.assignedClass !== selectedClassTab1) return false;



        return true;



    });







    const filteredStudentsTab2 = students.filter(s => {



        const term = searchTerm.toLowerCase();



        const searchInPhones = (s.phones || []).some(phone => (phone || '').toLowerCase().includes(term));



        const matchesSearch = ((s.name || '').toLowerCase().includes(term) || (s.code || '').toLowerCase().includes(term) || searchInPhones);



        if (!matchesSearch) return false;







        if (selectedStageTab2 !== 'الكل' && s.schoolGrade !== selectedStageTab2) return false;



        if (selectedClassTab2 !== 'الكل' && s.assignedClass !== selectedClassTab2) return false;



        return true;



    });







    const filteredStudentsPrint = students.filter(s => {



        if (selectedStagePrint !== 'الكل' && s.schoolGrade !== selectedStagePrint) return false;



        if (selectedClassPrint !== 'الكل' && s.assignedClass !== selectedClassPrint) return false;



        return true;



    });







    const sortedStudentsPrint = [...filteredStudentsPrint].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));







    const isAllPrintSelected = sortedStudentsPrint.length > 0 && sortedStudentsPrint.every(s => selectedStudentsPrint.includes(s.id));







    const handleToggleSelectAllPrint = () => {



        if (isAllPrintSelected) {



            const idsToRemove = sortedStudentsPrint.map(s => s.id);



            setSelectedStudentsPrint(prev => prev.filter(id => !idsToRemove.includes(id)));



        } else {



            const idsToAdd = sortedStudentsPrint.map(s => s.id);



            setSelectedStudentsPrint(prev => Array.from(new Set([...prev, ...idsToAdd])));



        }



    };







    const handleToggleSelectStudentPrint = (id) => {



        setSelectedStudentsPrint(prev => 



            prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]



        );



    };







    const renderPrintCardsTab = () => {



        return (



            <div className="space-y-6 animate-in fade-in duration-300">



                <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">



                    <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto flex-grow max-w-5xl">



                        <select



                            value={selectedStagePrint}



                            onChange={e => { setSelectedStagePrint(e.target.value); setSelectedClassPrint('الكل'); setSelectedStudentsPrint([]); }}



                            disabled={isStageServant}



                            className="w-full sm:w-44 p-3 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-300 disabled:opacity-75 disabled:cursor-not-allowed"



                        >



                            <option value="الكل">كل المراحل</option>



                            {Object.keys(STAGE_CLASS_MAP).map(stage => (



                                <option key={stage} value={stage}>{stage}</option>



                            ))}



                        </select>







                        <select



                            value={selectedClassPrint}



                            onChange={e => { setSelectedClassPrint(e.target.value); setSelectedStudentsPrint([]); }}



                            className="w-full sm:w-48 p-3 bg-white dark:bg-[#0f172a] text-slate-850 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-colors duration-300"



                            disabled={selectedStagePrint === 'الكل'}



                        >



                            <option value="الكل">{selectedStagePrint === 'الكل' ? 'كل الفصول' : 'كل فصول المرحلة'}</option>



                            {(STAGE_CLASS_MAP[selectedStagePrint] || []).map(cls => (



                                <option key={cls} value={cls}>{cls}</option>



                            ))}



                        </select>



                    </div>







                    <div className="flex items-center gap-3 whitespace-nowrap">



                        <button



                            type="button"



                            onClick={handleBulkPrint}



                            disabled={selectedStudentsPrint.length === 0}



                            className={`px-5 py-3 font-bold rounded-xl shadow-lg transition-all flex items-center gap-2 border-none cursor-pointer text-white ${



                                selectedStudentsPrint.length > 0



                                    ? 'bg-blue-600 hover:bg-blue-700 hover:shadow-xl active:scale-95'



                                    : 'bg-slate-300 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed shadow-none'



                            }`}



                        >



                            <Printer size={18} />



                            <span>طباعة الكارنيهات المحددة ({selectedStudentsPrint.length})</span>



                        </button>



                    </div>



                </div>







                <div className="overflow-x-auto bg-white dark:bg-[#1e293b] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors duration-300">



                    <table className="w-full text-right border-collapse">



                        <thead>



                            <tr className="bg-slate-100 dark:bg-[#0f172a] text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800">



                                <th className="p-3 w-12 text-center">



                                    <input



                                        type="checkbox"



                                        checked={isAllPrintSelected}



                                        onChange={handleToggleSelectAllPrint}



                                        className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"



                                    />



                                </th>



                                <th className="p-3">كود المخدوم</th>



                                <th className="p-3">اسم المخدوم</th>



                                <th className="p-3">المرحلة</th>



                                <th className="p-3">الفصل</th>



                                <th className="p-3 text-center">حالة الصورة الشخصية</th>



                            </tr>



                        </thead>



                        <tbody>



                            {sortedStudentsPrint.map(student => {



                                const isSelected = selectedStudentsPrint.includes(student.id);



                                return (



                                    <tr key={student.id} className="border-b border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">



                                        <td className="p-4 text-center">



                                            <input



                                                type="checkbox"



                                                checked={isSelected}



                                                onChange={() => handleToggleSelectStudentPrint(student.id)}



                                                className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"



                                            />



                                        </td>



                                        <td className="p-4 font-mono font-bold text-slate-500 dark:text-slate-400">#{student.code}</td>



                                        <td className="p-4 font-bold">



                                            <Link to={`/admin/student/${student.id}`} className="text-blue-500 hover:underline hover:text-blue-600 transition-colors">{student.name}</Link>



                                        </td>



                                        <td className="p-4 font-semibold text-slate-700 dark:text-slate-300">{student.schoolGrade || '—'}</td>



                                        <td className="p-4 font-semibold text-slate-700 dark:text-slate-300">{student.assignedClass || '—'}</td>



                                        <td className="p-4 text-center">



                                            {student.photoUrl ? (



                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-455 border border-emerald-200 dark:border-emerald-800">



                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>



                                                    لديه صورة شخصية ✅



                                                </span>



                                            ) : (



                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">



                                                    بدون صورة 📷



                                                </span>



                                            )}



                                        </td>



                                    </tr>



                                );



                            })}



                            {sortedStudentsPrint.length === 0 && (



                                <tr>



                                    <td colSpan="6" className="p-8 text-center text-slate-450 dark:text-slate-500 font-bold">لا توجد نتائج مطابقة للبحث في نطاق مرحلتك المصرحة</td>



                                </tr>



                            )}



                        </tbody>



                    </table>



                </div>

            </div>

        );

    };

    const renderStagePromotionTab = () => {
        // Filter students belonging to the selected current class
        const filteredStudents = selectedClassPromoteCurrent
            ? students.filter(s => s.assignedClass === selectedClassPromoteCurrent)
            : [];

        // Check if all filtered students are selected
        const isAllSelected = filteredStudents.length > 0 && filteredStudents.every(s => selectedStudentsPromote.includes(s.id));

        const handleToggleSelectAll = () => {
            if (isAllSelected) {
                // Deselect all for this class
                const filteredIds = filteredStudents.map(s => s.id);
                setSelectedStudentsPromote(prev => prev.filter(id => !filteredIds.includes(id)));
            } else {
                // Select all for this class (preserving others if any, though selection is scoped to class)
                const filteredIds = filteredStudents.map(s => s.id);
                setSelectedStudentsPromote(prev => {
                    const union = new Set([...prev, ...filteredIds]);
                    return Array.from(union);
                });
            }
        };

        const handleToggleSelectStudent = (id) => {
            setSelectedStudentsPromote(prev =>
                prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
            );
        };

        const handlePromote = async () => {
            if (selectedStudentsPromote.length === 0) {
                showToast('برجاء تحديد مخدوم واحد على الأقل للترقية ⚠️', 'warning');
                return;
            }
            if (!selectedClassPromoteNew) {
                showToast('برجاء تحديد الفصل الجديد المستهدف 🎯', 'warning');
                return;
            }
            if (selectedClassPromoteCurrent === selectedClassPromoteNew) {
                showToast('لا يمكن الترقية لنفس الفصل الحالي ⚠️', 'warning');
                return;
            }

            // Find new stage
            const newStage = Object.keys(STAGE_CLASS_MAP).find(stage => 
                STAGE_CLASS_MAP[stage].includes(selectedClassPromoteNew)
            ) || "";

            const count = selectedStudentsPromote.length;
            const confirmMsg = `تأكيد نقل وتصعيد المخدومين:
--------------------------------
• الفصل الحالي: ${selectedClassPromoteCurrent}
• الفصل الجديد: ${selectedClassPromoteNew}
• المرحلة الجديدة: ${newStage || 'غير محددة'}
• عدد المخدومين: ${count} مخدوم(ة)

هل أنت متأكد من إتمام عملية النقل والتصعيد لجميع المخدومين المحددين؟`;

            if (window.confirm(confirmMsg)) {
                try {
                    await runTransaction(db, async (transaction) => {
                        const metadataRef = doc(db, 'metadata', 'students_keys');
                        const metaSnap = await transaction.get(metadataRef);
                        let metaData = metaSnap.data() || { usedCodesByStage: {} };
                        const usedCodesByStage = metaData.usedCodesByStage || {};

                        for (const id of selectedStudentsPromote) {
                            const studentRef = doc(db, 'students', id);
                            const studentSnap = await transaction.get(studentRef);
                            if (!studentSnap.exists()) continue;
                            const studentData = studentSnap.data();

                            const oldStage = studentData.schoolGrade;
                            const oldCode = studentData.code;

                            const isStageChanged = normalizeArabic(oldStage) !== normalizeArabic(newStage);

                            let finalCode = oldCode;

                            if (isStageChanged) {
                                // A. Generate new code in newStage
                                const stageKeyNew = Object.keys(usedCodesByStage).find(k => normalizeArabic(k) === normalizeArabic(newStage)) || newStage;
                                if (!usedCodesByStage[stageKeyNew]) {
                                    usedCodesByStage[stageKeyNew] = [];
                                }
                                const codesListNew = usedCodesByStage[stageKeyNew];
                                const sortedCodesNew = [...codesListNew].map(Number).filter(Boolean).sort((a, b) => a - b);
                                const baseCodeNew = getBaseCodeForStage(newStage, Object.keys(usedCodesByStage));
                                
                                let newCodeInt = baseCodeNew;
                                while (sortedCodesNew.includes(newCodeInt)) {
                                    newCodeInt++;
                                }
                                finalCode = String(newCodeInt);
                                codesListNew.push(newCodeInt);

                                // B. Free up old code in oldStage
                                if (oldCode && oldStage) {
                                    const stageKeyOld = Object.keys(usedCodesByStage).find(k => normalizeArabic(k) === normalizeArabic(oldStage));
                                    if (stageKeyOld && usedCodesByStage[stageKeyOld]) {
                                        const oldCodeInt = Number(oldCode);
                                        usedCodesByStage[stageKeyOld] = usedCodesByStage[stageKeyOld].filter(c => Number(c) !== oldCodeInt);
                                    }
                                }
                            }

                            // C. Update student document (do NOT touch password)
                            transaction.update(studentRef, {
                                assignedClass: selectedClassPromoteNew,
                                schoolGrade: newStage,
                                code: finalCode,
                                updatedAt: new Date()
                            });
                        }

                        // Save updated metadata
                        transaction.set(metadataRef, { usedCodesByStage });
                    });

                    showToast(`تم تصعيد ونقل عدد (${count}) مخدوم(ة) بنجاح 🎉`, 'success');
                    setSelectedStudentsPromote([]);
                } catch (err) {
                    console.error("Error promoting students:", err);
                    showToast('حدث خطأ أثناء عملية النقل الجماعي ❌', 'error');
                }
            }
        };

        const handleDelete = async () => {
            if (selectedStudentsPromote.length === 0) {
                showToast('برجاء تحديد مخدوم واحد على الأقل للحذف ⚠️', 'warning');
                return;
            }

            const count = selectedStudentsPromote.length;
            const confirmMsg = `⚠️⚠️⚠️ تحذير أمني شديد الخطورة ⚠️⚠️⚠️
--------------------------------
أنت على وشك حذف عدد (${count}) مخدوم(ة) نهائياً من النظام!
هذا الإجراء مخصص فقط للمخدومين المتخرجين (مثل الصف الثالث الثانوي) الذين ترغب في إزالتهم تماماً.

• لن تتمكن من استرجاع بيانات هؤلاء المخدومين أو سجلات حضورهم ونقاطهم بعد الحذف.
• هل أنت متأكد تماماً وبشكل قاطع من حذفهم نهائياً؟`;

            if (window.confirm(confirmMsg)) {
                try {
                    const batch = writeBatch(db);
                    selectedStudentsPromote.forEach(id => {
                        const studentRef = doc(db, 'students', id);
                        batch.delete(studentRef);
                    });
                    await batch.commit();
                    showToast(`تم حذف عدد (${count}) مخدوم(ة) بنجاح من النظام 🗑️`, 'success');
                    setSelectedStudentsPromote([]);
                } catch (err) {
                    console.error("Error deleting students:", err);
                    showToast('حدث خطأ أثناء عملية الحذف الجماعي ❌', 'error');
                }
            }
        };

        return (
            <div className="space-y-6 animate-in fade-in duration-300">
                {/* Header section with instructions */}
                <div className="bg-gradient-to-l from-blue-500/10 via-indigo-500/5 to-transparent border border-blue-500/20 rounded-3xl p-6 transition-all duration-300">
                    <h2 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2 mb-2">
                         إدارة المراحل وتصعيد المخدومين 🚀
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed font-semibold">
                         تتيح لك هذه الأداة ترقية أو تصعيد المخدومين بشكل جماعي من فصل إلى آخر عند بدء العام الدراسي الجديد. كما تتيح إمكانية الحذف النهائي الجماعي للمخدومين المتخرجين من مرحلة الثانوي بالكامل للحفاظ على نظافة قاعدة البيانات.
                    </p>
                </div>

                {/* Dropdowns and Action Controls Panel */}
                <div className="bg-white dark:bg-[#1e293b] p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Current Class Selection */}
                        <div className="space-y-2">
                            <label className="block text-s font-black text-slate-700 dark:text-slate-300">
                                اختر الفصل الحالي (مصدر الطلاب) 🏫
                            </label>
                            <select
                                value={selectedClassPromoteCurrent}
                                onChange={e => {
                                    setSelectedClassPromoteCurrent(e.target.value);
                                    setSelectedStudentsPromote([]); // Reset selection when changing source class
                                }}
                                className="w-full p-3 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                            >
                                <option value="" className="text-slate-800 dark:text-white bg-white dark:bg-[#0f172a]">-- اختر الفصل الحالي --</option>
                                {Object.entries(STAGE_CLASS_MAP).map(([stage, classes]) => (
                                    <optgroup key={stage} label={stage} className="bg-white dark:bg-[#0f172a] font-bold text-blue-600 dark:text-blue-400">
                                        {classes.map(cls => (
                                            <option key={cls} value={cls} className="text-slate-800 dark:text-white bg-white dark:bg-[#0f172a]">
                                                {cls}
                                            </option>
                                        ))}
                                    </optgroup>
                                ))}
                            </select>
                        </div>

                        {/* New Class Target Selection */}
                        <div className="space-y-2">
                            <label className="block text-s font-black text-slate-700 dark:text-slate-300">
                                اختر الفصل الجديد (الوجهة المستهدفة) 🎯
                            </label>
                            <select
                                value={selectedClassPromoteNew}
                                onChange={e => setSelectedClassPromoteNew(e.target.value)}
                                className="w-full p-3 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                            >
                                <option value="" className="text-slate-800 dark:text-white bg-white dark:bg-[#0f172a]">-- اختر الفصل الجديد --</option>
                                {Object.entries(STAGE_CLASS_MAP).map(([stage, classes]) => (
                                    <optgroup key={stage} label={stage} className="bg-white dark:bg-[#0f172a] font-bold text-blue-600 dark:text-blue-400">
                                        {classes.map(cls => (
                                            <option key={cls} value={cls} className="text-slate-800 dark:text-white bg-white dark:bg-[#0f172a]">
                                                {cls}
                                            </option>
                                        ))}
                                    </optgroup>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Batch Actions Buttons Row */}
                    <div className="flex flex-wrap items-center gap-3 pt-2">
                        <button
                            type="button"
                            onClick={handlePromote}
                            disabled={!selectedClassPromoteCurrent || !selectedClassPromoteNew || selectedStudentsPromote.length === 0}
                            className={`flex items-center gap-2 px-6 py-3 font-black rounded-xl shadow-md transition-all border-none cursor-pointer text-white ${
                                selectedClassPromoteCurrent && selectedClassPromoteNew && selectedStudentsPromote.length > 0
                                    ? 'bg-gradient-to-l from-blue-600 to-indigo-500 hover:from-blue-700 hover:to-indigo-600 active:scale-95 hover:shadow-lg'
                                    : 'bg-slate-300 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed shadow-none'
                            }`}
                        >
                            <ArrowLeftRight size={18} />
                            <span>نقل وتصعيد ({selectedStudentsPromote.length}) مخدوم</span>
                        </button>

                        <button
                            type="button"
                            onClick={handleDelete}
                            disabled={!selectedClassPromoteCurrent || selectedStudentsPromote.length === 0}
                            className={`flex items-center gap-2 px-6 py-3 font-black rounded-xl shadow-md transition-all border-none cursor-pointer text-white ${
                                selectedClassPromoteCurrent && selectedStudentsPromote.length > 0
                                    ? 'bg-red-500 hover:bg-red-600 active:scale-95 hover:shadow-lg'
                                    : 'bg-slate-300 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed shadow-none'
                            }`}
                        >
                            <Trash2 size={18} />
                            <span>حذف المحددين من السيستم ({selectedStudentsPromote.length}) 🗑️</span>
                        </button>
                    </div>
                </div>

                {/* Table displaying student lists */}
                {selectedClassPromoteCurrent ? (
                    <div className="overflow-x-auto bg-white dark:bg-[#1e293b] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors duration-300">
                        <table className="w-full text-right border-collapse">
                            <thead>
                                <tr className="bg-slate-100 dark:bg-[#0f172a] text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800">
                                    <th className="p-4 w-14 text-center">
                                        <input
                                            type="checkbox"
                                            checked={isAllSelected}
                                            onChange={handleToggleSelectAll}
                                            className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
                                        />
                                    </th>
                                    <th className="p-4">كود المخدوم</th>
                                    <th className="p-4">الاسم</th>
                                    <th className="p-4">المرحلة</th>
                                    <th className="p-4">الفصل</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredStudents.map(student => {
                                    const isSelected = selectedStudentsPromote.includes(student.id);
                                    return (
                                        <tr key={student.id} className="border-b border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-250 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                            <td className="p-4 text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => handleToggleSelectStudent(student.id)}
                                                    className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
                                                />
                                            </td>
                                            <td className="p-4 font-mono font-bold text-slate-500 dark:text-slate-400">
                                                #{student.code}
                                            </td>
                                            <td className="p-4 font-bold">
                                                <Link to={`/admin/student/${student.id}`} className="text-blue-500 hover:underline hover:text-blue-600 transition-colors">
                                                    {student.name}
                                                </Link>
                                            </td>
                                            <td className="p-4 font-semibold text-slate-755 dark:text-slate-300">
                                                {student.schoolGrade || '—'}
                                            </td>
                                            <td className="p-4 font-semibold text-slate-755 dark:text-slate-300">
                                                {student.assignedClass || '—'}
                                            </td>
                                        </tr>
                                    );
                                })}

                                {filteredStudents.length === 0 && (
                                    <tr>
                                        <td colSpan="5" className="p-10 text-center text-slate-450 dark:text-slate-500 font-bold">
                                            ⚠️ لا يوجد أي مخدومين مسجلين في هذا الفصل حالياً.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="bg-slate-50 dark:bg-[#0f172a]/40 rounded-2xl border border-dashed border-slate-250 dark:border-slate-800 p-12 text-center text-slate-450 dark:text-slate-500 font-bold space-y-2">
                        <div className="text-3xl">🏫</div>
                        <p>برجاء تحديد "الفصل الحالي" من القائمة المنسدلة بالأعلى لعرض قائمة المخدومين والبدء في تصعيدهم أو حذفهم.</p>
                    </div>
                )}
            </div>
        );
    };







    if (loading) {



        return (



            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">



                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>



                <p className="text-lg font-medium text-gray-600 dark:text-slate-400">جاري التحميل...</p>



            </div>



        );



    }







    if (!user) return <Navigate to="/admin/login" replace />;
    if (activeTab === 'notifications') {
        return (
            <div className="max-w-6xl mx-auto px-4 py-8 min-h-[75vh]" dir="rtl">
                <NotificationSettings />
            </div>
        );
    }








    return (



         <div className="max-w-6xl mx-auto px-4 py-8 min-h-[75vh]" dir="rtl">



            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">



                <div>



                    <div className="flex flex-wrap items-center gap-3">



                        <h1 className="text-3xl font-bold text-slate-900 dark:text-white transition-colors duration-300">



                            {activeTab === 'master_console' ? (isStageServant ? `لوحة تحكم مرحلة ${myStage}` : 'الرئيسه') : (activeTab === 'bonus' ? 'ادارة المخدومين' : 'إدارة المخدومين')}



                        </h1>



                        {isOnline ? (



                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-sm">



                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>



                                متصل 🟢



                            </span>



                        ) : (



                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shadow-sm animate-pulse">



                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>



                                أوفلاين (سيتم المزامنة لاحقاً) 🟡



                            </span>



                        )}



                    </div>



                    {activeTab === 'master_console' && !isStageServant && (
                        <p className="text-slate-500 dark:text-slate-400 transition-colors duration-300 mt-2">
                           وَأَنَا أَشْكُرُ الْمَسِيحَ يَسُوعَ رَبَّنَا الَّذِي قَوَّانِي، أَنَّهُ حَسِبَنِي أَمِينًا، إِذْ جَعَلَنِي لِلْخِدْمَةِ (1 تي 1: 12).
﻿
                        </p>
                    )}

                    <p className="text-slate-500 dark:text-slate-400 transition-colors duration-300">



                        {activeTab === 'master_console' 
                            ? 'متابعة الإحصائيات الفورية والوصول السريع لكل المراحل' 
                            : activeTab === 'attendance'
                            ? 'تسجيل حضور الخدمة والقداس وإضافة الصفات'
                            : activeTab === 'bonus'
                            ? 'إضافة نقاط بونص ومكافآت للمخدومين'
                            : activeTab === 'directory'
                            ? 'كشف بيانات المخدومين وطباعته'
                            : activeTab === 'print_cards'
                            ? 'طباعة كرنيهات المخدومين وتصديرها'
                            : activeTab === 'stage_promotion'
                            ? 'ترقية وتصعيد المخدومين بين المراحل والفصول أو حذفهم دفعة واحدة'
                            : 'إدارة مخدومين مدرسة الأحد'}
                        



                    </p>



                </div>



                {activeTab === 'attendance' && (



                    <Link 



                        to="/admin/scanner"



                        className="flex items-center gap-2 bg-gradient-to-l from-blue-600 to-teal-500 hover:from-blue-700 hover:to-teal-600 text-white px-5 py-3 rounded-2xl font-black text-sm shadow-md hover:shadow-lg transition-all active:scale-95 cursor-pointer shrink-0"



                    >



                        <Camera size={18} />



                        <span>تحضير سريع بالـ QR 📸</span>



                    </Link>



                )}



            </header>







            {activeTab !== 'master_console' && (



                <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-2xl mb-8 gap-1 w-full max-w-xl border border-slate-200/50 dark:border-slate-800">



                    <button



                        onClick={() => setSearchParams({ tab: 'attendance' })}



                        className={`flex-1 py-3 px-2 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${activeTab === 'attendance' ? 'bg-white dark:bg-[#1e293b] text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}



                    >



                        تسجيل الحضور



                    </button>



                    <button



                        onClick={() => setSearchParams({ tab: 'bonus' })}



                        className={`flex-1 py-3 px-2 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${activeTab === 'bonus' ? 'bg-white dark:bg-[#1e293b] text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}



                    >



                        بونص



                    </button>



                    <button



                        onClick={() => setSearchParams({ tab: 'directory' })}



                        className={`flex-1 py-3 px-2 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${activeTab === 'directory' ? 'bg-white dark:bg-[#1e293b] text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}



                    >



                        كشوف المخدومين



                    </button>



                    <button

                        onClick={() => setSearchParams({ tab: 'print_cards' })}

                        className={`flex-1 py-3 px-2 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${activeTab === 'print_cards' ? 'bg-white dark:bg-[#1e293b] text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}

                    >

                        طباعة الكارنيهات 💳

                    </button>

                    {isGeneralAdmin && (
                        <button
                            onClick={() => setSearchParams({ tab: 'stage_promotion' })}
                            className={`flex-1 py-3 px-2 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${activeTab === 'stage_promotion' ? 'bg-white dark:bg-[#1e293b] text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        >
                            ترقية المراحل 🚀
                        </button>
                    )}



                    



                </div>



            )}







            {activeTab === 'notifications' && (
                <NotificationSettings />
            )}


            {activeTab === 'master_console' && (isGeneralAdmin || isStageServant) && (



                <MasterAdminConsole 



                    studentsList={mappedStudentsList} 



                    servantsList={servants} 



                    attendanceRecords={attendanceRecords} 



                    visitationRecords={visitationRecords} 



                />



            )}







            {activeTab === 'attendance' && (



                <>



                    <div className="relative mb-8">



                        <input



                            type="text"



                            placeholder="بحث بالاسم أو الكود..."



                            value={searchTerm}



                            onChange={(e) => setSearchTerm(e.target.value)}



                            className="w-full p-4 pr-12 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold transition-colors duration-300"



                        />



                        <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-505" />



                    </div>







                    <div className="flex flex-col sm:flex-row gap-3 mb-8 items-center bg-white dark:bg-[#1e293b] p-4 rounded-xl border border-slate-200 dark:border-slate-800 transition-colors duration-300">



                        <span className="font-bold text-slate-655 dark:text-slate-400">تصفية حسب:</span>



                        <div className="flex gap-3 flex-wrap flex-1">



                            <select



                                value={selectedStageTab1}



                                onChange={e => { setSelectedStageTab1(e.target.value); setSelectedClassTab1('الكل'); }}



                                disabled={isStageServant}



                                className="w-full sm:w-44 p-3 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-300 disabled:opacity-75 disabled:cursor-not-allowed"



                            >



                                <option value="الكل">كل المراحل</option>



                                {Object.keys(STAGE_CLASS_MAP).map(stage => (



                                    <option key={stage} value={stage}>{stage}</option>



                                ))}



                            </select>







                            <select



                                value={selectedClassTab1}



                                onChange={e => setSelectedClassTab1(e.target.value)}



                                className="w-full sm:w-48 p-3 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-colors duration-300"



                                disabled={selectedStageTab1 === 'الكل'}



                            >



                                <option value="الكل">{selectedStageTab1 === 'الكل' ? 'كل الفصول' : 'كل فصول المرحلة'}</option>



                                {(STAGE_CLASS_MAP[selectedStageTab1] || []).map(cls => (



                                    <option key={cls} value={cls}>{cls}</option>



                                ))}



                            </select>



                        </div>



                    </div>







                    {studentsLoading ? (



                        <div className="py-20 text-center space-y-4">



                            <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mx-auto"></div>



                            <p className="text-xl font-bold text-slate-400 dark:text-slate-505">جاري تحميل قائمة المخدومين...</p>



                        </div>



                    ) : (



                        <div className="space-y-6">



                            {filteredStudentsTab1.map(student => {



                                const safeClassId = getSafeClassId(student.assignedClass);



                                const consecutiveGiftEnabled = !!attendanceConfigs[safeClassId]?.consecutiveGiftEnabled;



                                return (



                                    <StudentRow 



                                        key={student.id} 



                                        student={student} 



                                        addPoints={addPoints} 



                                        markAttendance={markAttendance}

                                        markLiturgy={markLiturgy} 



                                        deleteStudent={handleDeleteStudent}



                                        openAttendanceModal={setAttendanceModalStudentId}



                                        resetPassword={resetPassword}



                                        shortcuts={getShortcutsForClass(student.assignedClass)}



                                        addShortcut={(val) => addShortcutForClass(student.assignedClass, val)}



                                        removeShortcut={(val) => removeShortcutForClass(student.assignedClass, val)}



                                        consecutiveGiftEnabled={consecutiveGiftEnabled}



                                        claimGift={claimGift}



                                        isBonus={false}



                                        storeVisible={isStoreVisibleForStudent(student, storeConfigs)}



                                    />



                                );



                            })}



                            {filteredStudentsTab1.length === 0 && (



                                <div className="py-20 text-center bg-white dark:bg-[#1e293b] rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-800 transition-colors duration-300">



                                    <Search size={64} className="mx-auto text-slate-200 dark:text-slate-700 mb-4" />



                                    <p className="text-xl font-bold text-slate-400 dark:text-slate-500">لا يوجد مخدومين بهذا الاسم أو الكود في نطاقك</p>



                                </div>



                            )}



                        </div>



                    )}



                </>



            )}







            {activeTab === 'bonus' && (



                <>



                    <div className="relative mb-8">



                        <input



                            type="text"



                            placeholder="بحث بالاسم أو الكود..."



                            value={searchTerm}



                            onChange={(e) => setSearchTerm(e.target.value)}



                            className="w-full p-4 pr-12 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold transition-colors duration-300"



                        />



                        <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-555" />



                    </div>







                    <div className="flex flex-col sm:flex-row gap-3 mb-8 items-center bg-white dark:bg-[#1e293b] p-4 rounded-xl border border-slate-200 dark:border-slate-800 transition-colors duration-300">



                        <span className="font-bold text-slate-655 dark:text-slate-400">تصفية حسب:</span>



                        <div className="flex gap-3 flex-wrap flex-1">



                            <select



                                value={selectedStageTab1}



                                onChange={e => { setSelectedStageTab1(e.target.value); setSelectedClassTab1('الكل'); }}



                                disabled={isStageServant}



                                className="w-full sm:w-44 p-3 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-300 disabled:opacity-75 disabled:cursor-not-allowed"



                            >



                                <option value="الكل">كل المراحل</option>



                                {Object.keys(STAGE_CLASS_MAP).map(stage => (



                                    <option key={stage} value={stage}>{stage}</option>



                                ))}



                            </select>







                            <select



                                value={selectedClassTab1}



                                onChange={e => setSelectedClassTab1(e.target.value)}



                                className="w-full sm:w-48 p-3 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-colors duration-300"



                                disabled={selectedStageTab1 === 'الكل'}



                            >



                                <option value="الكل">{selectedStageTab1 === 'الكل' ? 'كل الفصول' : 'كل فصول المرحلة'}</option>



                                {(STAGE_CLASS_MAP[selectedStageTab1] || []).map(cls => (



                                    <option key={cls} value={cls}>{cls}</option>



                                ))}



                            </select>



                        </div>



                    </div>







                    {studentsLoading ? (



                        <div className="py-20 text-center space-y-4">



                            <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mx-auto"></div>



                            <p className="text-xl font-bold text-slate-400 dark:text-slate-555">جاري تحميل قائمة المخدومين...</p>



                        </div>



                    ) : (



                        <div className="space-y-6">



                            {filteredStudentsTab1.map(student => {



                                const safeClassId = getSafeClassId(student.assignedClass);



                                const consecutiveGiftEnabled = !!attendanceConfigs[safeClassId]?.consecutiveGiftEnabled;



                                return (



                                    <StudentRow 



                                        key={student.id} 



                                        student={student} 



                                        addPoints={addPoints} 



                                        markAttendance={markAttendance}

                                        markLiturgy={markLiturgy} 



                                        deleteStudent={handleDeleteStudent}



                                        openAttendanceModal={setAttendanceModalStudentId}



                                        resetPassword={resetPassword}



                                        shortcuts={getShortcutsForClass(student.assignedClass)}



                                        addShortcut={(val) => addShortcutForClass(student.assignedClass, val)}



                                        removeShortcut={(val) => removeShortcutForClass(student.assignedClass, val)}



                                        consecutiveGiftEnabled={consecutiveGiftEnabled}



                                        claimGift={claimGift}



                                        isBonus={true}



                                        storeVisible={isStoreVisibleForStudent(student, storeConfigs)}



                                    />



                                );



                            })}



                            {filteredStudentsTab1.length === 0 && (



                                <div className="py-20 text-center bg-white dark:bg-[#1e293b] rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-800 transition-colors duration-300">



                                    <Search size={64} className="mx-auto text-slate-200 dark:text-slate-700 mb-4" />



                                    <p className="text-xl font-bold text-slate-400 dark:text-slate-500">لا يوجد مخدومين بهذا الاسم أو الكود في نطاقك</p>



                                </div>



                            )}



                        </div>



                    )}



                </>



            )}







            {activeTab === 'directory' && (



                <div className="space-y-6 animate-in fade-in duration-300">



                    <div className="flex flex-col lg:flex-row gap-4 items-center justify-between print:hidden">



                        <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto flex-grow max-w-5xl">



                            <div className="relative w-full max-w-md">



                                <input



                                    type="text"



                                    placeholder="ابحث عن مخدوم بالاسم أو الكود..."



                                    value={searchTerm}



                                    onChange={(e) => setSearchTerm(e.target.value)}



                                    className="w-full p-3 bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold transition-colors duration-300"



                                  />



                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-555" />



                            </div>







                            <select



                                value={selectedStageTab2}



                                onChange={e => { setSelectedStageTab2(e.target.value); setSelectedClassTab2('الكل'); }}



                                disabled={isStageServant}



                                className="w-full sm:w-44 p-3 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-300 disabled:opacity-75 disabled:cursor-not-allowed"



                            >



                                <option value="الكل">كل المراحل</option>



                                {Object.keys(STAGE_CLASS_MAP).map(stage => (



                                    <option key={stage} value={stage}>{stage}</option>



                                ))}



                            </select>







                            <select



                                value={selectedClassTab2}



                                onChange={e => setSelectedClassTab2(e.target.value)}



                                className="w-full sm:w-48 p-3 bg-white dark:bg-[#0f172a] text-slate-850 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-colors duration-300"



                                disabled={selectedStageTab2 === 'الكل'}



                            >



                                <option value="الكل">{selectedStageTab2 === 'الكل' ? 'كل الفصول' : 'كل فصول المرحلة'}</option>



                                {(STAGE_CLASS_MAP[selectedStageTab2] || []).map(cls => (



                                    <option key={cls} value={cls}>{cls}</option>



                                ))}



                            </select>







                            <button 



                                onClick={() => setShowAddForm(!showAddForm)} 



                                className={`px-5 py-3 font-bold rounded-xl shadow-lg transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${showAddForm ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-lg' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg'}`}



                            >



                                <UserPlus size={20} />



                                <span>{showAddForm ? 'إلغاء الإضافة' : 'إضافة مخدوم جديد'}</span>



                            </button>



                        </div>



                        <div className="flex items-center gap-3 whitespace-nowrap">
                            {filteredStudentsTab2.length > 0 && (
                                <button 
                                    type="button"
                                    onClick={() => exportStudentsToExcel(filteredStudentsTab2, selectedClassTab2)}
                                    className="px-4 py-2.5 bg-emerald-600 dark:bg-emerald-700 hover:bg-emerald-500 text-white font-bold rounded-xl shadow transition-all flex items-center gap-2 cursor-pointer border-none"
                                    title="تصدير كشف المخدومين لإكسيل"
                                >
                                    <FileSpreadsheet size={18} />
                                    <span>تصدير لإكسيل</span>
                                </button>
                            )}

                            <button 
                                type="button"
                                onClick={() => window.print()}
                                className="px-4 py-2.5 bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 text-white font-bold rounded-xl shadow transition-all flex items-center gap-2 cursor-pointer border-none"
                            >
                                <Printer size={18} />
                                <span>طباعة الكشف</span>
                            </button>

                            <span className="text-sm font-bold text-slate-500 dark:text-slate-400">
                                إجمالي: {filteredStudentsTab2.length} مخدوم
                            </span>
                        </div>



                    </div>







                    {/* Print Header */}



                    <div className="hidden print:flex mb-6 border-b-2 border-slate-800 dark:border-slate-700 pb-3 justify-between items-center w-full">



                        <div>



                            <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 leading-normal">



                                كشف المخدومين - مدرسة الأحد



                            </h2>



                            <p className="text-sm font-bold text-slate-655 dark:text-slate-400">



                                {selectedStageTab2 !== 'الكل' && `المرحلة: ${selectedStageTab2}`} 



                                {selectedClassTab2 !== 'الكل' && ` - الفصل: ${selectedClassTab2}`}



                            </p>



                        </div>



                        <div className="text-left">



                            <div className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">العدد الإجمالي</div>



                            <div className="text-xl font-black text-slate-800 dark:text-slate-200">{filteredStudentsTab2.length} مخدوم</div>



                        </div>



                    </div>







                    {showAddForm && (
                        <div className="bg-white dark:bg-[#1e293b] p-6 rounded-xl border border-slate-200 dark:border-slate-800 mb-8 transition-colors duration-300">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
                                <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">إضافة مخدوم جديد</h2>
                                
                                <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl gap-1 border border-slate-200/50 dark:border-slate-800">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setAddMode('single');
                                            setBulkStudents([]);
                                        }}
                                        className={`py-2 px-4 rounded-lg font-bold text-xs transition-all cursor-pointer ${addMode === 'single' ? 'bg-white dark:bg-[#1e293b] text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
                                    >
                                        إضافة فردية
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setAddMode('bulk')}
                                        className={`py-2 px-4 rounded-lg font-bold text-xs transition-all cursor-pointer ${addMode === 'bulk' ? 'bg-white dark:bg-[#1e293b] text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
                                    >
                                        إضافة دفعة واحدة 📊
                                    </button>
                                </div>
                            </div>

                            {addMode === 'single' ? (
                                <form onSubmit={handleAddStudent}>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">



                                <div className="md:col-span-2">



                                    <label className="block text-sm font-bold text-slate-655 dark:text-slate-400 mb-2">الاسم</label>



                                    <input className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-900 dark:text-slate-100 transition-colors duration-300" value={newStudent.name} onChange={e => setNewStudent({ ...newStudent, name: e.target.value })} required />



                                </div>



                                <div className="md:col-span-1">



                                    <label className="block text-sm font-bold text-slate-655 dark:text-slate-400 mb-2">المرحلة الدراسية</label>



                                    <select



                                        className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-900 dark:text-slate-100 transition-colors duration-300 disabled:opacity-75 disabled:cursor-not-allowed"



                                        value={newStudent.schoolGrade}



                                        onChange={e => handleStageChange(e.target.value)}



                                        disabled={!isGeneralAdmin}



                                        required



                                    >



                                        <option value="">اختر المرحلة</option>



                                        <option value="ابتدائي">ابتدائي</option>



                                        <option value="اعدادي">اعدادي</option>



                                        <option value="ثانوي">ثانوي</option>



                                    </select>



                                </div>



                                <div className="md:col-span-1">



                                    <label className="block text-sm font-bold text-slate-650 dark:text-slate-400 mb-2">الكود (تلقائي)</label>



                                    <input dir="ltr" className="w-full p-3 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-slate-400 dark:text-slate-505 cursor-not-allowed text-left" value={newStudent.code} disabled={true} required />



                                </div>



                                <div className="md:col-span-1">



                                    <label className="block text-sm font-bold text-slate-655 dark:text-slate-400 mb-2">كلمة المرور (تلقائي)</label>



                                    <input dir="ltr" className="w-full p-3 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-slate-400 dark:text-slate-555 cursor-not-allowed text-left" value={newStudent.password} disabled={true} required />



                                </div>



                                <div className="md:col-span-1">



                                    <label className="block text-sm font-bold text-slate-655 dark:text-slate-400 mb-2">الفصل (للتوزيع)</label>



                                    <select



                                        className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-900 dark:text-slate-100 transition-colors duration-300 disabled:opacity-50"



                                        value={newStudent.assignedClass}



                                        onChange={e => setNewStudent({ ...newStudent, assignedClass: e.target.value })}



                                        disabled={!newStudent.schoolGrade || (!isGeneralAdmin && (authorizedClasses || []).length <= 1)}



                                        required



                                    >



                                        {!newStudent.schoolGrade



                                            ? <option value="" disabled>اختر المرحلة الدراسية أولاً</option>



                                            : (



                                                !isGeneralAdmin ? (



                                                    <>



                                                        {/* Enforce total isolation: only map over the user's specific authorized classes */}



                                                        {(authorizedClasses || []).map(cls => (



                                                            <option key={cls} value={cls}>{cls}</option>



                                                        ))}



                                                    </>



                                                ) : (



                                                    <>



                                                        {/* Global General Admins only can view the full mapping array */}



                                                        <option value="">اختر الفصل</option>



                                                        {(STAGE_CLASS_MAP[newStudent.schoolGrade] || []).map(cls => (



                                                            <option key={cls} value={cls}>{cls}</option>



                                                        ))}



                                                    </>



                                                )



                                            )



                                        }



                                    </select>



                                </div>



                                <div className="md:col-span-2 space-y-4">



                                    <label className="block text-sm font-bold text-slate-655 dark:text-slate-400">أرقام التليفون</label>



                                    {newStudent.phones.map((phone, idx) => (



                                        <div key={idx} className="flex gap-2 animate-in slide-in-from-right-2 duration-200">



                                            <input className="flex-1 p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-900 dark:text-slate-100 transition-colors duration-300" value={phone} onChange={e => {



                                                const newPhones = [...newStudent.phones];



                                                newPhones[idx] = e.target.value;



                                                setNewStudent({ ...newStudent, phones: newPhones });



                                            }} placeholder="012XXXXXXXX" />



                                            {idx === newStudent.phones.length - 1 ? (
                                                <button type="button" onClick={() => setNewStudent({ ...newStudent, phones: [...newStudent.phones, ''] })} className="p-3 bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-lg"><Plus size={20} /></button>
                                            ) : (
                                                <button type="button" onClick={() => {
                                                    const newPhones = newStudent.phones.filter((_, i) => i !== idx);
                                                    setNewStudent({ ...newStudent, phones: newPhones });
                                                }} className="p-3 bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-lg"><X size={20} /></button>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* Parents Contacts Form Section */}
                                <div className="md:col-span-2 space-y-4">
                                    <div className="flex justify-between items-center">
                                        <label className="block text-sm font-bold text-slate-655 dark:text-slate-400">أرقام أولياء الأمور (Parents Contacts)</label>
                                        <button 
                                            type="button" 
                                            onClick={() => setNewStudent({ 
                                                ...newStudent, 
                                                parentsContacts: [...(newStudent.parentsContacts || []), { name: '', phone: '', relation: 'father' }] 
                                            })} 
                                            className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 font-bold px-3 py-1.5 rounded-lg border-none cursor-pointer flex items-center gap-1"
                                        >
                                            <Plus size={14} />
                                            <span>إضافة ولي أمر</span>
                                        </button>
                                    </div>
                                    
                                    {(newStudent.parentsContacts || []).map((contact, idx) => (
                                        <div key={idx} className="flex flex-col sm:flex-row gap-2 items-center bg-slate-50/50 dark:bg-[#0f172a]/20 p-3 rounded-xl border border-slate-200/50 dark:border-slate-800/60 animate-in slide-in-from-right-2 duration-200">
                                            <select
                                                value={contact.relation}
                                                onChange={e => {
                                                    const updated = [...newStudent.parentsContacts];
                                                    updated[idx] = { ...updated[idx], relation: e.target.value };
                                                    setNewStudent({ ...newStudent, parentsContacts: updated });
                                                }}
                                                className="w-full sm:w-32 p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-900 dark:text-slate-100 transition-colors duration-300"
                                            >
                                                <option value="father">أب</option>
                                                <option value="mother">أم</option>
                                                <option value="other">غيره</option>
                                            </select>
                                            <input 
                                                type="text" 
                                                placeholder="الاسم" 
                                                value={contact.name} 
                                                onChange={e => {
                                                    const updated = [...newStudent.parentsContacts];
                                                    updated[idx] = { ...updated[idx], name: e.target.value };
                                                    setNewStudent({ ...newStudent, parentsContacts: updated });
                                                }}
                                                className="flex-1 w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-900 dark:text-slate-100 transition-colors duration-300"
                                            />
                                            <input 
                                                type="tel" 
                                                placeholder="رقم الهاتف" 
                                                value={contact.phone} 
                                                onChange={e => {
                                                    const updated = [...newStudent.parentsContacts];
                                                    updated[idx] = { ...updated[idx], phone: e.target.value };
                                                    setNewStudent({ ...newStudent, parentsContacts: updated });
                                                }}
                                                dir="ltr"
                                                className="flex-1 w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-900 dark:text-slate-100 transition-colors duration-300"
                                            />
                                            <button 
                                                type="button" 
                                                onClick={() => {
                                                    const updated = newStudent.parentsContacts.filter((_, i) => i !== idx);
                                                    setNewStudent({ ...newStudent, parentsContacts: updated });
                                                }} 
                                                className="p-3 bg-rose-100 dark:bg-rose-955/40 text-rose-600 dark:text-rose-400 rounded-lg border-none cursor-pointer hover:bg-rose-200 dark:hover:bg-rose-900"
                                            >
                                                <X size={20} />
                                            </button>
                                        </div>
                                    ))}
                                </div>

                                <div className="md:col-span-2 space-y-4">
                                    <label className="block text-sm font-bold text-slate-655 dark:text-slate-400">العناوين</label>
                                    {newStudent.addresses.map((address, idx) => (
                                        <div key={idx} className="flex gap-2 animate-in slide-in-from-right-2 duration-200">
                                            <input className="flex-1 p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-900 dark:text-slate-100 transition-colors duration-300" value={address} onChange={e => {
                                                const newAddresses = [...newStudent.addresses];
                                                newAddresses[idx] = e.target.value;
                                                setNewStudent({ ...newStudent, addresses: newAddresses });
                                            }} placeholder="المنطقة، الشارع، رقم الشقة..." />
                                            {idx === newStudent.addresses.length - 1 ? (
                                                <button type="button" onClick={() => setNewStudent({ ...newStudent, addresses: [...newStudent.addresses, ''] })} className="p-3 bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-lg"><Plus size={20} /></button>
                                            ) : (
                                                <button type="button" onClick={() => {
                                                    const newAddresses = newStudent.addresses.filter((_, i) => i !== idx);
                                                    setNewStudent({ ...newStudent, addresses: newAddresses });
                                                }} className="p-3 bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-lg"><X size={20} /></button>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-slate-655 dark:text-slate-400 mb-2">أب الاعتراف</label>
                                    <input className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-900 dark:text-slate-100 transition-colors duration-300" value={newStudent.fatherOfConfession} onChange={e => setNewStudent({ ...newStudent, fatherOfConfession: e.target.value })} placeholder="قدس أبونا..." />
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-slate-655 dark:text-slate-400 mb-2">تاريخ الميلاد</label>
                                    <input type="date" className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-900 dark:text-slate-100 text-right transition-colors duration-300" value={newStudent.birthDate} onChange={e => setNewStudent({ ...newStudent, birthDate: e.target.value })} />
                                </div>

                                <button type="submit" disabled={isAdding} className="md:col-span-2 bg-blue-600 dark:bg-blue-700 dark:hover:bg-blue-600 text-white py-4 rounded-lg font-bold hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 transition-all mt-2">
                                    {isAdding ? 'جاري الحفظ...' : 'حفظ البيانات'}
                                </button>
                            </div>
                        </form>
                            ) : (
                                <div className="space-y-6">
                                    {/* Compulsory Stage & Class Pre-Selectors */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-slate-50/50 dark:bg-[#0f172a]/20 p-5 rounded-2xl border border-slate-200/50 dark:border-slate-800/60">
                                        <div className="space-y-2">
                                            <label className="block text-sm font-bold text-slate-700 dark:text-white">
                                                المرحلة المستهدفة 🏫 <span className="text-rose-500 font-bold">*</span>
                                            </label>
                                            <select
                                                value={bulkTargetStage}
                                                onChange={e => {
                                                    setBulkTargetStage(e.target.value);
                                                    setBulkTargetClass('');
                                                    setBulkStudents([]);
                                                    setMappingStep('upload');
                                                }}
                                                disabled={!isGeneralAdmin}
                                                className="w-full p-3 bg-white dark:bg-[#1e293b] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-70 disabled:cursor-not-allowed transition-all text-sm"
                                            >
                                                <option value="">اختر المرحلة</option>
                                                <option value="ابتدائي">ابتدائي</option>
                                                <option value="اعدادي">اعدادي</option>
                                                <option value="ثانوي">ثانوي</option>
                                            </select>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="block text-sm font-bold text-slate-700 dark:text-white">
                                                الفصل المستهدف 🎯 <span className="text-rose-500 font-bold">*</span>
                                            </label>
                                            <select
                                                value={bulkTargetClass}
                                                onChange={e => {
                                                    setBulkTargetClass(e.target.value);
                                                    setBulkStudents([]);
                                                    setMappingStep('upload');
                                                }}
                                                disabled={!bulkTargetStage || (!isGeneralAdmin && (authorizedClasses || []).length <= 1)}
                                                className="w-full p-3 bg-white dark:bg-[#1e293b] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-70 disabled:cursor-not-allowed transition-all text-sm"
                                            >
                                                <option value="">اختر الفصل</option>
                                                {bulkTargetStage && (
                                                    !isGeneralAdmin ? (
                                                        (authorizedClasses || []).map(cls => (
                                                            <option key={cls} value={cls}>{cls}</option>
                                                        ))
                                                    ) : (
                                                        (STAGE_CLASS_MAP[bulkTargetStage] || []).map(cls => (
                                                            <option key={cls} value={cls}>{cls}</option>
                                                        ))
                                                    )
                                                )}
                                            </select>
                                        </div>
                                    </div>

                                    {/* STEP 1: Upload File */}
                                    {mappingStep === 'upload' && (
                                        <div className="space-y-4 animate-in fade-in duration-300">
                                            <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                                                رفع وقراءة ملف إكسيل 📤
                                            </h3>
                                            <div className={`border-2 border-dashed rounded-2xl p-8 text-center transition-colors relative bg-slate-50/20 dark:bg-[#0f172a]/10 ${
                                                (!bulkTargetStage || !bulkTargetClass)
                                                    ? 'border-slate-200 dark:border-slate-800 cursor-not-allowed opacity-50'
                                                    : 'border-slate-350 dark:border-slate-800 hover:border-blue-500 cursor-pointer'
                                            }`}>
                                                <input 
                                                    type="file" 
                                                    accept=".xlsx, .xls" 
                                                    onChange={handleExcelUpload} 
                                                    disabled={!bulkTargetStage || !bulkTargetClass}
                                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed" 
                                                />
                                                <div className="space-y-2 py-4">
                                                    <div className="text-4xl">📊</div>
                                                    <p className="text-sm font-bold text-slate-755 dark:text-slate-300">
                                                        {!bulkTargetStage || !bulkTargetClass
                                                            ? 'الرجاء اختيار المرحلة والفصل لتفعيل الرفع ⚠️'
                                                            : (isParsing ? 'جاري قراءة وتحليل الملف...' : 'اضغط هنا أو اسحب ملف إكسيل لرفعه')}
                                                    </p>
                                                    <p className="text-xs text-slate-400">
                                                        الصيغ المتاحة: Excel (.xlsx, .xls) - بحد أقصى 200 مخدوم
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* STEP 2: Column Mapping Screen */}
                                    {mappingStep === 'map' && (
                                        <div className="bg-slate-50 dark:bg-[#0f172a]/30 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-6 animate-in fade-in duration-300">
                                            <div className="flex justify-between items-center pb-3 border-b border-slate-200 dark:border-slate-800">
                                                <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                                                    ربط أعمدة الإكسيل بالحقول ⚙️
                                                </h3>
                                                <span className="text-xs text-slate-505 dark:text-slate-450">
                                                    تم العثور على {excelHeaders.length} أعمدة في الملف
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                {/* Left Column: Standard Mappings */}
                                                <div className="space-y-4">
                                                    <div className="space-y-2">
                                                        <label className="block text-xs font-bold text-slate-650 dark:text-slate-300">
                                                            اسم المخدوم <span className="text-rose-500 font-bold">*</span>
                                                        </label>
                                                        <select
                                                            value={fieldMappings.name}
                                                            onChange={e => setFieldMappings({ ...fieldMappings, name: e.target.value })}
                                                            className="w-full p-2.5 bg-white dark:bg-[#1e293b] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                                                        >
                                                            <option value="">اختر عمود الاسم</option>
                                                            {excelHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                                        </select>
                                                    </div>

                                                    <div className="space-y-2">
                                                        <label className="block text-xs font-bold text-slate-655 dark:text-slate-300">
                                                            تاريخ الميلاد (اختياري)
                                                        </label>
                                                        <select
                                                            value={fieldMappings.birthDate}
                                                            onChange={e => setFieldMappings({ ...fieldMappings, birthDate: e.target.value })}
                                                            className="w-full p-2.5 bg-white dark:bg-[#1e293b] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                                                        >
                                                            <option value="">اختر عمود تاريخ الميلاد</option>
                                                            {excelHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                                        </select>
                                                    </div>
                                                </div>

                                                {/* Right Column: Confession Father & Phone */}
                                                <div className="space-y-4">
                                                    <div className="space-y-2">
                                                        <label className="block text-xs font-bold text-slate-655 dark:text-slate-300">
                                                            أب الاعتراف (اختياري)
                                                        </label>
                                                        <select
                                                            value={fieldMappings.fatherOfConfession}
                                                            onChange={e => setFieldMappings({ ...fieldMappings, fatherOfConfession: e.target.value })}
                                                            className="w-full p-2.5 bg-white dark:bg-[#1e293b] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                                                        >
                                                            <option value="">اختر عمود أب الاعتراف</option>
                                                            {excelHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                                        </select>
                                                    </div>

                                                    <div className="space-y-2">
                                                        <label className="block text-xs font-bold text-slate-655 dark:text-slate-300">
                                                            أرقام التليفون (اختياري)
                                                        </label>
                                                        <select
                                                            value={fieldMappings.phone}
                                                            onChange={e => setFieldMappings({ ...fieldMappings, phone: e.target.value })}
                                                            className="w-full p-2.5 bg-white dark:bg-[#1e293b] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                                                        >
                                                            <option value="">اختر عمود رقم الهاتف</option>
                                                            {excelHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                                        </select>
                                                    </div>

                                                    <div className="space-y-2">
                                                        <label className="block text-xs font-bold text-slate-655 dark:text-slate-300">
                                                            رقم تليفون الأب (اختياري)
                                                        </label>
                                                        <select
                                                            value={fieldMappings.fatherPhone}
                                                            onChange={e => setFieldMappings({ ...fieldMappings, fatherPhone: e.target.value })}
                                                            className="w-full p-2.5 bg-white dark:bg-[#1e293b] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                                                        >
                                                            <option value="">اختر عمود رقم الأب</option>
                                                            {excelHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                                        </select>
                                                    </div>

                                                    <div className="space-y-2">
                                                        <label className="block text-xs font-bold text-slate-655 dark:text-slate-300">
                                                            رقم تليفون الأم (اختياري)
                                                        </label>
                                                        <select
                                                            value={fieldMappings.motherPhone}
                                                            onChange={e => setFieldMappings({ ...fieldMappings, motherPhone: e.target.value })}
                                                            className="w-full p-2.5 bg-white dark:bg-[#1e293b] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                                                        >
                                                            <option value="">اختر عمود رقم الأم</option>
                                                            {excelHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Dynamic Merge Address Section */}
                                            <div className="bg-slate-100/60 dark:bg-[#0f172a]/40 p-4 rounded-xl border border-slate-200/60 dark:border-slate-800/80 space-y-3">
                                                <div className="flex justify-between items-center">
                                                    <label className="block text-xs font-bold text-slate-755 dark:text-slate-300">
                                                        العنوان بالتفصيل (العواميد المدمجة بالترتيب 🔗)
                                                    </label>
                                                    <button
                                                        type="button"
                                                        onClick={() => setFieldMappings({
                                                            ...fieldMappings,
                                                            addressColumns: [...fieldMappings.addressColumns, '']
                                                        })}
                                                        className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 dark:bg-blue-950/30 dark:hover:bg-blue-950 dark:text-blue-400 font-bold px-3 py-1.5 rounded-lg border-none cursor-pointer flex items-center gap-1"
                                                    >
                                                        <Plus size={12} />
                                                        <span>إضافة عمود للدمج</span>
                                                    </button>
                                                </div>

                                                <p className="text-[10px] text-slate-550 dark:text-slate-450 leading-relaxed font-semibold">
                                                    يمكنك اختيار أكثر من عمود من الإكسيل لدمجهم معاً (مثل المنطقة واسم الشارع). سيتم دمجهم تلقائياً ويفصل بينهم شرطة ومسافات (-) بالترتيب الموضح أدناه.
                                                </p>

                                                <div className="space-y-2">
                                                    {fieldMappings.addressColumns.map((col, idx) => (
                                                        <div key={idx} className="flex gap-2 items-center animate-in slide-in-from-right-1 duration-150">
                                                            <span className="text-[10px] font-mono text-slate-400 font-bold w-4 text-center">
                                                                {idx + 1}
                                                            </span>
                                                            <select
                                                                value={col}
                                                                onChange={e => {
                                                                    const updated = [...fieldMappings.addressColumns];
                                                                    updated[idx] = e.target.value;
                                                                    setFieldMappings({ ...fieldMappings, addressColumns: updated });
                                                                }}
                                                                className="flex-1 p-2.5 bg-white dark:bg-[#1e293b] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700 rounded-xl font-semibold outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                                                            >
                                                                <option value="">اختر عمود للدمج</option>
                                                                {excelHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                                                            </select>
                                                            <button
                                                                type="button"
                                                                disabled={fieldMappings.addressColumns.length === 1}
                                                                onClick={() => {
                                                                    const updated = fieldMappings.addressColumns.filter((_, i) => i !== idx);
                                                                    setFieldMappings({ ...fieldMappings, addressColumns: updated });
                                                                }}
                                                                className="p-2.5 bg-rose-100 hover:bg-rose-200 text-rose-700 dark:bg-rose-955/30 dark:hover:bg-rose-950 dark:text-rose-400 rounded-xl border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                                            >
                                                                <X size={16} />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Mapping actions */}
                                            <div className="flex gap-3 justify-end pt-3 border-t border-slate-200 dark:border-slate-800">
                                                <button
                                                    type="button"
                                                    onClick={() => setMappingStep('upload')}
                                                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs transition-all border-none cursor-pointer"
                                                >
                                                    الرجوع للرفع ⬅️
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleExtractData}
                                                    disabled={!fieldMappings.name}
                                                    className={`px-5 py-2.5 font-bold rounded-xl shadow text-xs transition-all border-none cursor-pointer text-white ${
                                                        fieldMappings.name 
                                                            ? 'bg-blue-600 hover:bg-blue-700' 
                                                            : 'bg-slate-300 dark:bg-slate-800 text-slate-400 cursor-not-allowed shadow-none'
                                                    }`}
                                                >
                                                    استخراج البيانات والمعاينة 📊
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* STEP 3: Preview and Save */}
                                    {mappingStep === 'preview' && bulkStudents.length > 0 && (
                                        <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-855 animate-in fade-in duration-300">
                                            <div className="flex flex-wrap items-center justify-between gap-4">
                                                <div className="flex items-center gap-4 text-sm font-bold">
                                                    <span className="text-slate-600 dark:text-slate-400">
                                                        إجمالي المقروء: <strong className="text-blue-600 dark:text-blue-400">{bulkStudents.length}</strong>
                                                    </span>
                                                    <span className="text-emerald-600 dark:text-emerald-400">
                                                        جاهز للحفظ: <strong>{bulkStudents.filter(s => s.isValid).length}</strong>
                                                    </span>
                                                    <span className="text-rose-600 dark:text-rose-400 font-bold">
                                                        بها أخطاء: <strong>{bulkStudents.filter(s => !s.isValid).length}</strong>
                                                    </span>
                                                </div>

                                                <div className="flex gap-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => setMappingStep('map')}
                                                        className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-655 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 font-bold rounded-xl text-xs transition-all border-none cursor-pointer"
                                                    >
                                                        تعديل الربط ⚙️
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={handleConfirmImport}
                                                        disabled={isAdding || bulkStudents.filter(s => s.isValid).length === 0}
                                                        className={`px-5 py-2.5 font-bold rounded-xl shadow-md text-xs transition-all flex items-center gap-2 border-none cursor-pointer text-white ${
                                                            bulkStudents.filter(s => s.isValid).length > 0
                                                                ? 'bg-blue-600 hover:bg-blue-700 active:scale-95'
                                                                : 'bg-slate-300 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed shadow-none'
                                                        }`}
                                                    >
                                                        <Plus size={16} />
                                                        <span>
                                                            {isAdding ? 'جاري الحفظ...' : `تأكيد حفظ الدفعة (${bulkStudents.filter(s => s.isValid).length})`}
                                                        </span>
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Preview Grid */}
                                            <div className="overflow-x-auto bg-slate-50 dark:bg-[#0f172a]/20 rounded-2xl border border-slate-150 dark:border-slate-800/80 max-h-[300px]">
                                                <table className="w-full text-right border-collapse text-xs">
                                                    <thead>
                                                        <tr className="bg-slate-100 dark:bg-[#0f172a] text-slate-750 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800">
                                                            <th className="p-3 w-10 text-center">م</th>
                                                            <th className="p-3">الاسم</th>
                                                            <th className="p-3">العنوان بالتفصيل</th>
                                                            <th className="p-3">تاريخ الميلاد</th>
                                                            <th className="p-3">أب الاعتراف</th>
                                                            <th className="p-3">أرقام التليفون</th>
                                                            <th className="p-3 text-center">حالة التحقق</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {bulkStudents.map((student, idx) => (
                                                            <tr key={idx} className="border-b border-slate-150 dark:border-slate-800/60 hover:bg-white dark:hover:bg-slate-800/30 transition-colors">
                                                                <td className="p-3 text-center text-slate-400 font-mono">
                                                                    {idx + 1}
                                                                </td>
                                                                <td className="p-3 font-bold text-slate-900 dark:text-white">
                                                                    {student.name}
                                                                </td>
                                                                <td className="p-3 text-slate-650 dark:text-slate-400">
                                                                    {student.address || '—'}
                                                                </td>
                                                                <td className="p-3 text-slate-655 dark:text-slate-400 font-mono">
                                                                    {student.birthDate || '—'}
                                                                </td>
                                                                <td className="p-3 text-slate-655 dark:text-slate-400">
                                                                    {student.fatherOfConfession || '—'}
                                                                </td>
                                                                <td className="p-3 text-slate-655 dark:text-slate-400 font-mono">
                                                                    {student.phones && student.phones.length > 0 ? student.phones.join(' / ') : '—'}
                                                                </td>
                                                                <td className="p-3 text-center">
                                                                    {student.isValid ? (
                                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/20 shadow-sm text-[10px]">
                                                                            جاهز ✅
                                                                        </span>
                                                                    ) : (
                                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-450 font-bold border border-rose-500/20 shadow-sm text-[10px]" title={student.errorMsg}>
                                                                            ⚠️ {student.errorMsg}
                                                                        </span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}







                    <div className="overflow-x-auto bg-white dark:bg-[#1e293b] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors duration-300 print:border-none print:shadow-none print:bg-transparent print:overflow-visible">



                        <table className="w-full text-right border-collapse">



                            <thead>



                                <tr className="bg-slate-100 dark:bg-[#0f172a] text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800">



                                    <th className="p-3">كود المخدوم</th>



                                    <th className="p-3">اسم المخدوم</th>



                                    <th className="p-3">المرحلة</th>



                                    <th className="p-3">الفصل</th>



                                    <th className="p-3">أرقام التليفون</th>



                                    <th className="p-3">العناوين</th>



                                    <th className="p-3">عدد الصفات</th>

                                    <th className="p-3 text-center">اعتراف هذا الشهر</th>

                                    <th className="p-3 text-center">حضور القداس</th>
                                     <th className="p-3 text-center">حضور الخدمة</th>



                                </tr>



                            </thead>



                            <tbody>



                                {filteredStudentsTab2.map(student => (



                                    <tr key={student.id} className="border-b border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">



                                        <td className="p-4 font-mono font-bold text-slate-500 dark:text-slate-400">#{student.code}</td>



                                        <td className="p-4 font-bold">



                                            <Link to={`/admin/student/${student.id}`} className="text-blue-500 hover:underline hover:text-blue-600 transition-colors">{student.name}</Link>



                                        </td>



                                        <td className="p-4 font-semibold text-slate-700 dark:text-slate-300">{student.schoolGrade || '—'}</td>



                                        <td className="p-4 font-semibold text-slate-700 dark:text-slate-300">{student.assignedClass || '—'}</td>



                                        <td className="p-4 text-sm font-medium text-slate-650 dark:text-slate-400">{student.phones && student.phones.filter(Boolean).length > 0 ? student.phones.filter(Boolean).join('، ') : '—'}</td>



                                        <td className="p-4 text-sm text-slate-650 dark:text-slate-400">{student.addresses && student.addresses.filter(Boolean).length > 0 ? student.addresses.filter(Boolean).join('، ') : '—'}</td>



                                        <td className="p-4 text-sm text-slate-655 dark:text-slate-400">



                                            <div className="flex flex-col gap-1">



                                                <div><span className="font-bold text-amber-600 dark:text-amber-400">الصفات:</span> {student.points || 0}</div>



                                                {student.notes && <div className="text-slate-400 dark:text-slate-550 text-xs">{student.notes}</div>}



                                            </div>

                                        </td>

                                        {(() => {
                                            const today = new Date();
                                            const monthKey = `${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
                                            const hasConfessed = student.confessions?.[monthKey]?.status === true;
                                            return (
                                                <td className="p-4 text-center">
                                                    <span className={`text-[11px] font-black px-2.5 py-1 rounded-full border ${
                                                        hasConfessed
                                                        ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-emerald-250 dark:border-emerald-800/80'
                                                        : 'bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 border-rose-250 dark:border-rose-900/30'
                                                    }`}>
                                                        {hasConfessed ? '✅ اعترف' : '❌ لم يعترف'}
                                                    </span>
                                                </td>
                                            );
                                        })()}

                                        <td className="p-4 text-center font-bold text-purple-600 dark:text-purple-400">{student.liturgyAttendance ? student.liturgyAttendance.length : 0} قداس</td>
                                         <td className="p-4 text-center font-bold text-emerald-600 dark:text-emerald-400">{student.attendance ? student.attendance.length : 0} جمعة</td>



                                    </tr>



                                ))}



                                {filteredStudentsTab2.length === 0 && (



                                    <tr>



                                        <td colSpan="8" className="p-8 text-center text-slate-450 dark:text-slate-500 font-bold">لا توجد نتائج مطابقة للبحث في نطاق مرحلتك المصرحة</td>



                                    </tr>



                                )}



                            </tbody>



                        </table>



                    </div>



                </div>



            )}







            {activeTab === 'print_cards' && renderPrintCardsTab()}

            {activeTab === 'stage_promotion' && isGeneralAdmin && renderStagePromotionTab()}







            {/* Attendance Modal */}



            {attendanceModalStudentId && (



                <div className="fixed inset-0 z-[200] bg-slate-900/60 dark:bg-slate-955/80 backdrop-blur-sm flex items-center justify-center p-4">



                     <div className="bg-white dark:bg-[#1e293b] rounded-3xl w-full max-w-md shadow-2xl p-6 md:p-8 border border-slate-100 dark:border-slate-800 animate-in zoom-in-95 duration-200 transition-colors duration-300">



                        <div className="flex justify-between items-start mb-6">



                            <h3 className="text-2xl font-black text-slate-800 dark:text-slate-100">سجل الحضور</h3>



                            <button onClick={() => setAttendanceModalStudentId(null)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-850 rounded-xl transition-colors text-slate-400 dark:text-slate-555"><X size={28} /></button>



                        </div>



                        {(() => {



                            const s = students.find(x => x.id === attendanceModalStudentId);



                            if (!s || !s.attendance || s.attendance.length === 0) return (



                                <div className="py-10 text-center space-y-3">



                                    <CalendarDays size={48} className="mx-auto text-slate-200 dark:text-slate-700" />



                                    <p className="text-slate-400 dark:text-slate-505 font-bold">لا يوجد سجل حضور حالياً</p>



                                </div>



                            );



                            return (



                                <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">



                                    {[...s.attendance].reverse().map((d, i) => (



                                        <div key={i} className="flex justify-between items-center p-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl group hover:border-blue-200 dark:hover:border-blue-500 transition-all">



                                            <span className="font-black text-slate-700 dark:text-slate-200">{new Date(d).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'short' })}</span>



                                            <button onClick={() => removeAttendance(attendanceModalStudentId, d)} className="text-rose-400 dark:text-rose-505 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-955/30 p-2 rounded-xl transition-all opacity-100 md:opacity-0 group-hover:opacity-100"><X size={20}/></button>



                                        </div>



                                    ))}



                                </div>



                            );



                        })()}



                    </div>



                </div>



            )}







            {/* Toast Alerts */}



            {toast.show && (



                <div className={`fixed bottom-5 left-5 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-2xl border transition-all duration-300 animate-in fade-in slide-in-from-bottom-5 ${



                    toast.type === 'error' 



                    ? 'bg-rose-50 dark:bg-rose-955/90 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200' 



                    : toast.type === 'warning'



                    ? 'bg-amber-50 dark:bg-amber-955/90 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'



                    : 'bg-emerald-50 dark:bg-emerald-950/90 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'



                }`}>



                    {toast.type === 'error' ? (



                        <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />



                    ) : toast.type === 'warning' ? (



                        <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />



                    ) : (



                        <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />



                    )}



                    <span className="font-bold text-sm leading-relaxed">{toast.message}</span>



                    <button onClick={() => setToast(prev => ({ ...prev, show: false }))} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ml-2">



                        <X size={16} />



                    </button>



                </div>



            )}







            {/* Bulk Print Container */}



            <div className="bulk-print-container hidden">



                {students.filter(s => selectedStudentsPrint.includes(s.id)).map(student => (



                    <div key={student.id} className="bulk-card-page">



                        <div 



                            className="bulk-card-inner print-card-container aspect-[85/54] bg-gradient-to-b from-blue-900 via-slate-905 to-slate-950 text-white relative overflow-hidden flex flex-col justify-between"



                            dir="rtl"



                        >



                            {/* Background Decorative Circles */}



                            <div className="absolute -top-[12cqw] -right-[12cqw] w-[32cqw] h-[32cqw] bg-blue-600/15 rounded-full blur-[4.8cqw] pointer-events-none"></div>



                            <div className="absolute -bottom-[12cqw] -left-[12cqw] w-[32cqw] h-[32cqw] bg-teal-500/15 rounded-full blur-[4.8cqw] pointer-events-none"></div>



                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[38cqw] h-[38cqw] bg-amber-500/5 rounded-full blur-[6cqw] pointer-events-none"></div>







                            {/* Header Section */}



                            <div className="text-center z-10 border-b border-white/10 pb-[2.5%] mb-[1%] relative">



                                <img 



                                    src="/m.png" 



                                    alt="logo" 



                                    className="absolute right-[2cqw] top-[42%] -translate-y-1/2 w-[11cqw] h-[11cqw] object-contain pointer-events-none"



                                />



                                <h2 className="text-[3.2cqw] font-black tracking-wide bg-gradient-to-l from-amber-400 to-yellow-300 bg-clip-text text-transparent">



                                    كنيسة السيدة العذراء مريم



                                </h2>



                                <p className="text-[2cqw] font-bold text-slate-400 uppercase tracking-widest mt-[0.5%]">



                                    خدمة مدارس الأحد



                                </p>



                            </div>







                            {/* Body Section (Horizontal Split) */}



                            <div className="flex flex-1 items-center justify-between my-[2%] z-10 gap-[4.8cqw]">



                                {/* Right side visually: Avatar, Name & Code */}



                                <div className="flex flex-col items-center justify-center text-center w-1/2 space-y-[2.4cqw]">



                                    {/* Avatar Circle */}



                                    <div className="relative">



                                        <div className="w-[16cqw] h-[16cqw] bg-slate-800 rounded-full flex items-center justify-center border-[0.4cqw] border-amber-500/40 shadow-inner overflow-hidden">



                                            {student.photoUrl ? (



                                                <img 



                                                    src={student.photoUrl} 



                                                    alt={student.name} 



                                                    className="w-full h-full object-cover"



                                                />



                                            ) : (



                                                <User className="w-[11cqw] h-[11cqw] text-amber-500" />



                                            )}



                                        </div>



                                        <div className="absolute -bottom-[0.5cqw] -right-[0.5cqw] bg-amber-500 text-slate-950 p-[1cqw] rounded-full shadow-md flex items-center justify-center">



                                            <Award className="w-[3cqw] h-[3cqw] stroke-[3]" />



                                        </div>



                                    </div>







                                    {/* Student Name and ID */}



                                    <div className="space-y-[0.8cqw] w-full">



                                        <h3 className="text-[3.6cqw] font-black tracking-tight text-white drop-shadow-md truncate max-w-full px-[1.5cqw]">



                                            {student.name}



                                        </h3>



                                        



                                        <div className="inline-flex items-center gap-[1.2cqw] bg-slate-800/80 px-[2cqw] py-[0.4cqw] rounded-full border border-white/5">



                                            <span className="text-[1.8cqw] font-bold text-slate-400">كود المخدوم:</span>



                                            <span className="text-[2.4cqw] font-black text-amber-400 font-mono">{student.code}</span>



                                        </div>



                                    </div>



                                </div>







                                {/* Left side visually: Badges & QR Code */}



                                <div className="flex flex-col items-center gap-[2cqw] w-1/2">



                                    {/* Badges row */}



                                    <div className="flex gap-[1.6cqw] w-full justify-center">



                                        <div className="bg-white/5 rounded-[1.6cqw] p-[1.5cqw] border border-white/5 text-center flex-1 min-w-0">



                                            <span className="block text-[1.6cqw] font-bold text-slate-400">الفصل</span>



                                            <span className="text-[2.2cqw] font-black text-slate-200 block truncate">{student.assignedClass || 'غير محدد'}</span>



                                        </div>



                                        <div className="bg-white/5 rounded-[1.6cqw] p-[1.5cqw] border border-white/5 text-center flex-1 min-w-0">



                                            <span className="block text-[1.6cqw] font-bold text-slate-400">المرحلة</span>



                                            <span className="text-[2.2cqw] font-black text-slate-200 block truncate">{student.schoolGrade || 'غير محدد'}</span>



                                        </div>



                                    </div>



                                    {/* QR Code */}



                                    <div className="bg-white p-[2cqw] rounded-[2cqw] shadow-lg border border-amber-500/20 flex items-center justify-center">



                                        <div className="w-[19cqw] h-[19cqw] flex items-center justify-center">



                                            <QRCodeSVG 



                                                value={student.id} 



                                                style={{ width: '100%', height: '100%' }}



                                                level="H"



                                                includeMargin={false}



                                                fgColor="#0f172a"



                                            />



                                        </div>



                                    </div>



                                </div>



                            </div>







                            {/* Footer Section */}



                            <div className="text-center z-10 border-t border-white/10 pt-[1.6cqw] flex justify-between items-center text-[1.8cqw] font-semibold text-slate-400">



                                <span>كارنيه التحضير الذكي للأنشطة</span>



                                <span className="text-amber-500/80 font-black">2026 / 2027</span>



                            </div>



                        </div>



                    </div>



                ))}



            </div>







            {/* Bulk Print Styles */}



            {isPrintingBulk && (



                <style>{`



                    @media print {



                        @page {



                            size: 8.5cm 5.4cm;



                            margin: 0;



                        }







                        /* For bulk printing, neutralize all intermediate layouts */



                        body.printing-bulk #root, 



                        body.printing-bulk #root *:not(.bulk-print-container):not(.bulk-print-container *) {



                            position: static !important;



                            transform: none !important;



                            margin: 0 !important;



                            padding: 0 !important;



                            height: 0 !important;



                            width: 0 !important;



                            overflow: visible !important;



                            box-shadow: none !important;



                            filter: none !important;



                            backdrop-filter: none !important;



                        }



                        



                        body.printing-bulk {



                            width: 8.5cm !important;



                            height: 5.4cm !important;



                            overflow: hidden !important;



                            background-color: transparent !important;



                            -webkit-print-color-adjust: exact !important;



                            print-color-adjust: exact !important;



                            margin: 0 !important;



                            padding: 0 !important;



                        }



                        



                        body.printing-bulk * {



                            visibility: hidden !important;



                        }



                        



                        body.printing-bulk .bulk-print-container,



                        body.printing-bulk .bulk-print-container * {



                            visibility: visible !important;



                        }



                        



                        body.printing-bulk .bulk-print-container {



                            display: block !important;



                            position: absolute !important;



                            left: 0 !important;



                            top: 0 !important;



                            width: 8.5cm !important;



                            height: auto !important;



                        }



                        



                        body.printing-bulk .bulk-card-page {



                            display: block !important;



                            width: 8.5cm !important;



                            height: 5.4cm !important;



                            page-break-after: always !important;



                            break-after: page !important;



                            position: relative !important;



                            box-sizing: border-box !important;



                            margin: 0 !important;



                            padding: 0 !important;



                        }



                        



                        body.printing-bulk .bulk-card-inner {



                            width: 8.5cm !important;



                            height: 5.4cm !important;



                            border-radius: 0.2cm !important;



                            border: 0.03cm solid rgba(245, 158, 11, 0.3) !important;



                            box-sizing: border-box !important;



                            background: linear-gradient(to bottom, #1e3a8a, #0f172a, #020617) !important;



                            -webkit-print-color-adjust: exact !important;



                            print-color-adjust: exact !important;



                            position: relative !important;



                            overflow: hidden !important;



                            padding: 4% !important;



                            display: flex !important;



                            flex-direction: column !important;



                            justify-content: space-between !important;



                            container-type: inline-size;



                            container-name: card;



                        }



                        



                        /* Fix transparent clip text gradient bug in printing */



                        body.printing-bulk .bulk-card-inner h2 {



                            background: none !important;



                            -webkit-background-clip: unset !important;



                            background-clip: unset !important;



                            -webkit-text-fill-color: #fbbf24 !important;



                            color: #fbbf24 !important;



                        }



                    }



                `}</style>



            )}



            <style>{`



                .bulk-print-container {



                    display: none;



                }



            `}</style>



        </div>



    );



}