import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, addDoc, updateDoc, doc, deleteDoc, onSnapshot, query, orderBy, setDoc, db } from '../firebase';
import { 
    Plus, 
    Edit2, 
    Trash2, 
    Image as ImageIcon, 
    X, 
    Clock, 
    Save, 
    ToggleLeft, 
    ToggleRight,
    Star,
    Package
} from 'lucide-react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const STAGE_CLASS_MAP = {
    'ابتدائي': ['حضانة/ملائكة', 'أولى ابتدائى', 'ثانية ابتدائى', 'ثالع فصول ابتدائي', 'ثالثة ابتدائى', 'رابعة ابتدائى', 'خامسة ابتدائى', 'سادسة ابتدائي'],
    'اعدادي': ['اولي اعدادي', 'تانيه اعدادي', 'تالته اعدادي'],
    'ثانوي': ['اولي ثانوي', 'تانيه ثانوي', 'تالته ثانوي'],
};

// Override map for consistency with standard map
STAGE_CLASS_MAP['ابتدائي'] = ['حضانة/ملائكة', 'أولى ابتدائى', 'ثانية ابتدائى', 'ثالثة ابتدائى', 'رابعة ابتدائى', 'خامسة ابتدائى', 'سادسة ابتدائي'];

const normalizeArabic = (str) => {
    if (!str) return '';
    return str
        .replace(/[أإآا]/g, 'ا')
        .replace(/[ىي]/g, 'ي')
        .replace(/[ةه]/g, 'ه')
        .trim();
};

const cleanArabicStr = (str) => {
    if (!str) return '';
    return str.toString().trim()
        .replace(/[ى]/g, 'ي')
        .replace(/[إأآ]/g, 'ا')
        .replace(/\s+/g, ' ');
};

const getSafeClassId = (className) => {
    if (!className) return '';
    return className.replace(/\//g, '-');
};

function StoreSchedulePanel({ 
    isGeneralAdmin, 
    isServant, 
    servant, 
    myStage, 
    myClass, 
    myClasses, 
    roleNorm,
    storeFilterStage,
    storeFilterClass
}) {
    const { authorizedClasses } = useAuth();
    const [isManualOpen, setIsManualOpen] = useState(false);
    const [storeVisible, setStoreVisible] = useState(true);
    const [durationMode, setDurationMode] = useState('always');
    const [customDays, setCustomDays] = useState('');
    const [currentExpiry, setCurrentExpiry] = useState(null);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');

    const targetDocId = useMemo(() => {
        if (storeFilterStage === 'الكل') return 'global';
        if (!storeFilterClass) return `stage-${storeFilterStage}`;
        return getSafeClassId(storeFilterClass);
    }, [storeFilterStage, storeFilterClass]);

    const subtitle = useMemo(() => {
        if (storeFilterStage === 'الكل') {
            return 'تعديل إعدادات: كل المراحل والفصول في الكنيسة 🌍';
        }
        if (!storeFilterClass) {
            return `تعديل إعدادات: مرحلة ${storeFilterStage} بالكامل 🏫`;
        }
        return `تعديل إعدادات: فصل ${storeFilterClass} 📌`;
    }, [storeFilterStage, storeFilterClass]);

    useEffect(() => {
        if (!targetDocId) return;

        const docRef = doc(db, 'store_config', targetDocId);
        const unsub = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setCurrentExpiry(data.expiryDate || null);
                setIsManualOpen(data.storeEnabled !== undefined ? data.storeEnabled : (data.isOpen !== undefined ? data.isOpen : false));
                setStoreVisible(data.storeVisible !== undefined ? data.storeVisible : true);
            } else {
                setIsManualOpen(false);
                setStoreVisible(true);
                setCurrentExpiry(null);
            }
        });
        return () => unsub();
    }, [targetDocId]);

    const toggleManualStatus = async () => {
        if (!targetDocId) return;
        try {
            const newState = !isManualOpen;
            setIsManualOpen(newState);
            const docRef = doc(db, 'store_config', targetDocId);
            await setDoc(docRef, {
                storeEnabled: newState,
                isOpen: newState, 
                lastUpdatedBy: servant?.name || 'admin',
                updatedAt: new Date().toISOString()
            }, { merge: true });

            if (storeFilterStage !== 'الكل' && storeFilterClass) {
                const legacyRef = doc(db, 'store_status_config', targetDocId);
                await setDoc(legacyRef, {
                    isOpen: newState,
                    lastUpdatedBy: servant?.name || 'admin',
                    updatedAt: new Date().toISOString()
                }, { merge: true });
            }

            // Cascade to all classes if "All Classes" (empty class filter) is selected
            if (!storeFilterClass) {
                let classesToUpdate = [];
                if (isGeneralAdmin) {
                    if (storeFilterStage === 'الكل') {
                        classesToUpdate = Object.values(STAGE_CLASS_MAP).flat();
                    } else {
                        classesToUpdate = STAGE_CLASS_MAP[storeFilterStage] || [];
                    }
                } else {
                    classesToUpdate = authorizedClasses || [];
                }

                const promises = classesToUpdate.map(async (className) => {
                    const classId = getSafeClassId(className);
                    if (!classId) return;
                    
                    const classDocRef = doc(db, 'store_config', classId);
                    await setDoc(classDocRef, {
                        storeEnabled: newState,
                        isOpen: newState,
                        lastUpdatedBy: servant?.name || 'admin',
                        updatedAt: new Date().toISOString()
                    }, { merge: true });

                    const classLegacyRef = doc(db, 'store_status_config', classId);
                    await setDoc(classLegacyRef, {
                        isOpen: newState,
                        lastUpdatedBy: servant?.name || 'admin',
                        updatedAt: new Date().toISOString()
                    }, { merge: true });
                });
                await Promise.all(promises);
            }

            setMessage(newState ? 'تم تفعيل معرض الصفات 🔓' : 'تم إغلاق معرض الصفات يدوياً 🔒');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error('Error toggling status:', error);
            alert('حدث خطأ أثناء تعديل حالة معرض الصفات');
        }
    };

    const toggleVisibilityStatus = async () => {
        if (!targetDocId) return;
        try {
            const newState = !storeVisible;
            setStoreVisible(newState);
            const docRef = doc(db, 'store_config', targetDocId);
            await setDoc(docRef, {
                storeVisible: newState,
                lastUpdatedBy: servant?.name || 'admin',
                updatedAt: new Date().toISOString()
            }, { merge: true });

            // Cascade to all classes if "All Classes" (empty class filter) is selected
            if (!storeFilterClass) {
                let classesToUpdate = [];
                if (isGeneralAdmin) {
                    if (storeFilterStage === 'الكل') {
                        classesToUpdate = Object.values(STAGE_CLASS_MAP).flat();
                    } else {
                        classesToUpdate = STAGE_CLASS_MAP[storeFilterStage] || [];
                    }
                } else {
                    classesToUpdate = authorizedClasses || [];
                }

                const promises = classesToUpdate.map(async (className) => {
                    const classId = getSafeClassId(className);
                    if (!classId) return;
                    
                    const classDocRef = doc(db, 'store_config', classId);
                    await setDoc(classDocRef, {
                        storeVisible: newState,
                        lastUpdatedBy: servant?.name || 'admin',
                        updatedAt: new Date().toISOString()
                    }, { merge: true });
                });
                await Promise.all(promises);
            }

            setMessage(newState ? 'تم إظهار معرض الصفات للمخدومين ✅' : 'تم إخفاء معرض الصفات للمخدومين تماماً 🔒');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error('Error toggling visibility:', error);
            alert('حدث خطأ أثناء تعديل ظهور معرض الصفات');
        }
    };

    const handleSaveSchedule = async () => {
        if (!targetDocId) return;
        let newExpiry = null;
        if (durationMode !== 'always') {
            let days = parseInt(durationMode, 10);
            if (durationMode === 'custom') {
                days = parseInt(customDays, 10);
                if (!days || days <= 0) {
                    setMessage('الرجاء إدخال عدد أيام صحيح');
                    setTimeout(() => setMessage(''), 3000);
                    return;
                }
            }
            const date = new Date();
            date.setDate(date.getDate() + days);
            newExpiry = date.toISOString();
        }

        setLoading(true);
        try {
            const docRef = doc(db, 'store_config', targetDocId);
            await setDoc(docRef, {
                expiryDate: newExpiry,
                storeEnabled: true,
                isOpen: true, 
                storeVisible: storeVisible,
                lastUpdatedBy: servant?.name || 'admin',
                updatedAt: new Date().toISOString()
            }, { merge: true });

            if (storeFilterStage !== 'الكل' && storeFilterClass) {
                const legacyRef = doc(db, 'store_status_config', targetDocId);
                await setDoc(legacyRef, {
                    expiryDate: newExpiry,
                    isOpen: true,
                    lastUpdatedBy: servant?.name || 'admin',
                    updatedAt: new Date().toISOString()
                }, { merge: true });
            }

            // Cascade to all classes if "All Classes" (empty class filter) is selected
            if (!storeFilterClass) {
                let classesToUpdate = [];
                if (isGeneralAdmin) {
                    if (storeFilterStage === 'الكل') {
                        classesToUpdate = Object.values(STAGE_CLASS_MAP).flat();
                    } else {
                        classesToUpdate = STAGE_CLASS_MAP[storeFilterStage] || [];
                    }
                } else {
                    classesToUpdate = authorizedClasses || [];
                }

                const promises = classesToUpdate.map(async (className) => {
                    const classId = getSafeClassId(className);
                    if (!classId) return;

                    const classDocRef = doc(db, 'store_config', classId);
                    await setDoc(classDocRef, {
                        expiryDate: newExpiry,
                        storeEnabled: true,
                        isOpen: true, 
                        storeVisible: storeVisible,
                        lastUpdatedBy: servant?.name || 'admin',
                        updatedAt: new Date().toISOString()
                    }, { merge: true });

                    const classLegacyRef = doc(db, 'store_status_config', classId);
                    await setDoc(classLegacyRef, {
                        expiryDate: newExpiry,
                        isOpen: true,
                        lastUpdatedBy: servant?.name || 'admin',
                        updatedAt: new Date().toISOString()
                    }, { merge: true });
                });
                await Promise.all(promises);
            }

            setMessage('تم حفظ الإعدادات بنجاح ✅');
        } catch (error) {
            console.error('Error saving schedule:', error);
            setMessage('حدث خطأ أثناء الحفظ ❌');
        } finally {
            setLoading(false);
            setTimeout(() => setMessage(''), 3000);
        }
    };

    return (
        <div className="bg-white dark:bg-[#1e293b] p-8 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 mb-8" dir="rtl">
            <h3 className="text-xl font-black text-slate-850 dark:text-white mb-2 pb-1 flex items-center gap-2">حالة تفعيل معرض الصفات</h3>
            <p className="text-sm font-black text-blue-600 dark:text-blue-400 mb-6">{subtitle}</p>
            
            <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-8 pb-6 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                    <Clock size={24} className="text-blue-600 dark:text-blue-400" />
                    <div>
                        <h4 className="text-lg font-bold text-slate-800 dark:text-slate-100">حالة التفعيل اليدوي للنطاق المختار</h4>
                        <p className="text-xs text-slate-450">تفعيل أو تعطيل معرض الصفات لطلاب النطاق المختار فورياً</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-900/50 px-6 py-2 rounded-lg border border-slate-200 dark:border-slate-800">
                    <span className={`font-bold ${isManualOpen ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {isManualOpen ? 'معرض الصفات متاح' : 'معرض الصفات مغلق'}
                    </span>
                    <button onClick={toggleManualStatus} className="p-1 cursor-pointer" disabled={!targetDocId}>
                        {isManualOpen ? <ToggleRight size={40} className="text-emerald-500" /> : <ToggleLeft size={40} className="text-slate-300 dark:text-slate-600" />}
                    </button>
                </div>
            </div>

            <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-8 pb-6 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                    <span className="text-2xl">👁️‍عون</span>
                    <div>
                        <h4 className="text-lg font-bold text-slate-800 dark:text-slate-100">إخفاء تبويب معرض الصفات والصفات تماماً من حساب المخدوم</h4>
                        <p className="text-xs text-slate-450">يقوم بإخفاء المتجر مؤقتاً من شاشة الولد دون مسح أي نقاط أو هدايا ممتلكة (تجميد البيانات)</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-900/50 px-6 py-2 rounded-lg border border-slate-200 dark:border-slate-800">
                    <span className={`font-bold ${!storeVisible ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {!storeVisible ? 'المتجر مخفي تماماً 🔒' : 'المتجر مرئي للمخدومين 👁️'}
                    </span>
                    <button onClick={toggleVisibilityStatus} className="p-1 cursor-pointer" disabled={!targetDocId}>
                        {!storeVisible ? <ToggleRight size={40} className="text-rose-500" /> : <ToggleLeft size={40} className="text-slate-300 dark:text-slate-600" />}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
                <div className="space-y-2">
                    <label className="block text-sm font-bold text-slate-500 dark:text-white">مدة تفعيل معرض الصفات</label>
                    <select 
                        className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-slate-900 dark:text-white"
                        value={durationMode} 
                        onChange={(e) => setDurationMode(e.target.value)}
                        disabled={!targetDocId}
                    >
                        <option value="always">مفتوح دائماً (يدوي)</option>
                        <option value="1">يوم واحد فقط</option>
                        <option value="7">أسبوع كامل</option>
                        <option value="custom">مخصص (أيام)</option>
                    </select>
                </div>

                {durationMode === 'custom' && (
                    <div className="space-y-2">
                        <label className="block text-sm font-bold text-slate-700 dark:text-white">عدد الأيام</label>
                        <input 
                            type="number" 
                            className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-slate-900 dark:text-white"
                            value={customDays} 
                            onChange={e => setCustomDays(e.target.value)} 
                            placeholder="7"
                            disabled={!targetDocId}
                        />
                    </div>
                )}

                <button 
                    onClick={handleSaveSchedule} 
                    disabled={loading || !targetDocId} 
                    className="bg-blue-600 text-white py-3 px-8 rounded-lg font-bold hover:bg-blue-700 shadow-md flex items-center justify-center gap-2"
                >
                    <Save size={20} /> حفظ الإعدادات
                </button>
            </div>
            
            {currentExpiry && (
                <p className="mt-6 text-sm font-bold text-amber-655 dark:text-amber-400 bg-amber-50 dark:bg-amber-955/20 p-3 rounded-lg border border-amber-100 dark:border-amber-900/50">
                    ⚠️ سينتهي التفعيل التلقائي في: {new Date(currentExpiry).toLocaleDateString('ar-EG')} - {new Date(currentExpiry).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                </p>
            )}
            
            {message && (
                <p className="mt-4 text-center font-bold text-blue-600 dark:text-blue-400">{message}</p>
            )}
        </div>
    );
}

export default function AdminStore() {
    const { user, servant, isGeneralAdmin, isStageServant, isServant, loading: authLoading, authorizedClasses } = useAuth();
    const location = useLocation();
    const isInitialized = useRef(false);
    const prevUserIdRef = useRef(null);
    
    const roleNorm = servant?.role ? normalizeArabic(servant.role) : '';
    const isClassServant = !!servant && (roleNorm.includes('فصل') || roleNorm.includes('خادم')) && !isStageServant;

    let myStage = 'الكل';
    const rawStage = servant ? (servant.assignedStage || servant.grade || '') : '';
    if (rawStage.includes('ابتدائي') || rawStage.includes('ابتدائى')) {
        myStage = 'ابتدائي';
    } else if (rawStage.includes('اعدادي') || rawStage.includes('اعدادى')) {
        myStage = 'اعدادي';
    } else if (rawStage.includes('ثانوي') || rawStage.includes('ثانوى')) {
        myStage = 'ثانوي';
    }

    const myClass = servant ? (servant.assignedClass || servant.assignment || '') : '';
    const myClasses = servant?.myClasses && servant.myClasses.length > 0
        ? servant.myClasses
        : (myClass ? [myClass] : []);

    const [products, setProducts] = useState([]);
    const [productsLoading, setProductsLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [formData, setFormData] = useState({ id: null, name: '', description: '', price: '', stock: '', images: [], assignedClass: '', assignedClasses: [], stage: 'الكل', visible: true });
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [storeFilterStage, setStoreFilterStage] = useState('الكل');
    const [storeFilterClass, setStoreFilterClass] = useState('');

    const isAuthorized = isGeneralAdmin || isServant;
    
    // حساب الفصول المتاحة للنظام بشكل معزول ومستقر برمجياً
    const availableClasses = useMemo(() => {
        if (isGeneralAdmin) {
            return formData.stage === 'الكل' 
                ? Object.values(STAGE_CLASS_MAP).flat() 
                : (STAGE_CLASS_MAP[formData.stage] || []);
        }
        return authorizedClasses || [];
    }, [isGeneralAdmin, formData.stage, (authorizedClasses || []).join(',')]);

    const availableClassesKey = useMemo(() => availableClasses.join(','), [availableClasses]);

    useEffect(() => {
        if (authLoading) return;

        const currentUserId = (isGeneralAdmin && user?.uid) || servant?.id || 'guest';
        if (prevUserIdRef.current !== currentUserId) {
            isInitialized.current = false;
            prevUserIdRef.current = currentUserId;
        }

        if (isInitialized.current) return;

        const prefilledStage = location.state?.prefilledStage;
        const prefilledClass = location.state?.prefilledClass;
        const storedStage = localStorage.getItem('selectedStageFilter');
        const storedClass = localStorage.getItem('selectedClassFilter');

        if (prefilledStage && prefilledClass) {
            setStoreFilterStage(prefilledStage);
            setStoreFilterClass(prefilledClass);
            isInitialized.current = true;
            window.history.replaceState({}, document.title);
            return;
        }

        if (storedStage || storedClass) {
            let stageToUse = storedStage || 'الكل';
            let classToUse = storedClass || '';

            if (!isGeneralAdmin) {
                stageToUse = myStage;
                if (classToUse !== '' && !availableClasses.includes(classToUse)) {
                    classToUse = availableClasses[0] || '';
                }
            }

            setStoreFilterStage(stageToUse);
            setStoreFilterClass(classToUse);
            isInitialized.current = true;
            return;
        }
        
        if (isGeneralAdmin) {
            setStoreFilterStage('الكل');
            setStoreFilterClass(''); 
            isInitialized.current = true;
        } else if (!isGeneralAdmin) {
            setStoreFilterStage(myStage);
            setStoreFilterClass(availableClasses.length > 1 ? '' : (availableClasses[0] || ''));
            isInitialized.current = true;
        }
    }, [isGeneralAdmin, isServant, servant, authLoading, myStage, isStageServant, isClassServant, myClasses, location, availableClassesKey]);

    useEffect(() => {
        if (!isGeneralAdmin && availableClasses.length > 0) {
            if (storeFilterClass !== '' && !availableClasses.includes(storeFilterClass)) {
                setStoreFilterClass(availableClasses[0]);
                localStorage.setItem('selectedClassFilter', availableClasses[0]);
            }
        }
    }, [isGeneralAdmin, availableClassesKey, storeFilterClass]);

    useEffect(() => {
        if (authLoading) return;
        if (isServant && servant && !isGeneralAdmin && !formData.id && showForm) {
            setFormData(prev => ({
                ...prev,
                stage: myStage,
                assignedClasses: isClassServant ? myClasses : (prev.assignedClasses.length > 0 ? prev.assignedClasses : [])
            }));
        }
    }, [isServant, servant, isGeneralAdmin, authLoading, formData.id, showForm, myStage, myClasses, isClassServant]);

    useEffect(() => {
        if (!isAuthorized || authLoading) return;
        const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
        const unsub = onSnapshot(q, (snapshot) => {
            const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            const filteredList = isGeneralAdmin 
                ? list 
                : list.filter(p => {
                    const productStage = cleanArabicStr(p.stage || 'الكل');
                    const normMyStage = cleanArabicStr(myStage);
                    
                    if (productStage === 'الكل' || productStage === normMyStage) {
                        return true;
                    }
                    
                    const classes = p.assignedClasses || (p.assignedClass ? [p.assignedClass] : []);
                    const normClasses = classes.map(c => cleanArabicStr(c));
                    const normAvailableClasses = availableClasses.map(c => cleanArabicStr(c));
                    return normClasses.some(c => normAvailableClasses.includes(c));
                });
                
            setProducts(filteredList);
            setProductsLoading(false);
        }, (error) => {
            console.error("Error fetching products:", error);
            setProductsLoading(false);
        });
        return () => unsub();
    }, [authLoading, isAuthorized, isGeneralAdmin, myStage, availableClassesKey]);

    if (authLoading) return <div className="p-20 text-center font-bold">جاري التحقق بأمان...</div>;
    if (!isAuthorized) return <Navigate to="/admin/login" replace />;

    const handleFileChange = (e) => {
        if (e.target.files) setSelectedFiles(Array.from(e.target.files));
    };

    const handleSaveProduct = async (e) => {
        e.preventDefault();
        
        setUploading(true);
        try {
            let uploadedUrls = [...formData.images];
            if (selectedFiles.length > 0) {
                const uploadPromises = selectedFiles.map(async (file) => {
                    const fd = new FormData();
                    fd.append('image', file);
                    const response = await fetch(`https://api.imgbb.com/1/upload?key=5b981ef8e6073a4244e0fd1a51cf5876`, {
                        method: 'POST',
                        body: fd
                    });
                    const resData = await response.json();
                    return resData.data.url;
                });
                const newUrls = await Promise.all(uploadPromises);
                uploadedUrls = [...uploadedUrls, ...newUrls];
            }

            let productStage = 'الكل';
            if (isGeneralAdmin) {
                productStage = formData.stage || 'الكل';
            } else if (isServant && servant) {
                productStage = myStage;
            }

            const currentStageClasses = STAGE_CLASS_MAP[productStage] || [];
            const isAllSelected = currentStageClasses.length > 0 && currentStageClasses.every(cls => formData.assignedClasses?.includes(cls));

            let targetClass = '';
            let selectedClasses = [];

            if (isClassServant) {
                selectedClasses = (formData.assignedClasses || []).filter(cls => myClasses.includes(cls));
                targetClass = selectedClasses[0] || '';
            } else if (productStage !== 'الكل' && !isAllSelected) {
                selectedClasses = (formData.assignedClasses || []).filter(cls => currentStageClasses.includes(cls));
                if (selectedClasses.length === 1) {
                    targetClass = selectedClasses[0];
                }
            }

            const pData = {
                name: formData.name,
                description: formData.description || '',
                price: parseInt(formData.price, 10),
                stock: Math.max(0, parseInt(formData.stock, 10) || 0),
                images: uploadedUrls,
                assignedClass: targetClass,
                assignedClasses: selectedClasses,
                stage: productStage,
                updatedAt: new Date().toISOString()
            };

            if (formData.id) {
                pData.visible = typeof formData.visible === 'boolean' ? formData.visible : true;
                await updateDoc(doc(db, 'products', formData.id), pData);
            } else {
                pData.createdAt = new Date().toISOString();
                pData.visible = true;
                await addDoc(collection(db, 'products'), pData);
            }

            setFormData({ id: null, name: '', description: '', price: '', stock: '', images: [], assignedClass: '', assignedClasses: [], stage: 'الكل', visible: true });
            setSelectedFiles([]);
            setShowForm(false);
            alert('تم الحفظ بنجاح ✅');
        } catch (error) {
            alert('خطأ في الحفظ ❌');
        } finally {
            setUploading(false);
        }
    };

    const handleEdit = (p) => {
        const stage = p.stage || 'الكل';
        let classes = p.assignedClasses || [];
        if (classes.length === 0 && p.assignedClass) {
            classes = [p.assignedClass];
        }
        if (classes.length === 0 && stage !== 'الكل') {
            classes = STAGE_CLASS_MAP[stage] || [];
        }

        setFormData({ 
            id: p.id, 
            name: p.name, 
            description: p.description || '', 
            price: p.price, 
            stock: p.stock, 
            images: p.images || [], 
            assignedClass: p.assignedClass || '', 
            assignedClasses: classes,
            stage: stage,
            visible: typeof p.visible === 'boolean' ? p.visible : true
        });
        setShowForm(true);
    };

    const handleDelete = async (id) => {
        if (window.confirm('هل أنت متأكد من حذف هذا المنتج؟')) {
            await deleteDoc(doc(db, 'products', id));
        }
    };

    const displayedProducts = useMemo(() => {
        return products.filter(p => {
            const normProductStage = cleanArabicStr(p.stage || 'الكل');
            const normFilterStage = cleanArabicStr(storeFilterStage || 'الكل');

            if (storeFilterStage !== 'الكل' && normProductStage !== 'الكل' && normProductStage !== normFilterStage) {
                return false;
            }

            const classes = p.assignedClasses || (p.assignedClass ? [p.assignedClass] : []);
            const normClasses = classes.map(c => cleanArabicStr(c));
            const normFilterClass = cleanArabicStr(storeFilterClass);

            const isAvailableToAllClasses = normClasses.includes(cleanArabicStr('كل الفصول')) || 
                                            normClasses.includes(cleanArabicStr('كل فصول المرحلة')) || 
                                            classes.length === 0;

            if (storeFilterClass && storeFilterClass !== 'الكل' && storeFilterClass !== 'كل فصولي') {
                if (!normClasses.includes(normFilterClass) && !isAvailableToAllClasses) {
                    return false;
                }
            }

            if (isStageServant) {
                const managed = (servant?.managedClasses || STAGE_CLASS_MAP[myStage] || []).map(c => cleanArabicStr(c));
                if (!isAvailableToAllClasses && !normClasses.some(c => managed.includes(c))) {
                    return false;
                }
            } else if (isClassServant) {
                const myNormClasses = myClasses.map(c => cleanArabicStr(c));
                if (!isAvailableToAllClasses && !normClasses.some(c => myNormClasses.includes(c))) {
                    return false;
                }
            }

            return true;
        });
    }, [products, storeFilterStage, storeFilterClass, isStageServant, isClassServant, servant?.managedClasses, myStage, myClasses]);

    return (
        <div className="max-w-6xl mx-auto px-4 py-8 min-h-[75vh]" dir="rtl">
            <style>
                {`
                .text-slate-850 { color: #1e293b; }
                `}
            </style>
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
                <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-100">إدارة معرض الصفات</h1>
                <div className="flex items-center gap-4 w-full md:w-auto">
                    {(isGeneralAdmin || isStageServant || isClassServant) && (
                        <div className="flex gap-3 w-full md:w-auto">
                            <select
                                className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg font-bold outline-none focus:ring-2 focus:ring-blue-500 text-white bg-slate-800 dark:bg-[#1e293b] cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
                                value={storeFilterStage}
                                onChange={(e) => {
                                    const nextStage = e.target.value;
                                    setStoreFilterStage(nextStage);
                                    localStorage.setItem('selectedStageFilter', nextStage);
                                    setStoreFilterClass('');
                                    localStorage.setItem('selectedClassFilter', '');
                                }}
                                disabled={!isGeneralAdmin}
                            >
                                <option value="الكل" className="bg-white dark:bg-[#0f172a] text-slate-900 dark:text-white">كل المراحل</option>
                                <option value="ابتدائي" className="bg-white dark:bg-[#0f172a] text-slate-900 dark:text-white">ابتدائي</option>
                                <option value="اعدادي" className="bg-white dark:bg-[#0f172a] text-slate-900 dark:text-white">اعدادي</option>
                                <option value="ثانوي" className="bg-white dark:bg-[#0f172a] text-slate-900 dark:text-white">ثانوي</option>
                            </select>

                            <select
                                className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg font-bold outline-none focus:ring-2 focus:ring-blue-500 text-white bg-slate-800 dark:bg-[#1e293b] disabled:opacity-50 cursor-pointer"
                                value={storeFilterClass}
                                onChange={(e) => {
                                    const nextClass = e.target.value;
                                    setStoreFilterClass(nextClass);
                                    localStorage.setItem('selectedClassFilter', nextClass);
                                }}
                                disabled={storeFilterStage === 'الكل' && isGeneralAdmin}
                            >
                                {isGeneralAdmin ? (
                                    <>
                                        {storeFilterStage === 'الكل' ? (
                                            <option value="" className="bg-white dark:bg-[#0f172a] text-slate-900 dark:text-white">كل الفصول</option>
                                        ) : (
                                            <option value="" className="bg-white dark:bg-[#0f172a] text-slate-900 dark:text-white">كل فصول المرحلة</option>
                                        )}
                                        {storeFilterStage !== 'الكل' && (STAGE_CLASS_MAP[storeFilterStage] || []).map(cls => (
                                            <option key={cls} value={cls} className="bg-white dark:bg-[#0f172a] text-slate-900 dark:text-white">{cls}</option>
                                        ))}
                                    </>
                                ) : (
                                    <>
                                        {availableClasses.length > 1 && <option value="" className="bg-white dark:bg-[#0f172a] text-slate-900 dark:text-white">كل الفصول</option>}
                                        {availableClasses.map(cls => (
                                            <option key={cls} value={cls} className="bg-white dark:bg-[#0f172a] text-slate-900 dark:text-white">{cls}</option>
                                        ))}
                                    </>
                                )}
                            </select>
                        </div>
                    )}
                    <button onClick={() => setShowForm(!showForm)} className="bg-blue-600 text-white px-8 py-3 rounded-lg font-bold shadow-md hover:bg-blue-700 transition-all mr-auto md:mr-0 cursor-pointer">
                        {showForm ? 'إلغاء' : 'إضافة منتج'}
                    </button>
                </div>
            </header>

            <StoreSchedulePanel 
                isGeneralAdmin={isGeneralAdmin}
                isServant={isServant}
                servant={servant}
                myStage={myStage}
                myClass={myClass}
                myClasses={myClasses}
                roleNorm={roleNorm}
                storeFilterStage={storeFilterStage}
                storeFilterClass={storeFilterClass}
            />

            {showForm && (
                <div className="bg-white dark:bg-[#1e293b] p-8 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 mb-10">
                    <form onSubmit={handleSaveProduct} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <input className="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-400 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="الاسم" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                            <input className="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-400 focus:ring-2 focus:ring-blue-500 outline-none" type="number" placeholder="السعر" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} required />
                            <input className="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-400 focus:ring-2 focus:ring-blue-500 outline-none" type="number" placeholder="المخزون" value={formData.stock} onChange={e => setFormData({...formData, stock: e.target.value})} required />
                        </div>
                        
                        <div className="space-y-6">
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-bold text-slate-700 dark:text-white">المرحلة المستهدفة</label>
                                {isGeneralAdmin ? (
                                    <select 
                                        className="w-full md:w-1/2 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                                        value={formData.stage || 'الكل'}
                                        onChange={e => {
                                            const nextStage = e.target.value;
                                            setFormData({ 
                                                ...formData, 
                                                stage: nextStage, 
                                                assignedClasses: nextStage === 'الكل' ? [] : (STAGE_CLASS_MAP[nextStage] || []) 
                                            });
                                        }}
                                    >
                                        <option value="الكل">الكل (عام لكل المراحل)</option>
                                        <option value="ابتدائي">ابتدائي</option>
                                        <option value="اعدادي">اعدادي</option>
                                        <option value="ثانوي">ثانوي</option>
                                    </select>
                                ) : (
                                    <div className="w-full md:w-1/2 p-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-slate-600 dark:text-slate-350">
                                        المرحلة: {formData.stage || 'الكل'} (محددة تلقائياً)
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-col gap-3">
                                <label className="text-sm font-bold text-slate-700 dark:text-white">الفصول المستهدفة</label>
                                {(!formData.stage || formData.stage === 'الكل') ? (
                                    <div className="p-3.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-400 dark:text-slate-500 text-center">
                                        المنتج متاح تلقائياً لكل فصول ومراحل الخدمة
                                    </div>
                                ) : (() => {
                                    const currentStageClasses = STAGE_CLASS_MAP[formData.stage] || [];
                                    const isAllSelected = currentStageClasses.length > 0 && currentStageClasses.every(cls => formData.assignedClasses?.includes(cls));
                                    
                                    return (
                                        <div className="space-y-4">
                                            {isGeneralAdmin && !isClassServant && (
                                                <label className="flex items-center gap-3 p-3 bg-slate-100 dark:bg-[#1e293b] border border-slate-300 dark:border-slate-700 rounded-xl cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800/80 transition-colors font-bold text-slate-800 dark:text-slate-200">
                                                    <input 
                                                        type="checkbox"
                                                        className="w-5 h-5 accent-blue-600 rounded"
                                                        checked={isAllSelected}
                                                        onChange={(e) => {
                                                            const checked = e.target.checked;
                                                            let updated = [...(formData.assignedClasses || [])];
                                                            if (checked) {
                                                                currentStageClasses.forEach(cls => {
                                                                    if (!updated.includes(cls)) updated.push(cls);
                                                                });
                                                            } else {
                                                                updated = updated.filter(cls => !currentStageClasses.includes(cls));
                                                            }
                                                            setFormData({ ...formData, assignedClasses: updated });
                                                        }}
                                                    />
                                                    <span>كل فصول المرحلة (تحديد الكل)</span>
                                                </label>
                                            )}

                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                                {currentStageClasses.map(cls => {
                                                    const isChecked = formData.assignedClasses?.includes(cls) || false;
                                                    const checkboxDisabled = isGeneralAdmin ? false : !(authorizedClasses || []).includes(cls);
                                                    const checkboxChecked = checkboxDisabled ? false : isChecked;
                                                    
                                                    return (
                                                        <label 
                                                            key={cls} 
                                                            className={`flex items-center gap-3 p-3 border rounded-xl transition-colors font-bold ${
                                                                checkboxDisabled 
                                                                    ? 'bg-slate-100/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 opacity-50 cursor-not-allowed' 
                                                                    : 'bg-slate-50 dark:bg-[#0f172a] border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/50'
                                                            } text-slate-800 dark:text-white`}
                                                        >
                                                            <input 
                                                                type="checkbox"
                                                                className="w-5 h-5 accent-blue-600 rounded disabled:opacity-50"
                                                                checked={checkboxChecked}
                                                                disabled={checkboxDisabled}
                                                                onChange={(e) => {
                                                                    const checked = e.target.checked;
                                                                    let updated = [...(formData.assignedClasses || [])];
                                                                    if (checked) {
                                                                        if (!updated.includes(cls)) updated.push(cls);
                                                                    } else {
                                                                        updated = updated.filter(c => c !== cls);
                                                                    }
                                                                    setFormData({ ...formData, assignedClasses: updated });
                                                                }}
                                                            />
                                                            <span>{cls}</span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                        <textarea className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-400 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="الوصف" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} rows="3" />
                        <input type="file" multiple onChange={handleFileChange} className="block w-full text-sm text-slate-500 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 dark:file:bg-blue-955/30 file:text-blue-700 dark:file:text-blue-400 hover:file:bg-blue-100 dark:hover:file:bg-blue-900/30 cursor-pointer" />
                        <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-lg font-bold shadow-md hover:bg-blue-700 cursor-pointer" disabled={uploading}>
                            {uploading ? 'جاري الحفظ...' : 'حفظ المنتج'}
                        </button>
                    </form>
                </div>
            )}

            {productsLoading ? (
                <div className="text-center py-20 font-bold text-slate-400 dark:text-slate-500">جاري التحميل...</div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    {displayedProducts.length === 0 ? (
                        <div className="col-span-full text-center py-20 font-bold text-slate-400 dark:text-slate-500">لا توجد منتجات معروضة لهذا الفصل.</div>
                    ) : (
                        displayedProducts.map(p => (
                            <div key={p.id} className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-800 shadow-sm rounded-2xl overflow-hidden flex flex-col">
                                <div className="h-40 bg-slate-50 dark:bg-[#0f172a] border-b border-slate-200 dark:border-slate-800 p-2 flex items-center justify-center">
                                    {p.images?.[0] ? (
                                        <img src={p.images[0]} alt={p.name} className="max-w-full max-h-full object-contain rounded-lg" />
                                    ) : (
                                        <div className="text-slate-350 dark:text-slate-700 flex items-center justify-center w-full h-full"><ImageIcon size={32} /></div>
                                    )}
                                </div>
                                <div className="p-4 flex-1 flex flex-col justify-between">
                                    <div>
                                        <h3 className="font-bold text-lg mb-1 text-slate-800 dark:text-slate-100">{p.name}</h3>
                                        <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-4">
                                            <span>المخزون: </span>
                                            <span className="font-bold text-slate-700 dark:text-slate-200" dir="ltr">{p.stock}</span>
                                            <span className="mx-2 opacity-50">|</span>
                                            <span>الفصول: </span>
                                            <span className="dark:text-blue-400 font-semibold text-blue-600">{(p.assignedClasses || (p.assignedClass ? [p.assignedClass] : [])).join(', ') || 'كل الفصول'}</span>
                                        </p>
                                    </div>
                                    <div className="flex justify-between items-center mt-2">
                                        <span className="font-bold text-amber-600 dark:text-amber-400"><span dir="ltr">{p.price}</span> صفة</span>
                                        <div className="flex gap-2">
                                            <button onClick={() => handleEdit(p)} className="bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 border border-transparent dark:border-amber-500/20 hover:dark:bg-amber-500/20 rounded-lg p-2 transition-colors cursor-pointer"><Edit2 size={16}/></button>
                                            <button onClick={() => handleDelete(p.id)} className="bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-450 border border-transparent dark:border-rose-500/20 hover:dark:bg-rose-500/20 rounded-lg p-2 transition-colors cursor-pointer"><Trash2 size={16}/></button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}