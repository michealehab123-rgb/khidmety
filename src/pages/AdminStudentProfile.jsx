import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isStoreVisibleForStudent } from '../utils/storeConfig';
import { doc, onSnapshot, updateDoc, setDoc, addDoc, increment, arrayUnion, arrayRemove, collection, query, where, getDocs, serverTimestamp, db, runTransaction, getDoc, deleteDoc, writeBatch, deleteField } from '../firebase';
import { ArrowRight, Edit, Save, X, Plus, Check, CalendarDays, Key, Smartphone, MapPin, User, Hash, Info, Star, Trash2, Activity, Heart, BookOpen, Award, ShoppingCart, PhoneCall, Clock, Home, AlertCircle, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

const compressImage = (file, maxWidth = 400, maxHeight = 400) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                resolve(dataUrl);
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
};

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

const calculateStreak = (dates) => {
    if (!dates || dates.length === 0) return 0;
    const sortedDates = [...dates].map(d => new Date(d)).sort((a, b) => b - a);
    let streak = 0;
    let current = sortedDates[0];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffTime = Math.abs(today - current);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays > 8) {
        return 0;
    }
    streak = 1;
    for (let i = 1; i < sortedDates.length; i++) {
        const prev = sortedDates[i];
        const diff = (current - prev) / (1000 * 60 * 60 * 24);
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


export default function AdminStudentProfile() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { servant, isGeneralAdmin, isServant, loading: authLoading } = useAuth();

    const roleNorm = servant?.role ? normalizeArabic(servant.role) : '';
    const isStageServant = roleNorm.includes('مرحله');
    const isClassServant = roleNorm.includes('فصل') || roleNorm === 'خادم';

    const allowedClasses = [
        ...(servant?.managedClasses || []),
        ...(servant?.myClasses || []),
        ...(servant?.assignedClass ? [servant.assignedClass] : [])
    ].map(c => normalizeArabic(c));

    const getStagesForServant = () => {
        if (isGeneralAdmin) {
            return ['ابتدائي', 'اعدادي', 'ثانوي'];
        }
        
        if (isStageServant) {
            const rawStage = servant?.assignedStage || servant?.grade || '';
            const normalizedRawStage = normalizeArabic(rawStage);
            let myStage = '';
            if (normalizedRawStage.includes('ابتدائي')) myStage = 'ابتدائي';
            else if (normalizedRawStage.includes('اعدادي')) myStage = 'اعدادي';
            else if (normalizedRawStage.includes('ثانوي')) myStage = 'ثانوي';
            return myStage ? [myStage] : [];
        }
        
        if (isClassServant) {
            const stages = [];
            Object.keys(STAGE_CLASS_MAP).forEach(st => {
                const classesForStage = STAGE_CLASS_MAP[st] || [];
                const hasAccess = classesForStage.some(cls => allowedClasses.includes(normalizeArabic(cls)));
                if (hasAccess) {
                    stages.push(st);
                }
            });
            return stages;
        }
        
        return [];
    };

    const allowedStages = getStagesForServant();
    const shouldDisableStageDropdown = isStageServant || (isClassServant && allowedStages.length <= 1);

    const [student, setStudent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [editMode, setEditMode] = useState(false);
    const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
    const [formData, setFormData] = useState({});
    const [pointAmount, setPointAmount] = useState(0);
    const [isMutatingPoints, setIsMutatingPoints] = useState(false);
    const [isMutatingConfession, setIsMutatingConfession] = useState(false);
    const [confessionMonth, setConfessionMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'));
    const [confessionYear, setConfessionYear] = useState(String(new Date().getFullYear()));
    const [manualPassword, setManualPassword] = useState('');
    const [activeTab, setActiveTab] = useState('info'); // 'info' | 'visitations' | 'purchases' | 'traitsLog'
    const [attendanceConfigs, setAttendanceConfigs] = useState({});
    const [visitationSubTab, setVisitationSubTab] = useState('home'); // 'home' | 'phone'
    const [orders, setOrders] = useState([]);
    const [ordersLoading, setOrdersLoading] = useState(true);
    const [traitsLog, setTraitsLog] = useState([]);
    const [traitsLoading, setTraitsLoading] = useState(true);
    const [shortcuts, setShortcuts] = useState(() => {
        const saved = localStorage.getItem('points_shortcuts');
        return saved ? JSON.parse(saved) : [5, 10, 20];
    });

    const [attendancePointsInput, setAttendancePointsInput] = useState('');
    const [storeConfigs, setStoreConfigs] = useState([]);
    
    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'store_config'), (snapshot) => {
            const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setStoreConfigs(list);
        });
        return () => unsub();
    }, []);

    const storeVisible = isStoreVisibleForStudent(student, storeConfigs);
    const isPointsValid = storeVisible === false
        ? /^\d*$/.test(attendancePointsInput)
        : /^\d+$/.test(attendancePointsInput);
    const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
    const showToast = (message, type = 'success') => {
        setToast({ show: true, message, type });
        setTimeout(() => {
            setToast(prev => ({ ...prev, show: false }));
        }, 4500);
    };

    useEffect(() => {
        if (authLoading) return;
        setOrdersLoading(true);
        const q = query(collection(db, 'orders'), where('studentId', '==', id));
        const unsub = onSnapshot(q, (snap) => {
            const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            list.sort((a, b) => {
                const getMillis = (order) => {
                    if (!order.createdAt) return 0;
                    if (typeof order.createdAt.toDate === 'function') return order.createdAt.toDate().getTime();
                    return new Date(order.createdAt).getTime();
                };
                return getMillis(b) - getMillis(a);
            });
            setOrders(list);
            setOrdersLoading(false);
        }, (error) => {
            console.error("Error fetching student orders:", error);
            setOrdersLoading(false);
        });
        return () => unsub();
    }, [id, authLoading]);

    // Helper function for sorting fallback
    const getCleanCreatedAtTime = (st) => {
        if (!st) return 0;
        if (st.createdAt === null) return Date.now();
        if (typeof st.createdAt === 'undefined') return 0;
        if (typeof st.createdAt.toDate === 'function') return st.createdAt.toDate().getTime();
        if (st.createdAt && typeof st.createdAt.seconds === 'number') return st.createdAt.seconds * 1000;
        const t = new Date(st.createdAt).getTime();
        return isNaN(t) ? 0 : t;
    };

    // Fetch Traits / Points History
    useEffect(() => {
        if (authLoading) return;
        setTraitsLoading(true);
        const q = query(collection(db, 'pointsHistory'), where('studentId', '==', id));
        const unsub = onSnapshot(q, (snap) => {
            const sortedDocs = snap.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .sort((a, b) => getCleanCreatedAtTime(b) - getCleanCreatedAtTime(a)); // Newest first
            setTraitsLog(sortedDocs);
            setTraitsLoading(false);
        }, (error) => {
            console.error("Error fetching points history:", error);
            setTraitsLoading(false);
        });
        return () => unsub();
    }, [id, authLoading]);
    const [showAddShortcut, setShowAddShortcut] = useState(false);
    const [newShortcut, setNewShortcut] = useState('');

    useEffect(() => {
        const handleStorageChange = (e) => {
            if (e.key === 'points_shortcuts') {
                setShortcuts(JSON.parse(e.newValue));
            }
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

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

    useEffect(() => {
        localStorage.setItem('points_shortcuts', JSON.stringify(shortcuts));
    }, [shortcuts]);

    const addNewShortcut = () => {
        const val = parseInt(newShortcut);
        if (val > 0 && !shortcuts.includes(val)) {
            setShortcuts([...shortcuts, val].sort((a, b) => a - b));
            setNewShortcut('');
            setShowAddShortcut(false);
        }
    };

    const removeShortcut = (val) => {
        setShortcuts(shortcuts.filter(s => s !== val));
    };

    useEffect(() => {
        if (authLoading) return;

        setLoading(true);
        const unsub = onSnapshot(doc(db, 'students', id), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                
                // Strict Security Check: prevent direct URL tampering/unauthorized profile access
                if (!isGeneralAdmin && isServant && servant) {
                    const roleNorm = servant.role ? normalizeArabic(servant.role) : '';
                    const isStageServant = roleNorm === 'امين مرحله';
                    const isClassServant = roleNorm === 'امين فصل' || roleNorm === 'خادم فصل' || roleNorm === 'خادم';
                    
                    const studentClass = data.assignedClass || data.schoolGrade || '';
                    const normStudentClass = normalizeArabic(studentClass);

                    if (isStageServant) {
                        const myManagedClasses = (servant.managedClasses || []).map(c => normalizeArabic(c));
                        const isManaged = myManagedClasses.includes(normStudentClass);
                        if (!isManaged) {
                            alert('عذراً، لا تملك صلاحية الوصول لبيانات هذا المخدوم.');
                            navigate('/servant/profile');
                            return;
                        }
                    } else if (isClassServant) {
                        const myClasses = servant.myClasses || (servant.assignedClass ? [servant.assignedClass] : []);
                        const myNormClasses = myClasses.map(c => normalizeArabic(c));
                        const isAssigned = myNormClasses.includes(normStudentClass);
                        if (!isAssigned) {
                            alert('عذراً، لا تملك صلاحية الوصول لبيانات هذا المخدوم.');
                            navigate('/servant/profile');
                            return;
                        }
                    } else {
                        // Fallback security check if role is unrecognized
                        alert('عذراً، لا تملك صلاحية الوصول لبيانات هذا المخدوم.');
                        navigate('/servant/profile');
                        return;
                    }
                }

                setStudent({ id: docSnap.id, ...data });
                if (!editMode) {
                    const getSafeArray = (arr, fallback) => {
                        if (arr && Array.isArray(arr) && arr.length > 0) {
                            return arr;
                        }
                        if (fallback && typeof fallback === 'string' && fallback.trim()) {
                            return [fallback.trim()];
                        }
                        return [''];
                    };

                    setFormData({
                        name: data.name || '',
                        code: data.code || '',
                        phones: getSafeArray(data.phones, data.phone),
                        addresses: getSafeArray(data.addresses, data.address),
                        birthDate: data.birthDate || '',
                        fatherOfConfession: data.fatherOfConfession || '',
                        schoolGrade: data.schoolGrade || '',
                        assignedClass: data.assignedClass || '',
                        notes: data.notes || '',
                        password: data.password || data.code || '',
                        phone: data.phone || '',
                        address: data.address || '',
                        parentsContacts: data.parentsContacts || [],
                    });
                }
            } else {
                setStudent(null);
            }
            setLoading(false);
        });
        return () => unsub();
    }, [id, editMode, authLoading, isGeneralAdmin, isServant, servant, navigate]);

    const handleUpdateAdminPassword = async () => {
        if (!manualPassword) {
            alert('الرجاء كتابة كلمة مرور جديدة!');
            return;
        }
        if (window.confirm('هل أنت متأكد من تحديث كلمة المرور لهذا المخدوم؟')) {
            try {
                await updateDoc(doc(db, 'students', id), {
                    password: manualPassword,
                    isPasswordChanged: true,
                    lastPasswordUpdate: serverTimestamp()
                });
                alert('تم تحديث كلمة المرور بنجاح');
                setManualPassword('');
            } catch (error) {
                console.error("Error updating password:", error);
                alert('حدث خطأ أثناء تحديث كلمة المرور');
            }
        }
    };

    const handleSave = async () => {
        try {
            if (formData.code && formData.code !== student.code) {
                const codeQuery = query(collection(db, 'students'), where('code', '==', formData.code));
                const querySnapshot = await getDocs(codeQuery);
                const isDuplicate = querySnapshot.docs.some(d => d.id !== id);
                if (isDuplicate) {
                    alert('عذراً، هذا الكود مستخدم بالفعل لمخدوم آخر');
                    return;
                }
            }

            const finalData = {
                ...formData,
                phones: (formData.phones || []).filter(p => p.trim() !== ''),
                addresses: (formData.addresses || []).filter(a => a.trim() !== ''),
                parentsContacts: (formData.parentsContacts || []).filter(c => c.phone && c.phone.trim() !== ''),
            };

            const isBirthDateChanged = (formData.birthDate || '') !== (student.birthDate || '');
            if (isBirthDateChanged) {
                finalData.studentEditedBirthDate = true;
            }

            const isPasswordChangedByAdmin = formData.password !== student.password;
            if (isPasswordChangedByAdmin) {
                finalData.lastPasswordUpdate = serverTimestamp();
            }

            await setDoc(doc(db, 'students', id), finalData, { merge: true });
            setEditMode(false);
            alert('تم حفظ التعديلات بنجاح');
        } catch (error) {
            console.error("Error saving student data:", error);
            alert('حدث خطأ أثناء الحفظ');
        }
    };

    const handleAddPoints = async () => {
        if (pointAmount <= 0) return;
        if (isMutatingPoints) return;

        const message = isAttendedToday
            ? "تنبيه: أنت الآن تضيف مكافأة إضافية (Bonus) لهذا الطالب بجانب صفات الحضور"
            : "تنبيه: هذا المخدوم لم يتم تحضيره، هذه إضافة صفات منفصلة";
        if (!window.confirm(message + "\n\nهل تريد الاستمرار؟")) {
            return;
        }

        setIsMutatingPoints(true);
        try {
            await updateDoc(doc(db, 'students', id), { points: increment(pointAmount) });
            await addDoc(collection(db, 'pointsHistory'), {
                studentId: id,
                amount: Number(pointAmount),
                points: Number(pointAmount),
                reason: 'إضافة عامة من صفحة الملف الشخصي',
                createdAt: serverTimestamp()
            });
            setPointAmount(0);
            showToast('تم إضافة الصفات بنجاح ✅', 'success');
        } catch (error) {
            console.error("Error adding points:", error);
            showToast('حدث خطأ أثناء إضافة الصفات ❌', 'error');
        } finally {
            setIsMutatingPoints(false);
        }
    };

    const handleSubtractPoints = async () => {
        if (pointAmount <= 0) return;
        if (isMutatingPoints) return;

        if (!window.confirm(`هل أنت متأكد أنك تريد خصم ${pointAmount} صفة؟`)) {
            return;
        }

        setIsMutatingPoints(true);
        try {
            await updateDoc(doc(db, 'students', id), { points: increment(-pointAmount) });
            await addDoc(collection(db, 'pointsHistory'), {
                studentId: id,
                amount: -Number(pointAmount),
                points: -Number(pointAmount),
                reason: 'خصم عام من صفحة الملف الشخصي',
                createdAt: serverTimestamp()
            });
            setPointAmount(0);
            showToast('تم خصم الصفات بنجاح ✅', 'success');
        } catch (error) {
            console.error("Error subtracting points:", error);
            showToast('حدث خطأ أثناء خصم الصفات ❌', 'error');
        } finally {
            setIsMutatingPoints(false);
        }
    };

    const isAttendedToday = student?.attendance?.some(dateStr => {
        const d = new Date(dateStr);
        const today = new Date();
        return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    });

    const markAttendance = async (pointsToAdd = 5) => {
        if (!isPointsValid) return;
        if (new Date().getDay() !== 5) {
            showToast('تسجيل الحضور متاح فقط يوم الجمعة ⚠️', 'warning');
            return;
        }

        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        try {
            const studentRef = doc(db, 'students', id);
            const attendanceDocId = `${id}_${todayStr}`;
            const attendanceRef = doc(db, 'attendance', attendanceDocId);
            const servantName = servant?.name || 'غير معروف';

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
                studentId: id,
                date: todayStr,
                stage: currentStudentData.schoolGrade || '',
                class: currentStudentData.assignedClass || '',
                status: 'present',
                servantName: servantName,
                pointsAdded: pointsToAdd,
                updatedAt: new Date()
            }, { merge: true });

            // 4. Update student record
            const safeClassId = currentStudentData.assignedClass ? currentStudentData.assignedClass.replace(/\//g, '-') : '';
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
                studentId: id,
                amount: Number(pointsToAdd),
                points: Number(pointsToAdd),
                reason: `حضور يوم الجمعة (${servantName})`,
                createdAt: new Date()
            });

            // Commit batch (works offline)
            await batch.commit();

            showToast('تم تسجيل الحضور وإضافة النقاط بنجاح ✅', 'success');
        } catch (error) {
            console.error("Error marking attendance:", error);
            showToast(error.message || 'حدث خطأ أثناء تسجيل الحضور', 'error');
        }
    };

    const removeAttendance = async (dateStr) => {
        if (window.confirm("هل أنت متأكد من مسح هذا الحضور؟")) {
            try {
                const safeClassId = student.assignedClass ? student.assignedClass.replace(/\//g, '-') : '';
                const consecutiveGiftEnabled = !!attendanceConfigs[safeClassId]?.consecutiveGiftEnabled;
                
                const currentAttendance = student.attendance || [];
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
                    points: Math.max(0, (student.points || 0) - pointsAdded)
                };
                if (consecutiveGiftEnabled) {
                    updates.attendanceStreak = calculateStreak(newAttendance);
                }

                await updateDoc(doc(db, 'students', id), updates);
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

    const handleToggleConfession = async () => {
        if (isMutatingConfession) return;
        setIsMutatingConfession(true);

        const monthKey = `${confessionMonth}-${confessionYear}`;
        const isCurrentlyConfessed = student?.confessions?.[monthKey]?.status === true;

        try {
            if (!isCurrentlyConfessed) {
                const today = new Date();
                const currentMonthStr = String(today.getMonth() + 1).padStart(2, '0');
                const currentYearStr = String(today.getFullYear());
                
                let dateToStore = new Date().toISOString();
                if (confessionMonth !== currentMonthStr || confessionYear !== currentYearStr) {
                    const constructedDate = new Date(parseInt(confessionYear, 10), parseInt(confessionMonth, 10) - 1, 1, 12, 0, 0);
                    dateToStore = constructedDate.toISOString();
                }

                await updateDoc(doc(db, 'students', id), {
                    [`confessions.${monthKey}`]: {
                        status: true,
                        date: dateToStore,
                        markedBy: servant?.name || 'خادم'
                    }
                });
                showToast('تم تسجيل الاعتراف للشهر المحدد بنجاح ✅', 'success');
            } else {
                if (window.confirm('هل أنت متأكد من إلغاء تسجيل الاعتراف للشهر المحدد؟')) {
                    await updateDoc(doc(db, 'students', id), {
                        [`confessions.${monthKey}`]: deleteField()
                    });
                    showToast('تم إلغاء تسجيل الاعتراف بنجاح ⚠️', 'warning');
                }
            }
        } catch (error) {
            console.error("Error toggling confession:", error);
            showToast('حدث خطأ أثناء تعديل حالة الاعتراف ❌', 'error');
        } finally {
            setIsMutatingConfession(false);
        }
    };

    const handlePhotoUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            showToast('الرجاء اختيار ملف صورة صالح ⚠️', 'warning');
            return;
        }

        try {
            const base64Str = await compressImage(file, 400, 400);
            await updateDoc(doc(db, 'students', id), {
                photoUrl: base64Str
            });
            showToast('تم تحديث الصورة الشخصية للمخدوم بنجاح 📸✅', 'success');
        } catch (error) {
            console.error("Error uploading photo:", error);
            showToast('حدث خطأ أثناء رفع الصورة ❌', 'error');
        }
    };

    if (loading || authLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
                <p className="text-lg font-bold text-slate-400">جاري التحميل...</p>
            </div>
        );
    }

    if (!student) return <div className="p-8 text-center font-black text-rose-500">المخدوم غير موجود</div>;

    // Security check is enforced in the snapshot fetch above to prevent loading unauthorized data.

    const renderInput = (label, key, icon, type = 'text') => (
        <div className="space-y-2">
            <label className="text-slate-500 dark:text-slate-400 text-sm font-semibold tracking-wide mb-1.5 flex items-center gap-1.5 justify-start">
                {icon}
                {label}
            </label>
            {editMode ? (
                type === 'textarea' ? (
                    <textarea
                        className="w-full px-5 py-3 bg-slate-50 border border-slate-200 dark:border-slate-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 rounded-xl font-bold text-slate-800 dark:text-slate-100 outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500 min-h-[100px] dark:bg-[#0f172a]"
                        value={formData[key]}
                        onChange={e => setFormData({ ...formData, [key]: e.target.value })}
                    />
                ) : (
                    <input
                        className="w-full px-5 py-3 bg-slate-50 border border-slate-200 dark:border-slate-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 rounded-xl font-bold text-slate-800 dark:text-slate-100 outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500 dark:bg-[#0f172a]"
                        type={type}
                        value={formData[key]}
                        onChange={e => setFormData({ ...formData, [key]: e.target.value })}
                    />
                )
            ) : (
                <div className="bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 text-slate-900 dark:text-slate-100 font-medium text-center shadow-inner transition-all block w-full">
                    {student[key] || <span className="text-slate-300 font-normal dark:text-slate-600">غير مسجل</span>}
                </div>
            )}
        </div>
    );

    const renderArrayInput = (label, key, icon, inputType = 'text') => {
        const studentArray = (student[key] || (student[key.slice(0, -1)] ? [student[key.slice(0, -1)]] : [])).filter(item => item && item.trim() !== '');
        
        const handleItemClick = (item) => {
            if (key === 'phones') {
                navigator.clipboard.writeText(item)
                    .then(() => {
                        showToast('تم نسخ رقم الهاتف وجاري الاتصال 📞', 'success');
                    })
                    .catch(err => {
                        console.error("Clipboard copy failed", err);
                        showToast('جاري الاتصال 📞', 'success');
                    });
                setTimeout(() => {
                    window.location.href = `tel:${item}`;
                }, 100);
            } else if (key === 'addresses') {
                navigator.clipboard.writeText(item)
                    .then(() => {
                        showToast('تم نسخ العنوان بنجاح 📋', 'success');
                    })
                    .catch(err => console.error("Clipboard copy failed", err));
            }
        };

        return (
            <div className="space-y-4">
                <label className="text-slate-500 dark:text-slate-400 text-sm font-semibold tracking-wide mb-1.5 flex items-center gap-1.5 justify-start">
                    {icon}
                    {label}
                </label>
                <div className="space-y-3">
                    {editMode ? (
                        formData[key]?.map((item, idx) => (
                            <div key={`${key}-${idx}`} className="flex gap-2 animate-in slide-in-from-right-2 duration-200">
                                <input
                                    className="flex-1 px-5 py-3 bg-slate-50 border border-slate-200 dark:border-slate-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 rounded-xl font-bold text-slate-800 dark:text-slate-100 outline-none transition-all dark:bg-[#0f172a]"
                                    type={inputType}
                                    value={item}
                                    onChange={e => {
                                        const newArr = [...formData[key]];
                                        newArr[idx] = e.target.value;
                                        setFormData({ ...formData, [key]: newArr });
                                    }}
                                    dir={inputType === 'tel' ? 'ltr' : 'auto'}
                                />
                                {idx === formData[key].length - 1 && (
                                    <button 
                                        type="button" 
                                        onClick={() => setFormData({ ...formData, [key]: [...formData[key], ''] })} 
                                        className="p-3 bg-blue-100 text-blue-600 rounded-2xl hover:bg-blue-200 dark:bg-blue-955/40 dark:text-blue-400 dark:hover:bg-blue-900/40"
                                    >
                                        <Plus size={20} />
                                    </button>
                                )}
                                {formData[key].length > 1 && (
                                    <button 
                                        type="button" 
                                        onClick={() => {
                                            const newArr = formData[key].filter((_, i) => i !== idx);
                                            setFormData({ ...formData, [key]: newArr });
                                        }} 
                                        className="p-3 bg-rose-50 text-rose-500 rounded-2xl hover:bg-rose-100 dark:bg-rose-955/40 dark:text-rose-400 dark:hover:bg-rose-900/40"
                                    >
                                        <X size={20} />
                                    </button>
                                )}
                            </div>
                        ))
                    ) : (
                        studentArray.length > 0 ? (
                            studentArray.map((item, idx) => (
                                <div 
                                    key={idx} 
                                    onClick={() => handleItemClick(item)}
                                    className="bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 text-slate-900 dark:text-slate-100 font-medium text-center shadow-inner transition-all block w-full cursor-pointer hover:bg-slate-100 dark:hover:bg-[#0f172a]/80 hover:shadow-md hover:scale-[1.01] active:scale-[0.99] select-none animate-in fade-in duration-200" 
                                    dir={inputType === 'tel' ? 'ltr' : 'auto'}
                                    title={key === 'phones' ? 'اضغط للنسخ والاتصال' : 'اضغط لنسخ العنوان'}
                                >
                                    {item}
                                </div>
                            ))
                        ) : (
                            <div className="bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 text-slate-900 dark:text-slate-100 font-medium text-center shadow-inner transition-all block w-full">
                                <span className="text-slate-300 font-normal dark:text-slate-600">غير مسجل</span>
                            </div>
                        )
                    )}

                    {/* GPS Home Location Section for Admins/Servants */}
                    {key === 'addresses' && !editMode && (
                        student.homeLocation ? (
                            <div className="mt-3 p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-150 dark:border-blue-900/40 rounded-2xl flex flex-col sm:flex-row justify-between items-center gap-3">
                                <div className="text-right w-full sm:w-auto">
                                    <span className="block text-[11px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest">
                                        الموقع الجغرافي مسجل GPS 📍
                                    </span>
                                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block mt-1 leading-relaxed">
                                        (خط العرض: {student.homeLocation.latitude.toFixed(4)}، خط الطول: {student.homeLocation.longitude.toFixed(4)})
                                    </span>
                                </div>
                                <a 
                                    href={`https://www.google.com/maps/dir/?api=1&destination=${student.homeLocation.latitude},${student.homeLocation.longitude}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-600 dark:hover:bg-blue-500 px-5 py-2.5 rounded-xl text-xs font-black shadow-lg transition active:scale-95 cursor-pointer"
                                >
                                    <MapPin size={14} />
                                    <span>فتح الاتجاهات 🧭</span>
                                </a>
                            </div>
                        ) : (
                            <div className="mt-3 p-3 bg-slate-50 dark:bg-[#0f172a]/30 border border-slate-150 dark:border-slate-800/80 rounded-xl text-center">
                                <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                                    📍 الموقع الجغرافي (GPS) غير مسجل حالياً.
                                </span>
                            </div>
                        )
                    )}
                </div>
            </div>
        );
    };

    const getVisitationHistory = () => {
        if (!student) return [];
        const list = [];

        if (student.homeVisitations) {
            Object.entries(student.homeVisitations).forEach(([monthKey, data]) => {
                list.push({
                    id: `home-${monthKey}`,
                    type: 'home',
                    period: monthKey,
                    status: data.status,
                    servantName: data.servantName || 'خادم غير معروف',
                    visitedBy: data.visitedBy || null,
                    timestamp: data.timestamp,
                    note: data.note || ''
                });
            });
        }

        if (student.phoneVisitations) {
            Object.entries(student.phoneVisitations).forEach(([weekKey, data]) => {
                list.push({
                    id: `phone-${weekKey}`,
                    type: 'phone',
                    period: weekKey,
                    status: data.status,
                    servantName: data.servantName || 'خادم غير معروف',
                    visitedBy: data.visitedBy || null,
                    timestamp: data.timestamp,
                    note: data.note || ''
                });
            });
        }

        list.sort((a, b) => {
            const getMillis = (item) => {
                if (item.timestamp) return new Date(item.timestamp).getTime();
                return new Date(item.period).getTime() || 0;
            };
            return getMillis(b) - getMillis(a);
        });

        return list;
    };

    const formatPeriod = (type, period) => {
        if (type === 'home') {
            const parts = period.split('-');
            const dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
            return `شهر ${dateObj.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' })}`;
        } else {
            const parts = period.split('-');
            const dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
            return `أسبوع الجمعة ${dateObj.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' })}`;
        }
    };

    const handleBack = () => {
        if (isGeneralAdmin) {
            navigate('/admin');
        } else {
            navigate('/servant/dashboard');
        }
    };

    return (
        <div className="max-w-6xl mx-auto px-4 py-8" dir="rtl">
            <header className="flex justify-between items-center mb-8">
                <div className="flex items-center gap-4">
                    <button onClick={handleBack} className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-200 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer">
                        <ArrowRight size={20} />
                    </button>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">بيانات المخدوم</h1>
                </div>
                {activeTab === 'info' && (
                    <button 
                        onClick={() => setEditMode(!editMode)} 
                        className={`px-6 py-2 rounded-lg font-bold transition-all ${
                            editMode ? 'bg-rose-100 text-rose-600 dark:bg-rose-955/30 dark:text-rose-400' : 'bg-blue-600 text-white shadow-md'
                        }`}
                    >
                        {editMode ? 'إلغاء التعديل' : 'تعديل البيانات'}
                    </button>
                )}
            </header>

            {/* Tabs Selector */}
            <div className="flex bg-slate-100/80 dark:bg-slate-800/80 backdrop-blur-sm p-1.5 rounded-2xl gap-2 mb-8 max-w-xl border border-slate-200/50 dark:border-slate-700/50 shadow-sm print:hidden">
                {[
                    { id: 'info', label: 'البيانات الأساسية', icon: <User size={18} /> },
                    { id: 'visitations', label: 'تاريخ الافتقاد', icon: <Activity size={18} /> },
                    { id: 'purchases', label: 'سجل المشتريات', icon: <ShoppingCart size={18} /> },
                    { id: 'traitsLog', label: 'سجل الصفات والنقاط', icon: <Star size={18} /> }
                ].map(tab => (
                    <button 
                        key={tab.id}
                        onClick={() => {
                            setActiveTab(tab.id);
                            if (tab.id !== 'info') setEditMode(false);
                        }}
                        className={`flex-1 py-3 px-4 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all ${
                            activeTab === tab.id 
                                ? 'bg-white dark:bg-[#1e293b] text-blue-600 dark:text-blue-400 shadow-md scale-[1.02]' 
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-white/40 dark:hover:bg-slate-700/40'
                        }`}
                    >
                        {tab.icon}
                        {tab.label}
                    </button>
                ))}
            </div>

            {activeTab === 'info' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-white dark:bg-[#1e293b] p-8 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
                            <div className="flex items-center gap-4 mb-8 pb-6 border-b border-slate-100 dark:border-slate-800">
                                <div 
                                    onClick={() => setIsPhotoModalOpen(true)}
                                    className="relative group shrink-0 cursor-pointer"
                                >
                                    <div className="w-16 h-16 rounded-xl overflow-hidden shadow-sm border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 flex items-center justify-center hover:scale-105 active:scale-95 transition-all duration-300">
                                        {student.photoUrl ? (
                                            <img src={student.photoUrl} alt={student.name} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-2xl font-bold uppercase">
                                                {student.name?.charAt(0)}
                                            </div>
                                        )}
                                    </div>
                                    <div className="absolute inset-0 bg-black/35 text-white flex items-center justify-center rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                                        🔍
                                    </div>
                                </div>
                                <div className="flex flex-col gap-1.5 items-start">
                                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{student.name}</h2>
                                    <p className="text-slate-400 font-bold dark:text-slate-500">كود: {student.code}</p>
                                    <button 
                                        onClick={() => {
                                            setActiveTab('traitsLog');
                                            window.scrollTo({ top: 0, behavior: 'smooth' });
                                        }}
                                        title="عرض سجل الصفات والنقاط"
                                        className="flex items-center gap-1.5 px-3 py-1 bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-full text-sm font-black shadow-sm hover:bg-amber-100/80 dark:hover:bg-amber-950/60 active:scale-95 transition-all cursor-pointer text-right outline-none"
                                    >
                                        <Star size={16} className="fill-amber-500 text-amber-500 animate-spin-slow" />
                                        <span>رصيد الصفات الكلي: {student.points || 0} صفة</span>
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {renderInput('الاسم', 'name', <User size={16}/>)}
                                {renderInput('الكود', 'code', <Hash size={16}/>)}
                                {renderInput('كلمة المرور', 'password', <Key size={16}/>)}
                                <div className="space-y-2">
                                    <label className="text-slate-500 dark:text-slate-400 text-sm font-semibold tracking-wide mb-1.5 flex items-center gap-1.5 justify-start">
                                        <Info size={16}/> المرحلة الدراسية
                                    </label>
                                    {editMode ? (
                                        <select
                                            className="w-full p-3 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 rounded-xl font-bold text-slate-800 dark:text-slate-100 disabled:opacity-50 disabled:cursor-not-allowed outline-none transition-all"
                                            value={formData.schoolGrade}
                                            onChange={e => setFormData({ ...formData, schoolGrade: e.target.value, assignedClass: '' })}
                                            disabled={shouldDisableStageDropdown}
                                        >
                                            <option value="">اختر المرحلة</option>
                                            {allowedStages.includes('ابتدائي') && <option value="ابتدائي">ابتدائي</option>}
                                            {allowedStages.includes('اعدادي') && <option value="اعدادي">اعدادي</option>}
                                            {allowedStages.includes('ثانوي') && <option value="ثانوي">ثانوي</option>}
                                        </select>
                                    ) : (
                                        <div className="bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 text-slate-900 dark:text-slate-100 font-medium text-center shadow-inner transition-all block w-full">{student.schoolGrade || <span className="text-slate-300 font-normal dark:text-slate-600">غير مسجل</span>}</div>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <label className="text-slate-500 dark:text-slate-400 text-sm font-semibold tracking-wide mb-1.5 flex items-center gap-1.5 justify-start">
                                        <Info size={16}/> الفصل
                                    </label>
                                    {editMode ? (
                                        <select
                                            className="w-full p-3 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 rounded-xl font-bold text-slate-800 dark:text-slate-100 disabled:opacity-50 disabled:cursor-not-allowed outline-none transition-all"
                                            value={formData.assignedClass}
                                            onChange={e => setFormData({ ...formData, assignedClass: e.target.value })}
                                            disabled={!formData.schoolGrade}
                                        >
                                            {!formData.schoolGrade
                                                ? <option value="" disabled>اختر المرحلة أولاً</option>
                                                : (
                                                    <>
                                                        <option value="">اختر الفصل</option>
                                                        {(STAGE_CLASS_MAP[formData.schoolGrade] || [])
                                                            .filter(cls => {
                                                                if (isGeneralAdmin) return true;
                                                                return allowedClasses.includes(normalizeArabic(cls));
                                                            })
                                                            .map(cls => (
                                                                <option key={cls} value={cls}>{cls}</option>
                                                            ))
                                                        }
                                                    </>
                                                )
                                            }
                                        </select>
                                    ) : (
                                        <div className="bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 text-slate-900 dark:text-slate-100 font-medium text-center shadow-inner transition-all block w-full">{student.assignedClass || <span className="text-slate-300 font-normal dark:text-slate-600">غير مسجل</span>}</div>
                                    )}
                                </div>
                                {renderInput('أب الاعتراف', 'fatherOfConfession', <Info size={16}/>)}
                                {renderInput('تاريخ الميلاد', 'birthDate', <CalendarDays size={16}/>, 'date')}
                            </div>

                            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                                {renderArrayInput('التليفونات', 'phones', <Smartphone size={16}/>, 'tel')}
                                {renderArrayInput('العناوين', 'addresses', <MapPin size={16}/>)}
                            </div>

                            {/* Parents Contacts Section */}
                            <div className="mt-8 pt-8 border-t border-slate-200 dark:border-slate-800">
                                <div className="flex justify-between items-center mb-4">
                                    <h4 className="text-sm font-bold text-slate-700 dark:text-slate-350 flex items-center gap-1.5 justify-start">
                                        <Smartphone size={16} className="text-blue-500" />
                                        أرقام أولياء الأمور (Parents Contacts)
                                    </h4>
                                    {editMode && (
                                        <button 
                                            type="button" 
                                            onClick={() => setFormData({ 
                                                ...formData, 
                                                parentsContacts: [...(formData.parentsContacts || []), { name: '', phone: '', relation: 'father' }] 
                                            })} 
                                            className="text-xs bg-blue-150 hover:bg-blue-200 text-blue-700 dark:bg-blue-950/40 dark:hover:bg-blue-950 dark:text-blue-400 font-bold px-3 py-1.5 rounded-lg border-none cursor-pointer flex items-center gap-1"
                                        >
                                            <Plus size={14} />
                                            <span>إضافة ولي أمر</span>
                                        </button>
                                    )}
                                </div>
                                
                                {editMode ? (
                                    <div className="space-y-3">
                                        {(formData.parentsContacts || []).length > 0 ? (
                                            formData.parentsContacts.map((contact, idx) => (
                                                <div key={idx} className="flex flex-col sm:flex-row gap-2 items-center bg-slate-50 dark:bg-[#0f172a] p-3 rounded-xl border border-slate-200 dark:border-slate-700 animate-in slide-in-from-right-2 duration-200">
                                                    <select
                                                        value={contact.relation}
                                                        onChange={e => {
                                                            const updated = [...formData.parentsContacts];
                                                            updated[idx] = { ...updated[idx], relation: e.target.value };
                                                            setFormData({ ...formData, parentsContacts: updated });
                                                        }}
                                                        className="w-full sm:w-32 p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-800 dark:text-slate-100 outline-none"
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
                                                            const updated = [...formData.parentsContacts];
                                                            updated[idx] = { ...updated[idx], name: e.target.value };
                                                            setFormData({ ...formData, parentsContacts: updated });
                                                        }}
                                                        className="flex-1 w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-800 dark:text-slate-100 outline-none"
                                                    />
                                                    <input 
                                                        type="tel" 
                                                        placeholder="رقم الهاتف" 
                                                        value={contact.phone} 
                                                        onChange={e => {
                                                            const updated = [...formData.parentsContacts];
                                                            updated[idx] = { ...updated[idx], phone: e.target.value };
                                                            setFormData({ ...formData, parentsContacts: updated });
                                                        }}
                                                        dir="ltr"
                                                        className="flex-1 w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-800 dark:text-slate-100 outline-none"
                                                    />
                                                    <button 
                                                        type="button" 
                                                        onClick={() => {
                                                            const updated = formData.parentsContacts.filter((_, i) => i !== idx);
                                                            setFormData({ ...formData, parentsContacts: updated });
                                                        }} 
                                                        className="p-3 bg-rose-100 dark:bg-rose-955/40 text-rose-600 dark:text-rose-400 rounded-lg border-none cursor-pointer hover:bg-rose-200 dark:hover:bg-rose-900"
                                                    >
                                                        <X size={20} />
                                                    </button>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="text-center p-4 bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-450 font-medium">
                                                لا يوجد أرقام أولياء أمور مسجلة. اضغط على "+ إضافة ولي أمر" للبدء.
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {(student.parentsContacts || []).length > 0 ? (
                                            (student.parentsContacts || []).map((contact, idx) => {
                                                const relationLabel = contact.relation === 'father' ? 'أب' : contact.relation === 'mother' ? 'أم' : 'غيره';
                                                const relationBg = contact.relation === 'father' ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-100 dark:border-blue-900/30' : contact.relation === 'mother' ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30' : 'bg-slate-100 text-slate-650 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700';
                                                
                                                const handleCall = () => {
                                                    navigator.clipboard.writeText(contact.phone)
                                                        .then(() => showToast(`تم نسخ رقم الهاتف وجاري الاتصال بـ ${contact.name || relationLabel} 📞`, 'success'))
                                                        .catch(err => {
                                                            console.error("Clipboard copy failed", err);
                                                            showToast(`جاري الاتصال بـ ${contact.name || relationLabel} 📞`, 'success');
                                                        });
                                                    setTimeout(() => {
                                                        window.location.href = `tel:${contact.phone}`;
                                                    }, 150);
                                                };

                                                return (
                                                    <div 
                                                        key={idx} 
                                                        onClick={handleCall}
                                                        className="flex items-center justify-between bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 shadow-inner transition-all cursor-pointer hover:bg-slate-100 dark:hover:bg-[#0f172a]/80 hover:shadow-md hover:scale-[1.01] active:scale-[0.99] select-none animate-in fade-in duration-200"
                                                        title="اضغط للنسخ والاتصال"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <span className={`text-xs font-black px-2 py-1 rounded-md ${relationBg}`}>
                                                                {relationLabel}
                                                            </span>
                                                            <div className="text-right">
                                                                <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">
                                                                    {contact.name || relationLabel}
                                                                </span>
                                                                <span className="block text-xs font-semibold text-slate-400 dark:text-slate-500 dir-ltr">
                                                                    {contact.phone}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className="p-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 rounded-lg">
                                                            <PhoneCall size={16} />
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <div className="col-span-2 bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 text-slate-400 dark:text-slate-500 font-medium text-center shadow-inner">
                                                لا يوجد أرقام أولياء أمور مسجلة لهذا المخدوم
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {editMode && (
                                <button onClick={handleSave} className="w-full mt-8 bg-blue-600 text-white py-4 rounded-lg font-bold hover:bg-blue-700 shadow-md">
                                    حفظ جميع التعديلات
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="bg-white dark:bg-[#1e293b] p-8 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
                            <h3 className="text-xl font-bold mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-slate-800 dark:text-slate-100">
                                <span className="flex items-center gap-2">
                                    <CalendarDays size={20} className="text-emerald-500" /> سجل الحضور
                                </span>
                                <div className="flex flex-wrap gap-2">
                                    <span className="text-xs bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-250 dark:border-emerald-800 px-3 py-1.5 rounded-full font-black">
                                        ⛪ إجمالي حضور القداس: {student.liturgyAttendance ? student.liturgyAttendance.length : 0}
                                    </span>
                                    <span className="text-xs bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border border-blue-250 dark:border-blue-800 px-3 py-1.5 rounded-full font-black">
                                        🏫 إجمالي حضور الخدمة: {student.attendance ? student.attendance.length : 0}
                                    </span>
                                </div>
                            </h3>
                            {!isAttendedToday && (
                                <div className="space-y-4 mb-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                                    <div className="flex items-center gap-2.5 p-2 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-850 shadow-sm">
                                        <span className="text-sm font-black text-slate-700 dark:text-slate-300 select-none px-1">نقاط الحضور:</span>
                                        <input 
                                            type="number" 
                                            value={attendancePointsInput} 
                                            onChange={(e) => setAttendancePointsInput(e.target.value)}
                                            className={`w-24 text-center bg-transparent border-none outline-none focus:outline-none focus:ring-0 font-black text-lg ${
                                                !isPointsValid 
                                                ? 'text-wight dark:bg-rose-95/20 border border-rose-300 dark:border-rose-800 rounded-lg' 
                                                : 'text-slate-900 dark:text-white'
                                            }`}
                                            placeholder="مطلوب"
                                            min="0"
                                        />
                                    </div>
                                    
                                    <div className="flex flex-wrap gap-1.5 items-center">
                                        {shortcuts.map(val => (
                                            <div key={val} className="flex items-center bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800 rounded-lg overflow-hidden text-xs">
                                                <button onClick={() => setAttendancePointsInput(String(val))} className="pl-2.5 pr-1.5 py-1 font-black bg-transparent transition-all hover:bg-purple-100/50 dark:hover:bg-purple-900/30">
                                                    {val}+
                                                </button>
                                                <button onClick={() => removeShortcut(val)} className="pr-2 pl-1 py-1 text-slate-400 hover:text-rose-500 transition-colors bg-transparent border-none">
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        ))}
                                        <button onClick={() => setShowAddShortcut(true)} className="px-2 py-1 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800 border-dashed rounded-lg text-xs hover:bg-purple-50 dark:hover:bg-purple-955/20 font-bold">+</button>
                                    </div>

                                    {showAddShortcut && (
                                        <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                                            <input 
                                                type="number" 
                                                value={newShortcut}
                                                onChange={e => setNewShortcut(e.target.value)}
                                                className="w-20 px-2 py-1 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                                                placeholder="القيمة..."
                                            />
                                            <button onClick={addNewShortcut} className="bg-indigo-600 dark:bg-indigo-700 hover:bg-indigo-700 dark:hover:bg-indigo-600 text-white px-3 py-1 rounded-lg text-[10px] font-bold">إضافة</button>
                                            <button onClick={() => setShowAddShortcut(false)} className="text-slate-400 hover:text-slate-600"><X size={14}/></button>
                                        </div>
                                    )}
                                </div>
                            )}
                            <button 
                                onClick={() => markAttendance(Number(attendancePointsInput))} 
                                disabled={isAttendedToday || !isPointsValid} 
                                className={`w-full py-4 rounded-lg font-bold shadow-sm transition-all ${
                                    isAttendedToday 
                                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-555 cursor-not-allowed' 
                                    : (isPointsValid ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-555 cursor-not-allowed')
                                }`}
                            >
                                {isAttendedToday ? 'تم تسجيل حضور اليوم' : 'تسجيل حضور سريع'}
                            </button>
                            
                            <div className="mt-6 space-y-2 max-h-[300px] overflow-y-auto pr-1">
                                {(!student.attendance || student.attendance.length === 0) ? (
                                    <p className="text-center text-slate-400 dark:text-slate-500 py-4">لا يوجد سجل</p>
                                ) : (
                                    [...student.attendance].reverse().map((d, i) => {
                                        const attendedLiturgy = student.liturgyAttendance?.includes(d);
                                        return (
                                            <div key={i} className="flex justify-between items-center bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border border-slate-100 dark:border-slate-800 group">
                                                <div className="flex items-center gap-4">
                                                    <span className="text-sm font-bold text-slate-700 dark:text-slate-350">{new Date(d).toLocaleDateString('ar-EG')}</span>
                                                    <span className={`text-[11px] font-black px-2 py-0.5 rounded-full border ${
                                                        attendedLiturgy
                                                        ? 'bg-emerald-50 dark:bg-emerald-950/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/85'
                                                        : 'bg-rose-50 dark:bg-rose-950/10 text-rose-500 dark:text-rose-400 border-rose-100 dark:border-rose-955/20'
                                                    }`}>
                                                        {attendedLiturgy ? '⛪ حضر القداس' : '❌ لم يحضر القداس'}
                                                    </span>
                                                </div>
                                                <button onClick={() => removeAttendance(d)} className="text-rose-400 dark:text-rose-500 opacity-0 group-hover:opacity-100 hover:text-rose-600 dark:hover:text-rose-400"><Trash2 size={16}/></button>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {/* كارت متابعة الاعترافات */}
                        <div className="bg-white dark:bg-[#1e293b] p-8 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
                            <h3 className="text-xl font-bold mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-slate-800 dark:text-slate-100">
                                <div className="flex flex-wrap items-center gap-3">
                                    <span className="flex items-center gap-2">
                                        <BookOpen size={20} className="text-blue-500" /> متابعة الاعترافات ⛪
                                    </span>
                                    <div className="flex items-center gap-1.5 print:hidden">
                                        <select 
                                            value={confessionMonth} 
                                            onChange={(e) => setConfessionMonth(e.target.value)}
                                            className="p-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded font-bold text-xs text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                                        >
                                            {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(m => (
                                                <option key={m} value={m}>{new Date(2026, parseInt(m, 10) - 1, 1).toLocaleDateString('ar-EG', { month: 'long' })}</option>
                                            ))}
                                        </select>
                                        <select 
                                            value={confessionYear} 
                                            onChange={(e) => setConfessionYear(e.target.value)}
                                            className="p-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded font-bold text-xs text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                                        >
                                            {Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - 2 + i)).map(y => (
                                                <option key={y} value={y}>{y}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <span className="text-xs bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400 border border-purple-250 dark:border-purple-800 px-3 py-1.5 rounded-full font-black self-start sm:self-auto">
                                    إجمالي الاعترافات: {Object.values(student.confessions || {}).filter(c => c && c.status === true).length}
                                </span>
                            </h3>

                            {(() => {
                                const monthKey = `${confessionMonth}-${confessionYear}`;
                                const selectedDate = new Date(parseInt(confessionYear, 10), parseInt(confessionMonth, 10) - 1, 1);
                                const monthNameAr = selectedDate.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
                                const currentConfession = student.confessions?.[monthKey];
                                const isConfessed = currentConfession?.status === true;

                                return (
                                    <div className="space-y-4">
                                        <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                                            <div className="flex justify-between items-center mb-3">
                                                <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">اعتراف الشهر المحدد</span>
                                                <span className="text-sm font-black text-slate-800 dark:text-slate-100">{monthNameAr}</span>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={handleToggleConfession}
                                                disabled={isMutatingConfession}
                                                className={`w-full py-3 px-4 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all border cursor-pointer active:scale-95 ${
                                                    isConfessed
                                                    ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-450 border-emerald-250 dark:border-emerald-800/80 hover:bg-emerald-100/50 dark:hover:bg-emerald-950/30'
                                                    : 'bg-slate-100 dark:bg-[#0f172a] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:bg-slate-200 dark:hover:bg-slate-850'
                                                }`}
                                            >
                                                {isConfessed ? (
                                                    <>
                                                        <CheckCircle size={15} className="text-emerald-500" />
                                                        <span>تم الاعتراف (اضغط للإلغاء)</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <XCircle size={15} className="text-slate-400" />
                                                        <span>لم يسجل بعد (اضغط للتسجيل)</span>
                                                    </>
                                                )}
                                            </button>

                                            {isConfessed && currentConfession && (
                                                <div className="mt-3 pt-3 border-t border-slate-200/65 dark:border-slate-800/80 text-[11px] font-semibold text-slate-500 dark:text-slate-400 space-y-1">
                                                    <div>
                                                        👤 سجل بواسطة: <span className="text-slate-700 dark:text-slate-200 font-bold">{currentConfession.markedBy}</span>
                                                    </div>
                                                    {currentConfession.date && (
                                                        <div>
                                                            📅 التاريخ: <span className="text-slate-700 dark:text-slate-200 font-bold" dir="ltr">{new Date(currentConfession.date).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        <div className="bg-white dark:bg-[#1e293b] p-8 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
                            <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-slate-800 dark:text-slate-100">
                                <Star size={20} className="text-amber-500" /> نقاط إضافية
                            </h3>
                            <div className="space-y-4">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-sm font-bold text-slate-500 dark:text-slate-400 select-none">عدد الصفات:</span>
                                    <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900 p-1 rounded-lg border border-slate-200 dark:border-slate-800">
                                        <button onClick={() => setPointAmount(Math.max(0, pointAmount - 1))} className="w-8 h-8 font-bold text-slate-700 dark:text-slate-300">-</button>
                                        <input 
                                            type="number" 
                                            value={pointAmount || ''} 
                                            onChange={e => setPointAmount(Math.max(0, parseInt(e.target.value, 10) || 0))} 
                                            className="w-16 text-center bg-transparent border-none outline-none focus:ring-0 font-bold text-lg text-slate-800 dark:text-slate-100 min-w-0"
                                            placeholder="0"
                                        />
                                        <button onClick={() => setPointAmount(pointAmount + 1)} className="w-8 h-8 font-bold text-slate-700 dark:text-slate-300">+</button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <button onClick={handleAddPoints} disabled={isMutatingPoints} className="bg-emerald-500 text-white py-3 rounded-lg font-bold hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">إضافة عامة</button>
                                    <button onClick={handleSubtractPoints} disabled={isMutatingPoints} className="bg-rose-500 text-white py-3 rounded-lg font-bold hover:bg-rose-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">خصم عام</button>
                                </div>
                            </div>
                        </div>

                        {(() => {
                            const safeClassId = student.assignedClass ? student.assignedClass.replace(/\//g, '-') : '';
                            const consecutiveGiftEnabled = !!attendanceConfigs[safeClassId]?.consecutiveGiftEnabled;
                            if (!consecutiveGiftEnabled) return null;
                            return (
                                <div className="bg-white dark:bg-[#1e293b] p-8 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 transition-colors">
                                    <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-slate-800 dark:text-slate-100">
                                        🎁 نظام مكافأة الالتزام
                                    </h3>
                                    <div className="flex justify-around items-center mb-6">
                                        <div className="text-center">
                                            <div className="text-slate-500 dark:text-slate-400 text-xs font-semibold mb-1">الالتزام المتتالي</div>
                                            <div className="text-2xl font-black text-orange-500 flex items-center justify-center gap-1" dir="ltr">
                                                <span>🔥</span>
                                                <span>{student.attendanceStreak || 0}</span>
                                            </div>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-slate-500 dark:text-slate-400 text-xs font-semibold mb-1">الهدايا المعلقة</div>
                                            <div className="text-2xl font-black text-amber-500 flex items-center justify-center gap-1">
                                                <span>🎁</span>
                                                <span>{student.pendingGifts || 0}</span>
                                            </div>
                                        </div>
                                    </div>
                                    {(student.pendingGifts || 0) > 0 && (
                                        <button 
                                            onClick={() => claimGift(student.id, student.pendingGifts)} 
                                            className="w-full bg-amber-500 hover:bg-amber-600 text-white py-3 rounded-lg font-bold transition-all shadow-md"
                                        >
                                            تسليم هدية للمخدوم
                                        </button>
                                    )}
                                </div>
                            );
                        })()}

                    </div>
                </div>
            )}

            {activeTab === 'visitations' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="bg-white dark:bg-[#1e293b] p-8 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
                            <h3 className="text-xl font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100">
                                <Activity size={20} className="text-indigo-500" /> سجل الافتقاد الكامل للمخدوم
                            </h3>
                            
                            {/* Sub-tabs Selector */}
                            <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl gap-1 w-full sm:w-auto">
                                {[
                                    { id: 'home', label: 'الافتقاد المنزلي', icon: <Home size={16} /> },
                                    { id: 'phone', label: 'الافتقاد التليفوني', icon: <PhoneCall size={16} /> }
                                ].map(subTab => (
                                    <button
                                        key={subTab.id}
                                        onClick={() => setVisitationSubTab(subTab.id)}
                                        className={`flex-1 sm:flex-initial py-2 px-4 rounded-lg font-black text-xs flex items-center justify-center gap-1.5 transition-all ${
                                            visitationSubTab === subTab.id
                                                ? 'bg-white dark:bg-[#1e293b] text-indigo-600 dark:text-indigo-400 shadow-sm'
                                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                        }`}
                                    >
                                        {subTab.icon}
                                        {subTab.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Render Sub-tab Content */}
                        {(() => {
                            const records = getVisitationHistory().filter(r => r.type === visitationSubTab);
                            if (records.length === 0) {
                                return (
                                    <div className="py-16 text-center flex flex-col items-center justify-center gap-4">
                                        <Activity size={48} className="text-slate-300 animate-pulse" />
                                        <p className="text-lg font-bold text-slate-400 dark:text-slate-500">
                                            {visitationSubTab === 'home' ? 'لا توجد زيارات منزلية مسجلة بعد' : 'لا توجد مكالمات هاتفية مسجلة بعد'}
                                        </p>
                                    </div>
                                );
                            }

                            return (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {records.map((record) => {
                                        const isHome = record.type === 'home';
                                        const isMissed = record.status === 'missed';
                                        const isLate = record.status === 'late_attended';

                                        // Determine colors
                                        let borderColor = 'border-emerald-200';
                                        let leftBorder = 'border-r-4 border-r-emerald-500';
                                        let statusBg = 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/50';
                                        let statusLabel = isHome ? 'تمت الزيارة المنزلية' : 'تم التواصل الهاتفي';

                                        if (isMissed) {
                                            borderColor = 'border-rose-200';
                                            leftBorder = 'border-r-4 border-r-rose-500';
                                            statusBg = 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-955/30 dark:text-rose-400 dark:border-rose-900/50';
                                            statusLabel = 'لم يتم الافتقاد';
                                        } else if (isLate) {
                                            borderColor = 'border-amber-200';
                                            leftBorder = 'border-r-4 border-r-amber-500';
                                            statusBg = 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-955/30 dark:text-amber-400 dark:border-amber-900/50';
                                            statusLabel = 'تم (متابعة متأخرة)';
                                        }

                                        return (
                                            <div 
                                                key={record.id} 
                                                className={`bg-white dark:bg-[#1e293b] p-5 rounded-2xl border ${borderColor} dark:border-slate-800 ${leftBorder} shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between`}
                                            >
                                                <div>
                                                    <div className="flex justify-between items-center mb-4">
                                                        <span className={`text-xs font-black px-3 py-1 rounded-full ${statusBg}`}>
                                                            {statusLabel}
                                                        </span>
                                                        <span className="text-xs font-black text-slate-400 dark:text-slate-500 flex items-center gap-1">
                                                            {isHome ? <Home size={14} className="text-slate-400 dark:text-slate-500" /> : <PhoneCall size={14} className="text-slate-400 dark:text-slate-500" />}
                                                            {isHome ? 'افتقاد منزلي' : 'افتقاد تلفوني'}
                                                        </span>
                                                    </div>

                                                    <h4 className="font-black text-slate-800 dark:text-slate-100 text-lg mb-2">
                                                        {formatPeriod(record.type, record.period)}
                                                    </h4>

                                                    <div className="space-y-4 text-sm font-bold mb-4">
                                                        <p className="text-slate-500 dark:text-slate-200">
                                                            {isHome ? 'الخدام المسؤولين: ' : 'الخادم المتصل: '}
                                                            <span className="text-slate-700 dark:text-white font-black">
                                                                {record.visitedBy ? record.visitedBy.join(' ، ') : (record.servantName || 'خادم غير معروف')}
                                                            </span>
                                                        </p>
                                                        {record.timestamp && (
                                                            <div className="space-y-2">
                                                                <label className="text-slate-500 dark:text-slate-400 text-sm font-semibold tracking-wide mb-1.5 flex items-center gap-1.5 justify-start">
                                                                    <CalendarDays size={16} /> تاريخ الافتقاد
                                                                </label>
                                                                <div className="bg-slate-50 dark:bg-[#0f172a]/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 text-slate-900 dark:text-slate-100 font-medium text-center shadow-inner transition-all block w-full">
                                                                    {new Date(record.timestamp).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {record.note && (
                                                    <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 p-3 rounded-xl mt-2">
                                                        <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-1">ملاحظة الخادم:</p>
                                                        <p className="text-sm font-semibold text-slate-600 dark:text-slate-350 italic">"{record.note}"</p>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })()}
                    </div>
                </div>
            )}

            {activeTab === 'purchases' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="bg-white dark:bg-[#1e293b] p-8 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
                        <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-slate-800 dark:text-slate-100">
                            <ShoppingCart size={20} className="text-blue-500" /> سجل مشتريات الطالب من معرض الصفات
                        </h3>

                        {ordersLoading ? (
                            <div className="space-y-4">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="animate-pulse bg-slate-50 dark:bg-slate-900/50 p-6 rounded-2xl border border-slate-100 dark:border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                        <div className="space-y-3 flex-1 w-full">
                                            <div className="h-6 bg-slate-200 dark:bg-slate-850 rounded-lg w-1/3"></div>
                                            <div className="h-4 bg-slate-200 dark:bg-slate-850 rounded-lg w-1/4"></div>
                                        </div>
                                        <div className="h-8 bg-slate-200 dark:bg-slate-850 rounded-lg w-24"></div>
                                    </div>
                                ))}
                            </div>
                        ) : orders.length === 0 ? (
                            <div className="py-16 text-center flex flex-col items-center justify-center gap-4">
                                <ShoppingCart size={48} className="text-slate-300 dark:text-slate-600" />
                                <p className="text-lg font-bold text-slate-400 dark:text-slate-500">لا توجد مشتريات مسجلة لهذا المخدوم بعد</p>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {orders.map((order) => (
                                    <div 
                                        key={order.id} 
                                        className="bg-slate-50/50 dark:bg-slate-900/30 p-6 rounded-2xl border border-slate-100 dark:border-slate-800 hover:border-blue-100 dark:hover:border-blue-900 transition-all duration-300 flex flex-col md:flex-row md:items-center justify-between gap-6"
                                    >
                                        <div className="space-y-3 flex-1">
                                            <div className="flex items-center gap-3">
                                                <span className="font-mono text-xs font-black bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700">
                                                    #{order.id.slice(-6).toUpperCase()}
                                                </span>
                                                <span className="text-sm font-bold text-slate-400 dark:text-slate-500">
                                                    {order.createdAt && new Date(typeof order.createdAt.toDate === 'function' ? order.createdAt.toDate() : order.createdAt).toLocaleDateString('ar-EG', {
                                                        day: 'numeric',
                                                        month: 'long',
                                                        year: 'numeric',
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                    })}
                                                </span>
                                            </div>

                                            {/* Items List */}
                                            <div className="space-y-2">
                                                {order.items?.map((item, idx) => (
                                                    <div key={idx} className="flex justify-between items-center bg-white dark:bg-[#1e293b] p-3 rounded-xl border border-slate-100/80 dark:border-slate-800 max-w-md shadow-sm">
                                                        <span className="font-black text-slate-700 dark:text-slate-200 text-sm">{item.name}</span>
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-xs text-slate-400 dark:text-slate-500 font-bold">الكمية: {item.quantity}</span>
                                                            <span className="text-sm font-black text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-955/30 border border-amber-100 dark:border-amber-900/50 px-2 py-0.5 rounded-lg">
                                                                {item.price * item.quantity} نقطة
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="flex md:flex-col items-start md:items-end justify-between md:justify-center gap-3 border-t md:border-t-0 border-slate-100 dark:border-slate-800 pt-4 md:pt-0">
                                            <div className="text-sm font-bold text-slate-500 dark:text-slate-400">
                                                إجمالي التكلفة: <span className="text-blue-600 dark:text-blue-400 font-black text-lg">{order.totalCost || 0}</span> نقطة
                                            </div>
                                            <div>
                                                {order.status === 'delivered' ? (
                                                    <span className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-400 px-4 py-1.5 rounded-full text-xs font-black shadow-sm">
                                                        <Check size={14} /> تم التسليم
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 dark:bg-amber-955/30 dark:border-amber-900/50 text-amber-700 dark:text-amber-400 px-4 py-1.5 rounded-full text-xs font-black shadow-sm animate-pulse">
                                                        <Clock size={14} /> قيد الانتظار
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'traitsLog' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="bg-white dark:bg-[#1e293b] p-8 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
                        <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-slate-800 dark:text-slate-100">
                            <Star size={20} className="text-amber-500" /> سجل الصفات وتعديلات النقاط
                        </h3>

                        {traitsLoading ? (
                            <div className="space-y-4">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="animate-pulse bg-slate-50 dark:bg-slate-900/50 p-6 rounded-2xl border border-slate-100 dark:border-slate-800 flex justify-between items-center">
                                        <div className="h-6 bg-slate-200 dark:bg-slate-850 rounded-lg w-1/3 mb-2"></div>
                                        <div className="h-8 bg-slate-200 dark:bg-slate-850 rounded-lg w-16"></div>
                                    </div>
                                ))}
                            </div>
                        ) : traitsLog.length === 0 ? (
                            <div className="py-16 text-center flex flex-col items-center justify-center gap-4">
                                <Star size={48} className="text-slate-300 dark:text-slate-600" />
                                <p className="text-lg font-bold text-slate-400 dark:text-slate-500">لا يوجد سجل لتعديل النقاط والصفات لهذا المخدوم بعد</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {traitsLog.map((log) => {
                                    const amount = log.amount || 0;
                                    const isPositive = amount > 0;
                                    return (
                                        <div 
                                            key={log.id} 
                                            className="bg-slate-50 dark:bg-slate-900/30 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 hover:border-blue-100 dark:hover:border-blue-900 transition-all duration-300 flex items-center justify-between gap-4 shadow-sm"
                                        >
                                            <div className="space-y-2">
                                                <h4 className="font-black text-slate-800 dark:text-slate-200 text-lg">
                                                    {log.reason || 'تعديل نقاط'}
                                                </h4>
                                                <div className="text-sm font-bold text-slate-400 dark:text-slate-500 flex items-center gap-2">
                                                    <Clock size={14} />
                                                    {log.createdAt ? new Date(typeof log.createdAt.toDate === 'function' ? log.createdAt.toDate() : (log.createdAt.seconds ? log.createdAt.seconds * 1000 : log.createdAt)).toLocaleDateString('ar-EG', {
                                                        day: 'numeric',
                                                        month: 'long',
                                                        year: 'numeric',
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                    }) : 'تاريخ غير معروف'}
                                                </div>
                                            </div>
                                            
                                            <div className={`px-5 py-2 rounded-xl font-black text-xl flex items-center justify-center min-w-[80px] shadow-sm ${
                                                isPositive 
                                                    ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50' 
                                                    : 'bg-rose-100 dark:bg-rose-955/30 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50'
                                            }`}>
                                                <span dir="ltr">{isPositive ? '+' : ''}{amount}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
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

            {/* Modal for viewing student photo in large size */}
            {isPhotoModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/85 backdrop-blur-md transition-all duration-300 animate-in fade-in">
                    {/* Modal Container */}
                    <div className="relative max-w-md w-full bg-transparent flex flex-col items-center gap-4">
                        {/* Header controls: Back button and Edit Pencil button */}
                        <div className="flex justify-between items-center w-full px-2">
                            <button
                                onClick={() => setIsPhotoModalOpen(false)}
                                className="p-2.5 bg-white/10 hover:bg-white/20 active:scale-95 text-white rounded-full transition-all cursor-pointer border-none outline-none flex items-center justify-center"
                                title="رجوع"
                            >
                                <ArrowRight size={22} />
                            </button>
                            <div className="flex gap-2">
                                <label
                                    htmlFor="servant-photo-upload-input-modal"
                                    className="p-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-full transition-all cursor-pointer flex items-center justify-center shadow-lg"
                                    title="تعديل الصورة الشخصية"
                                >
                                    <Edit size={20} />
                                </label>
                                <input
                                    type="file"
                                    id="servant-photo-upload-input-modal"
                                    className="hidden"
                                    accept="image/*"
                                    onChange={(e) => {
                                        handlePhotoUpload(e);
                                    }}
                                />
                            </div>
                        </div>

                        {/* Large Image Frame */}
                        <div className="w-80 h-80 sm:w-96 sm:h-96 rounded-3xl overflow-hidden shadow-2xl border-2 border-white/20 bg-slate-950 flex items-center justify-center animate-in zoom-in-95 duration-300">
                            {student.photoUrl ? (
                                <img src={student.photoUrl} alt={student.name} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-8xl font-bold uppercase">
                                    {student.name?.charAt(0)}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
