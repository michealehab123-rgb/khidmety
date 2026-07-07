import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, orderBy, doc, where, runTransaction, deleteDoc, db } from '../firebase';
import { Star, ShoppingBag, EyeOff, Package, Clock, AlertCircle } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { cleanupExpiredCarts } from '../utils/cartCleanup';

function PurchasesTab({ studentId, isStoreOpen }) {
    const [orders, setOrders] = useState([]);
    const [productsMap, setProductsMap] = useState({});
    const [loading, setLoading] = useState(true);
    const [subTab, setSubTab] = useState('pending'); // 'pending' | 'delivered'
    const [isCancelling, setIsCancelling] = useState(false);

    useEffect(() => {
        const unsubProducts = onSnapshot(collection(db, 'products'), (snapshot) => {
            const pm = {};
            snapshot.docs.forEach(doc => { pm[doc.id] = doc.data(); });
            setProductsMap(pm);
        });

        const q = query(collection(db, 'orders'), where('studentId', '==', studentId));
        const unsubOrders = onSnapshot(q, (snapshot) => {
            const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            setOrders(list);
            setLoading(false);
        });

        return () => { unsubProducts(); unsubOrders(); };
    }, [studentId]);

    const handleCancelOrder = async (orderId, itemIndex) => {
        if (!isStoreOpen) { alert("لا يمكن إلغاء الطلبات أثناء إغلاق معرض الصفات."); return; }
        if (!window.confirm("هل أنت متأكد من إلغاء هذا المنتج واسترداد صفاته؟")) return;

        setIsCancelling(true);
        try {
            await runTransaction(db, async (transaction) => {
                const orderRef = doc(db, 'orders', orderId);
                const orderSnap = await transaction.get(orderRef);
                if (!orderSnap.exists()) throw new Error("الطلب غير موجود");
                
                const orderData = orderSnap.data();
                if (orderData.status !== 'pending' && orderData.status !== 'completed') throw new Error("لا يمكن إلغاء الطلب بعد تسليمه.");

                const items = orderData.items || [];
                if (itemIndex < 0 || itemIndex >= items.length) throw new Error("المنتج المحدد غير موجود بالطلب.");

                const itemToCancel = items[itemIndex];
                const pid = itemToCancel.productId || itemToCancel.id;
                if (!pid) throw new Error("كود المنتج غير صالح.");

                const studentRef = doc(db, 'students', studentId);
                const studentSnap = await transaction.get(studentRef);
                if (!studentSnap.exists()) throw new Error("بيانات المخدوم غير موجودة");

                const productRef = doc(db, 'products', pid);
                const productSnap = await transaction.get(productRef);

                const currentPoints = studentSnap.data().points || 0;
                const refundAmount = (itemToCancel.price || 0) * (itemToCancel.quantity || 1);

                // Update student points
                transaction.update(studentRef, { points: currentPoints + refundAmount });

                // Restore product stock
                if (productSnap.exists()) {
                    const newStock = (productSnap.data().stock || 0) + (itemToCancel.quantity || 1);
                    transaction.update(productRef, { stock: newStock });
                }

                // If this was the only item in the order, delete the order doc
                if (items.length <= 1) {
                    transaction.delete(orderRef);
                } else {
                    // Otherwise, remove this item and deduct from totalCost
                    const newItems = items.filter((_, idx) => idx !== itemIndex);
                    transaction.update(orderRef, {
                        items: newItems,
                        totalCost: Math.max(0, (orderData.totalCost || 0) - refundAmount)
                    });
                }
            });
            alert("تم إلغاء شراء المنتج بنجاح واسترداد الصفات.");
        } catch (error) {
            console.error("Cancel Order Item Error:", error);
            alert(error.message || "حدث خطأ أثناء إلغاء الطلب.");
        } finally { setIsCancelling(false); }
    };

    const getItemImage = (item) => {
        if (item.images?.[0]) return item.images[0];
        const pid = item.productId || item.id;
        if (pid && productsMap[pid]?.images?.[0]) return productsMap[pid].images[0];
        return 'https://via.placeholder.com/150?text=No+Image';
    };

    if (loading) return <div className="py-20 text-center font-bold text-slate-400">جاري تحميل مشترياتك...</div>;

    const filteredOrders = orders.filter(o => {
        if (subTab === 'pending') return (o.status === 'pending' || o.status === 'completed');
        return o.status === 'delivered';
    });

    return (
        <div className="animate-in fade-in duration-500">
            <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-2xl mb-8 gap-1 w-full max-w-md mx-auto border border-slate-200/50 dark:border-slate-800">
                <button 
                    onClick={() => setSubTab('pending')}
                    className={`flex-1 py-3 px-4 rounded-xl font-bold text-sm transition-all sm:text-base ${subTab === 'pending' ? 'bg-white dark:bg-[#1e293b] text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                >
                    قيد الانتظار ({orders.filter(o => o.status === 'pending' || o.status === 'completed').length})
                </button>
                <button 
                    onClick={() => setSubTab('delivered')}
                    className={`flex-1 py-3 px-4 rounded-xl font-bold text-sm transition-all sm:text-base ${subTab === 'delivered' ? 'bg-white dark:bg-[#1e293b] text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                >
                    تم استلامها ({orders.filter(o => o.status === 'delivered').length})
                </button>
            </div>

            {filteredOrders.length === 0 ? (
                <div className="py-20 text-center bg-white dark:bg-[#1e293b] rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm text-slate-400 dark:text-slate-550">
                    <Package size={64} className="mx-auto mb-4 opacity-20" />
                    <p className="text-xl font-bold">لا توجد طلبات هنا حالياً</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredOrders.flatMap(order => 
                        order.items.map((item, idx) => (
                            <div key={`${order.id}-${idx}`} className="bg-white dark:bg-[#1e293b] p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4 group hover:shadow-md transition-all">
                                <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-50 dark:bg-[#0f172a] flex-shrink-0 border border-slate-50 dark:border-slate-800">
                                    <img src={getItemImage(item)} alt={item.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                                </div>
                                <div className="flex-grow min-w-0">
                                    <h4 className="font-black text-slate-800 dark:text-white text-lg leading-tight truncate">{item.name}</h4>
                                    <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold mt-1 flex items-center gap-1">
                                        <Clock size={12} /> {new Date(order.createdAt).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })}
                                        {item.quantity > 1 && <span className="mr-2 text-blue-500 bg-blue-50 dark:bg-blue-955/35 px-1.5 py-0.5 rounded leading-none">× {item.quantity}</span>}
                                    </p>
                                    <div className="flex justify-between items-end mt-2">
                                        <div className="text-amber-600 dark:text-amber-450 font-black text-sm">{item.price * item.quantity} <span className="text-[10px] opacity-70">صفة</span></div>
                                        {subTab === 'pending' && (
                                            <button 
                                                onClick={() => handleCancelOrder(order.id, idx)}
                                                disabled={isCancelling || !isStoreOpen}
                                                className={`text-[10px] font-black px-3 py-1.5 rounded-lg border transition-all ${isStoreOpen ? 'text-rose-500 dark:text-rose-400 border-rose-100 dark:border-rose-900/30 hover:bg-rose-50 dark:hover:bg-rose-955/20' : 'text-slate-300 dark:text-slate-650 border-slate-100 dark:border-slate-800 cursor-not-allowed'}`}
                                            >
                                                {isStoreOpen ? 'إلغاء' : 'معرض الصفات مغلق'}
                                             </button>
                                        )}
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

export default function StudentStore() {
    const { storeVisible, storeEnabled, storeSchedule: schedule, loading: authLoading } = useAuth();
    const { cart } = useCart();
    const [student, setStudent] = useState(null);
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [points, setPoints] = useState(0);
    const [studentClass, setStudentClass] = useState('');
    const [isStoreOpen, setIsStoreOpen] = useState(true);
    const [timeLeft, setTimeLeft] = useState('');
    const [storeStatusMsg, setStoreStatusMsg] = useState('');
    const [activeTab, setActiveTab] = useState('store');
    const navigate = useNavigate();

    useEffect(() => {
        if (!authLoading && storeVisible === false) {
            navigate('/student/dashboard');
        }
    }, [storeVisible, authLoading, navigate]);

    useEffect(() => {
        cleanupExpiredCarts();
        const studentId = localStorage.getItem('studentId');
        if (!studentId) { navigate('/login'); return; }

        const unsubStudent = onSnapshot(doc(db, 'students', studentId), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setPoints(data.points || 0);
                const sClass = data.assignedClass || data.schoolGrade || '';
                setStudentClass(sClass);
                setStudent(data);
            }
        });

        const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
        const unsubProducts = onSnapshot(q, (snapshot) => {
            const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            setProducts(list);
            setLoading(false);
        });

        return () => { unsubStudent(); unsubProducts(); };
    }, [navigate]);

    if (storeVisible === false) {
        return null;
    }

    useEffect(() => {
        const updateStatus = () => {
            if (!schedule) { setIsStoreOpen(true); setStoreStatusMsg(""); return; }
            if (schedule.isOpen === false) { setIsStoreOpen(false); setStoreStatusMsg("معرض الصفات مغلق حالياً لفصلك الدراسي بقرار من الخادم المتابع"); return; }
            if (!schedule.expiryDate) { setIsStoreOpen(true); setStoreStatusMsg(""); setTimeLeft(""); return; }

            const now = new Date();
            const expiryDate = new Date(schedule.expiryDate);

            if (now < expiryDate) {
                setIsStoreOpen(true);
                const diff = expiryDate - now;
                const d = Math.floor(diff / (1000 * 60 * 60 * 24));
                const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                const s = Math.floor((diff % (1000 * 60)) / 1000);
                let timeStr = "";
                if (d > 0) timeStr += `${d}ي `;
                timeStr += `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                setTimeLeft(timeStr);
                setStoreStatusMsg("");
            } else {
                setIsStoreOpen(false);
                setStoreStatusMsg("معرض الصفات مغلق لانتهاء وقت التشغيل المخصص لفصلك");
            }
        };
        updateStatus();
        const timerId = setInterval(updateStatus, 1000);
        return () => clearInterval(timerId);
    }, [schedule]);

    const visibleProducts = products.filter(p => isProductVisible(p, student));

    return (
        <div className="max-w-6xl mx-auto px-4 py-8 mb-8" dir="rtl">
            <div className="bg-white dark:bg-[#1e293b] p-8 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 mb-8 flex flex-col md:flex-row justify-between items-center gap-6">
                <div>
                    <h2 className="text-slate-500 dark:text-slate-400 font-bold mb-1">رصيدك من الصفات</h2>
                    <p className="text-4xl font-black text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <Star size={32} className="text-amber-500 fill-amber-500" />
                        <span className="text-amber-500 dark:text-amber-400">{points}</span>
                    </p>
                </div>
                <div className="flex gap-4">
                    <button 
                        onClick={() => setActiveTab('store')}
                        className={`px-6 py-2 rounded-lg font-bold transition-all ${activeTab === 'store' ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-50 dark:bg-[#0f172a] text-slate-500 dark:text-slate-400'}`}
                    >
                        معرض الصفات
                    </button>
                    <button 
                        onClick={() => setActiveTab('purchases')}
                        className={`px-6 py-2 rounded-lg font-bold transition-all ${activeTab === 'purchases' ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-50 dark:bg-[#0f172a] text-slate-500 dark:text-slate-400'}`}
                    >
                        مشترياتي
                    </button>
                </div>
            </div>

            {activeTab === 'store' ? (
                !isStoreOpen ? (
                    <div className="max-w-6xl mx-auto px-4 py-16 text-center" dir="rtl">
                        <div className="bg-white dark:bg-[#1e293b] p-12 rounded-[3rem] border border-slate-200 dark:border-slate-800 shadow-xl max-w-2xl mx-auto space-y-6">
                            <div className="w-24 h-24 bg-rose-50 dark:bg-rose-955/35 text-rose-500 rounded-full flex items-center justify-center mx-auto shadow-inner animate-pulse">
                                <AlertCircle size={48} />
                            </div>
                            <h2 className="text-3xl font-black text-slate-800 dark:text-white">معرض الصفات مغلق حالياً لفصلك</h2>
                            <p className="text-slate-500 dark:text-slate-400 font-bold text-lg leading-relaxed">
                                {storeStatusMsg || "نعتذر منك يا بطل. معرض الصفات مغلق حالياً لفصلك الدراسي، وسيكون متاحاً قريباً فور تفعيله من خدام فصلك."}
                            </p>
                            {timeLeft && (
                                <div className="inline-block bg-slate-50 dark:bg-slate-900 px-6 py-2 rounded-xl border border-slate-200 dark:border-slate-800 font-bold text-slate-600 dark:text-slate-300">
                                    معرض الصفات يفتح خلال: {timeLeft}
                                </div>
                            )}
                            <button 
                                onClick={() => setActiveTab('purchases')}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black text-lg shadow-lg shadow-blue-100 dark:shadow-none transition cursor-pointer"
                            >
                                عرض مشترياتي السابقة
                            </button>
                        </div>
                    </div>
                ) : (
                    <div>
                        {schedule && schedule.expiryDate && (
                            <div className="mb-8">
                                <div className="bg-amber-50 dark:bg-amber-955/15 border border-amber-100 dark:border-amber-900/30 p-4 rounded-xl flex justify-between items-center text-amber-800 dark:text-amber-200">
                                    <div className="flex items-center gap-3">
                                        <Clock size={24} />
                                        <span className="font-bold">معرض الصفات متاح لفترة محدودة لفصلك</span>
                                    </div>
                                    <span className="bg-amber-600 dark:bg-amber-500 text-white px-4 py-1 rounded-lg font-bold">ينتهي خلال: {timeLeft}</span>
                                </div>
                            </div>
                        )}

                        {loading || !student ? (
                            <div className="text-center py-20 font-bold text-slate-400">جاري التحميل...</div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                {visibleProducts.map(product => {
                                    const isOutOfStock = product.stock <= 0;
                                    return (
                                        <div 
                                            key={product.id}
                                            onClick={() => isStoreOpen && navigate(`/student/product/${product.id}`)}
                                            className={`bg-white dark:bg-[#1e293b] rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col shadow-sm transition-all hover:shadow-md cursor-pointer ${(!isStoreOpen || isOutOfStock) ? 'grayscale opacity-75' : ''}`}
                                        >
                                            <div className="h-48 bg-slate-50 dark:bg-[#0f172a] relative">
                                                {product.images?.[0] ? (
                                                    <img src={product.images[0]} alt={product.name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-slate-200 dark:text-slate-700"><Package size={48} /></div>
                                                )}
                                                <div className="absolute top-2 right-2 bg-amber-400 text-amber-950 px-3 py-1 rounded-lg font-black text-sm flex items-center gap-1 shadow-sm">
                                                    <Star size={14} fill="#78350f" /> {product.price}
                                                </div>
                                                {isOutOfStock && (
                                                    <div className="absolute inset-0 bg-white/60 dark:bg-slate-900/60 flex items-center justify-center">
                                                        <span className="bg-rose-600 text-white px-4 py-1 rounded-lg font-bold transform -rotate-12">نفد</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="p-4 flex-1 flex flex-col">
                                                <h3 className="font-bold text-lg mb-1 h-14 line-clamp-2 text-slate-800 dark:text-white">{product.name}</h3>
                                                <div className="mt-auto flex justify-between items-center pt-2 border-t border-slate-50 dark:border-slate-800">
                                                    <span className="text-slate-400 dark:text-slate-500 text-xs font-bold">باقي {product.stock}</span>
                                                    <ShoppingBag size={18} className="text-blue-600 dark:text-blue-450" />
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )
            ) : (
                <PurchasesTab studentId={localStorage.getItem('studentId')} isStoreOpen={isStoreOpen} />
            )}
        </div>
    );
}
