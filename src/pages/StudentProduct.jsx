import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, onSnapshot, db } from '../firebase';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { cleanupExpiredCarts } from '../utils/cartCleanup';
import { ArrowRight, Star, Plus, Minus, ShoppingCart, Package, AlertCircle, Clock } from 'lucide-react';

const normalizeArabic = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    return str
        .replace(/[أإآا]/g, 'ا')
        .replace(/[ىي]/g, 'ي')
        .replace(/[ةه]/g, 'ه')
        .replace(/\s+/g, ' ')
        .trim();
};

const getSafeClassId = (className) => {
    if (!className) return '';
    return className.replace(/\//g, '-');
};

const getStudentStage = (studentData) => {
    if (!studentData) return '';
    let rawStage = studentData.stage || studentData.assignedStage || '';
    if (rawStage) {
        return rawStage;
    }
    const grade = studentData.schoolGrade || studentData.assignedClass || '';
    const normalizedGrade = grade.trim();
    if (
        normalizedGrade.includes('ابتدائي') || 
        normalizedGrade.includes('ابتدائى') || 
        normalizedGrade.includes('حضانة') || 
        normalizedGrade.includes('ملائكة')
    ) {
        return 'ابتدائي';
    }
    if (normalizedGrade.includes('اعدادي') || normalizedGrade.includes('اعدادى')) {
        return 'اعدادي';
    }
    if (normalizedGrade.includes('ثانوي') || normalizedGrade.includes('ثانوى')) {
        return 'ثانوي';
    }
    return '';
};

const isProductVisible = (product, studentData) => {
    if (!product || !studentData) return false;
    if (product.visible === false) return false;

    // Read structured class field only (NO legacy className fallback)
    const studentAssignedClass = normalizeArabic(
        studentData.assignedClass || studentData.schoolGrade || ''
    );

    // ENGINE RULE 1a: Multi-class product (assignedClasses array)
    const assignedClasses = product.assignedClasses || [];
    if (assignedClasses.length > 0) {
        // If the array contains 'كل الفصول' it is stage-wide — skip to stage check
        if (!assignedClasses.includes('كل الفصول')) {
            // Strict per-class match
            return assignedClasses.some(
                cls => normalizeArabic(cls) === studentAssignedClass
            );
        }
        // Falls through to stage check below
    } else {
        // ENGINE RULE 1b: Single-class product (assignedClass string)
        const productAssignedClass = normalizeArabic(product.assignedClass || '');
        if (productAssignedClass !== '') {
            return productAssignedClass === studentAssignedClass;
        }
    }

    // ENGINE RULE 2: Fallback to stage-level match
    const normalizedProductStage = normalizeArabic(product.stage || 'الكل');
    const normalizedStudentStage = normalizeArabic(getStudentStage(studentData));

    return normalizedProductStage === normalizeArabic('الكل') ||
           normalizedProductStage === 'all' ||
           normalizedProductStage === '' ||
           normalizedProductStage === normalizedStudentStage;
};

export default function StudentProduct() {
    const { storeVisible, storeEnabled, storeSchedule: schedule, loading: authLoading } = useAuth();
    const { id } = useParams();
    const navigate = useNavigate();
    const { addToCart, cart } = useCart();
    
    const [product, setProduct] = useState(null);
    const [loading, setLoading] = useState(true);
    const [quantity, setQuantity] = useState(1);
    const [points, setPoints] = useState(0);
    const [mainImage, setMainImage] = useState(0);
    const [isStoreOpen, setIsStoreOpen] = useState(true);
    const [isAdding, setIsAdding] = useState(false);
    const [storeStatusMsg, setStoreStatusMsg] = useState('');

    useEffect(() => {
        if (!authLoading && storeVisible === false) {
            navigate('/student/dashboard');
        }
    }, [storeVisible, authLoading, navigate]);
    
    useEffect(() => {
        cleanupExpiredCarts();
        const studentId = localStorage.getItem('studentId');
        if (!studentId) {
            navigate('/login');
            return;
        }

        const unsubStudent = onSnapshot(doc(db, 'students', studentId), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setPoints(data.points || 0);
            }
        });

        const fetchProduct = async () => {
            try {
                const studentSnap = await getDoc(doc(db, 'students', studentId));
                let studentData = null;
                if (studentSnap.exists()) {
                    studentData = studentSnap.data();
                }

                const docSnap = await getDoc(doc(db, 'products', id));
                if (docSnap.exists()) {
                    const pData = docSnap.data();
                    
                    if (!isProductVisible(pData, studentData)) {
                        alert('عذراً، هذا المنتج غير متاح لفصلك.');
                        navigate('/student/store');
                        return;
                    }
                    
                    setProduct({ id: docSnap.id, ...pData });
                } else {
                    alert('هذه اللعبة غير موجودة');
                    navigate('/student/store');
                }
            } catch (error) {
                console.error("Error fetching product:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchProduct();
        return () => {
            unsubStudent();
        };
    }, [id, navigate]);

    if (storeVisible === false) {
        return null;
    }

    useEffect(() => {
        const checkStatus = () => {
            if (!schedule) {
                setIsStoreOpen(true);
                setStoreStatusMsg("");
                return;
            }
            if (schedule.isOpen === false) {
                setIsStoreOpen(false);
                setStoreStatusMsg("معرض الصفات مغلق حالياً لفصلك الدراسي بقرار من الخادم المتابع");
                return;
            }

            if (!schedule.expiryDate) {
                setIsStoreOpen(true);
                setStoreStatusMsg("");
                return;
            }

            const now = new Date();
            const expiryDate = new Date(schedule.expiryDate);

            if (now < expiryDate) {
                setIsStoreOpen(true);
                setStoreStatusMsg("");
            } else {
                setIsStoreOpen(false);
                setStoreStatusMsg("معرض الصفات مغلق لانتهاء وقت التشغيل المخصص لفصلك");
            }
        };
        checkStatus();
        const timerId = setInterval(checkStatus, 1000);
        return () => clearInterval(timerId);
    }, [schedule]);

    if (loading) return <div className="loading" style={{ padding: '40px', textAlign: 'center' }}>جاري تحميل اللعبة...</div>;
    if (!product) return null;

    const availableStock = product.stock;

    const handleAddToCart = async () => {
        if (quantity > availableStock) {
            alert('لقد أضفت كل الكمية المتاحة مسبقاً للسلة!');
            return;
        }
        setIsAdding(true);
        try {
            await addToCart(product, quantity);
            alert('تمت الإضافة للسلة بنجاح!');
            navigate('/student/store');
        } catch (error) {
            // Error is handled in context
        } finally {
            setIsAdding(false);
        }
    };

    return (
        <div className="w-full max-w-6xl mx-auto px-4 py-8 mb-20" dir="rtl">
            <button 
                onClick={() => navigate('/student/store')}
                className="flex items-center gap-2 text-slate-400 dark:text-slate-550 font-black hover:text-blue-600 dark:hover:text-blue-400 transition-colors mb-8 group"
            >
                <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" /> 
                <span>الرجوع للمعرض</span>
            </button>

            {!isStoreOpen && schedule && (
                <div className="flex items-center gap-4 p-5 bg-rose-50 dark:bg-rose-955/25 border-2 border-rose-100 dark:border-rose-900/30 rounded-[2rem] mb-8 text-rose-600 dark:text-rose-450 shadow-xl dark:shadow-none animate-pulse">
                    <div className="bg-rose-100 dark:bg-rose-900/30 p-3 rounded-2xl">
                        <AlertCircle size={28} />
                    </div>
                    <div>
                        <div className="text-lg font-black">{schedule.isOpen === false ? 'تنبيه إداري' : 'معرض الصفات مغلق حالياً'}</div>
                        <div className="text-sm font-bold opacity-80">{storeStatusMsg}</div>
                    </div>
                </div>
            )}

            <div className="bg-white dark:bg-[#1e293b] rounded-[3rem] shadow-sm border border-slate-50 dark:border-slate-800 overflow-hidden flex flex-col md:flex-row gap-8 lg:gap-16 p-6 lg:p-12 text-slate-850 dark:text-slate-200">
                
                {/* Image Gallery */}
                <div className="flex-1 space-y-6">
                    <div className="aspect-square bg-slate-50 dark:bg-[#0f172a] rounded-[2.5rem] overflow-hidden border-2 border-slate-100 dark:border-slate-800 shadow-inner group relative">
                        {product.images && product.images.length > 0 ? (
                            <img 
                                src={product.images[mainImage]} 
                                alt={product.name} 
                                className="w-full h-full object-contain transition-transform duration-700 group-hover:scale-110 p-8" 
                            />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-slate-200 dark:text-slate-700">
                                <Package size={120} strokeWidth={1} />
                                <p className="font-black mt-2">لا توجد صورة</p>
                            </div>
                        )}
                        <div className="absolute top-6 right-6">
                            <span className="bg-white/90 dark:bg-[#1e293b]/90 backdrop-blur-md px-4 py-2 rounded-2xl text-amber-600 dark:text-amber-450 font-black shadow-sm flex items-center gap-2 border border-slate-100 dark:border-slate-800">
                                <Star size={18} className="fill-amber-500 text-amber-500" />
                                {product.price} صفة
                            </span>
                        </div>
                    </div>

                    {product.images && product.images.length > 1 && (
                        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
                            {product.images.map((img, idx) => (
                                <button 
                                    key={idx} 
                                    onClick={() => setMainImage(idx)}
                                    className={`relative w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0 transition-all border-4 ${
                                        mainImage === idx ? 'border-blue-500 shadow-lg' : 'border-transparent opacity-60 grayscale-[50%]'
                                    }`}
                                >
                                    <img src={img} alt={`Thumbnail ${idx+1}`} className="w-full h-full object-cover" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Product Info */}
                <div className="flex-[1.2] flex flex-col pt-4">
                    <div className="space-y-4 mb-8">
                        <h1 className="text-3xl lg:text-5xl font-black text-slate-800 dark:text-white leading-tight">{product.name}</h1>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1.5 px-4 py-2 bg-blue-50 dark:bg-blue-950/35 text-blue-600 dark:text-blue-400 rounded-2xl text-sm font-black border border-blue-100 dark:border-blue-900/50">
                                <Package size={18} />
                                <span>{availableStock > 0 ? `المخزون: ${availableStock}` : 'نفد'}</span>
                            </div>
                            <div className="flex items-center gap-1.5 px-4 py-2 bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 rounded-2xl text-sm font-black border border-amber-100 dark:border-amber-900/50">
                                <Star size={18} className="fill-amber-500 text-amber-500" />
                                <span>رصيدك: {points}</span>
                            </div>
                        </div>
                    </div>

                    <div className="py-8 border-y-2 border-slate-50 dark:border-slate-800 space-y-4 mb-10">
                        <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                             <div className="w-2 h-6 bg-blue-500 dark:bg-blue-400 rounded-full"></div>
                             تفاصيل اللعبة
                        </h3>
                        <p className="text-slate-500 dark:text-slate-400 font-bold leading-relaxed text-lg whitespace-pre-wrap">
                            {product.description || 'لا يوجد وصف متاح لهذه اللعبة حالياً.'}
                        </p>
                    </div>

                    <div className="mt-auto space-y-6">
                        {availableStock > 0 ? (
                            <div className="bg-slate-50 dark:bg-[#0f172a] p-6 lg:p-8 rounded-[2.5rem] border-2 border-slate-100 dark:border-slate-800 shadow-sm space-y-6">
                                <div className="flex items-center justify-between">
                                    <span className="font-black text-slate-600 dark:text-slate-400 text-lg">الكمية المطلوبة</span>
                                    <div className="flex items-center gap-6 bg-white dark:bg-[#1e293b] p-2 rounded-2xl border-2 border-slate-100 dark:border-slate-800">
                                        <button 
                                            onClick={() => setQuantity(q => Math.min(availableStock, q + 1))}
                                            disabled={quantity >= availableStock}
                                            className="w-12 h-12 flex items-center justify-center bg-slate-100 dark:bg-slate-900 rounded-xl text-2xl font-black text-slate-400 dark:text-slate-550 hover:bg-blue-50 dark:hover:bg-blue-955/30 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-20 transition-all active:scale-90"
                                        >
                                            <Plus size={24} />
                                        </button>
                                        <span className="text-2xl font-black text-slate-800 dark:text-slate-200 min-w-[30px] text-center">{quantity}</span>
                                        <button 
                                            onClick={() => setQuantity(q => Math.max(1, q - 1))}
                                            disabled={quantity <= 1}
                                            className="w-12 h-12 flex items-center justify-center bg-slate-100 dark:bg-slate-900 rounded-xl text-2xl font-black text-slate-400 dark:text-slate-550 hover:bg-rose-50 dark:hover:bg-rose-955/35 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-20 transition-all active:scale-90"
                                        >
                                            <Minus size={24} />
                                        </button>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-4">
                                    <div className="flex justify-between items-center px-2">
                                        <span className="font-black text-slate-400">إجمالي التكلفة</span>
                                        <div className="flex items-center gap-2 text-2xl font-black text-amber-600 dark:text-amber-450">
                                            {quantity * product.price}
                                            <Star size={24} className="fill-amber-500 text-amber-500" />
                                        </div>
                                    </div>

                                    <button 
                                        onClick={handleAddToCart}
                                        disabled={!isStoreOpen || isAdding || (quantity * product.price > points)}
                                        className={`w-full flex items-center justify-center gap-3 py-6 rounded-[2rem] text-xl font-black transition-all active:scale-95 shadow-xl ${
                                            (!isStoreOpen || isAdding || (quantity * product.price > points))
                                            ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-550 shadow-none cursor-not-allowed'
                                            : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-100 dark:shadow-none'
                                        }`}
                                    >
                                        {isAdding ? (
                                            <div className="animate-spin rounded-full h-6 w-6 border-2 border-white/30 border-t-white"></div>
                                        ) : (
                                            <>
                                                <ShoppingCart size={28} />
                                                <span>{isStoreOpen ? (quantity * product.price > points ? 'رصيدك لا يكفي' : 'إضافة إلى السلة') : 'معرض الصفات مغلق'}</span>
                                            </>
                                        )}
                                    </button>

                                    {quantity * product.price > points && (
                                        <div className="flex items-center justify-center gap-2 text-rose-500 font-bold bg-rose-50 dark:bg-rose-955/20 p-4 rounded-2xl border border-rose-100 dark:border-rose-900/30 text-sm">
                                            <AlertCircle size={18} />
                                            <span>تحتاج إلى {quantity * product.price - points} صفة إضافية</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="bg-rose-500 text-white p-8 rounded-[2.5rem] shadow-xl shadow-rose-100 dark:shadow-none text-center space-y-2">
                                <Package size={48} className="mx-auto mb-2 opacity-50" />
                                <h3 className="text-2xl font-black">عفواً، نفدت الكمية!</h3>
                                <p className="font-bold opacity-80">انتظر التزويد القادم بالهدايا قريباً</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
