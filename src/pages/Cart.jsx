import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { runTransaction, doc, onSnapshot, collection, db } from '../firebase';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { cleanupExpiredCarts } from '../utils/cartCleanup';
import { Trash2, ShoppingCart, ArrowRight, Star, AlertCircle, CheckCircle, Clock } from 'lucide-react';

export default function Cart() {
    const navigate = useNavigate();
    const { storeVisible } = useAuth();
    const { cart, removeFromCart, updateQuantity, clearCartItems, getCartTotal, getCartCount, loading: cartLoading } = useCart();
    const [points, setPoints] = useState(0);
    const [loading, setLoading] = useState(false);
    const [studentId, setStudentId] = useState(null);
    const [studentName, setStudentName] = useState('');
    const [orderSuccess, setOrderSuccess] = useState(false);
    const [schedule, setSchedule] = useState(null);
    const [isStoreOpen, setIsStoreOpen] = useState(true);
    const [processingId, setProcessingId] = useState(null); // Tracks item being updated/deleted

    // Redirect away if the store is hidden by admin
    useEffect(() => {
        if (storeVisible === false) {
            navigate('/student/dashboard', { replace: true });
        }
    }, [storeVisible, navigate]);

    useEffect(() => {
        cleanupExpiredCarts();
        const sid = localStorage.getItem('studentId');
        if (!sid) {
            navigate('/login');
            return;
        }
        setStudentId(sid);

        const unsubStudent = onSnapshot(doc(db, 'students', sid), (docSnap) => {
            if (docSnap.exists()) {
                setPoints(docSnap.data().points || 0);
                setStudentName(docSnap.data().name || '');
            }
        });

        const unsubSchedule = onSnapshot(doc(db, 'settings', 'storeSchedule'), (docSnap) => {
            if (docSnap.exists()) {
                setSchedule(docSnap.data());
            } else {
                setSchedule(null);
            }
        });

        return () => {
            unsubStudent();
            unsubSchedule();
        };
    }, [navigate]);

    useEffect(() => {
        const checkStatus = () => {
            if (!schedule) {
                setIsStoreOpen(true);
                return;
            }
            if (schedule.isManualOpen === false) {
                setIsStoreOpen(false);
                return;
            }
            if (!schedule.expiryDate) {
                setIsStoreOpen(true);
                return;
            }
            const now = new Date();
            const expiryDate = new Date(schedule.expiryDate);
            setIsStoreOpen(now < expiryDate);
        };
        checkStatus();
        const timerId = setInterval(checkStatus, 1000);
        return () => clearInterval(timerId);
    }, [schedule]);

    const handleCheckout = async () => {
        if (cart.length === 0) return;
        
        if (!isStoreOpen) {
            alert('عذراً، معرض الصفات مغلق حالياً، لا يمكنك إتمام عملية الشراء.');
            return;
        }
        
        const totalCost = getCartTotal();
        
        if (points < totalCost) {
            alert(`عذراً، رصيدك من الصفات لا يكفي. الرصيد (${points}) والإجمالي (${totalCost})`);
            return;
        }

        setLoading(true);

        try {
            await runTransaction(db, async (transaction) => {
                const studentRef = doc(db, 'students', studentId);
                const studentDoc = await transaction.get(studentRef);

                if (!studentDoc.exists()) {
                    throw new Error("بيانات المخدوم غير موجودة");
                }

                const studentData = studentDoc.data();
                const currentPoints = studentData.points || 0;
                const schoolGrade = studentData.schoolGrade || 'غير محدد';
                const assignedClass = studentData.assignedClass || 'غير محدد';
                
                if (currentPoints < totalCost) {
                    throw new Error("رصيدك الحالي من الصفات لا يكفي لإتمام هذه العملية.");
                }

                transaction.update(studentRef, { points: currentPoints - totalCost });

                const newOrderRef = doc(collection(db, 'orders'));
                transaction.set(newOrderRef, {
                    studentId: studentId,
                    studentName: studentName,
                    grade: schoolGrade,
                    assignedClass: assignedClass,
                    items: cart,
                    itemImage: cart[0]?.images?.[0] || '',
                    itemId: cart[0]?.productId || '',
                    totalCost: totalCost,
                    createdAt: new Date().toISOString(),
                    status: 'pending'
                });
            });

            await clearCartItems();
            setOrderSuccess(true);
        } catch (error) {
            console.error("Transaction failed: ", error);
            alert(error.message || 'حدث خطأ غير متوقع أثناء إتمام الشراء، الرجاء المحاولة مرة أخرى.');
        } finally {
            setLoading(false);
        }
    };

    if (orderSuccess) {
        return (
            <div className="w-full max-w-2xl mx-auto px-4 py-20 text-center" dir="rtl">
                <div className="bg-white dark:bg-[#1e293b] p-10 rounded-[3rem] shadow-xl dark:shadow-none border border-emerald-50 dark:border-emerald-950/20">
                    <div className="bg-emerald-100 dark:bg-emerald-955/35 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-8">
                        <CheckCircle size={56} className="text-emerald-500 dark:text-emerald-450" />
                    </div>
                    <h1 className="text-3xl font-black text-emerald-600 dark:text-emerald-400 mb-4 tracking-tight">تم إتمام الشراء بنجاح!</h1>
                    <p className="text-slate-500 dark:text-slate-450 font-bold text-lg mb-10 leading-relaxed">
                        مبروك يا {studentName.split(' ')[0]}، تم خصم الصفات بنجاح. استمتع بألعابك الجديدة!
                    </p>
                    <button 
                        onClick={() => navigate('/student/store')} 
                        className="w-full sm:w-auto px-10 py-5 bg-blue-600 text-white rounded-[2rem] text-xl font-black shadow-xl dark:shadow-none hover:bg-blue-700 active:scale-95 transition-all"
                    >
                        العودة لمعرض الصفات
                    </button>
                </div>
            </div>
        );
    }

    if (cartLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
                <p className="text-lg font-medium text-slate-450">جاري تحميل السلة...</p>
            </div>
        );
    }

    return (
        <div className="w-full max-w-6xl mx-auto px-4 py-8 mb-8" dir="rtl">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-10">
                <div className="flex items-center gap-4">
                    <div className="bg-blue-600 p-3 rounded-2xl text-white shadow-lg dark:shadow-none">
                        <ShoppingCart size={28} />
                    </div>
                    <h1 className="text-2xl md:text-3xl font-black text-slate-800 dark:text-white tracking-tight">سلة المشتريات</h1>
                </div>
                <Link to="/student/store" className="flex items-center gap-2 text-slate-400 dark:text-slate-500 font-bold hover:text-blue-600 dark:hover:text-blue-400 transition-colors group">
                    <span>متابعة التسوق</span>
                    <ArrowRight size={18} className="group-hover:translate-x-[-4px] transition-transform" />
                </Link>
            </div>

            {cart.length === 0 ? (
                <div className="bg-white dark:bg-[#1e293b] py-24 px-6 rounded-[3rem] text-center border border-slate-100 dark:border-slate-800 shadow-sm max-w-2xl mx-auto text-slate-800 dark:text-slate-200">
                    <div className="bg-slate-50 dark:bg-[#0f172a] w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-8">
                        <ShoppingCart size={48} className="text-slate-300 dark:text-slate-650" />
                    </div>
                    <h2 className="text-2xl font-black text-slate-800 dark:text-white mb-2">سلّتك فارغة حالياً</h2>
                    <p className="text-slate-400 dark:text-slate-500 font-bold mb-10">اكتشف الألعاب الرائعة في معرضنا وأضفها للسلة.</p>
                    <button 
                        onClick={() => navigate('/student/store')} 
                        className="px-10 py-5 bg-blue-600 text-white rounded-2xl text-xl font-black shadow-xl dark:shadow-none hover:bg-blue-700 active:scale-95 transition-all"
                    >
                        تصفح معرض الصفات
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 items-start">
                    
                    {/* Cart Items List */}
                    <div className="lg:col-span-2 space-y-4">
                        {cart.map(item => (
                            <div key={item.cartDocId} className="group bg-white dark:bg-[#1e293b] p-5 rounded-3xl shadow-sm border border-slate-50 dark:border-slate-800 hover:shadow-md transition-all flex items-center gap-5 relative overflow-hidden text-slate-800 dark:text-slate-200">
                                <div className="w-24 h-24 md:w-32 md:h-32 rounded-2xl overflow-hidden shadow-sm flex-shrink-0 border border-transparent dark:border-slate-800">
                                    <img 
                                        src={item.images?.[0] || 'https://via.placeholder.com/150?text=\u0644\u0627+\u062a\u0648\u062c\u062f+\u0635\u0648\u0631\u0629'} 
                                        alt={item.name} 
                                        className="w-full h-full object-cover transition-transform group-hover:scale-110 duration-500" 
                                    />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-lg md:text-xl font-black text-slate-800 dark:text-white truncate mb-1">{item.name}</h3>
                                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-450 font-black">
                                        <Star size={16} className="fill-amber-500 text-amber-500" />
                                        <span>{item.price} صفة</span>
                                    </div>
                                    
                                    {/* Mobile View: Quantity & Delete */}
                                    <div className="flex md:hidden items-center justify-between mt-4">
                                        <div className="flex items-center bg-slate-100 dark:bg-slate-900 p-1 rounded-xl gap-3 border border-slate-200 dark:border-slate-800">
                                            <button 
                                                onClick={() => !processingId && updateQuantity(item.productId, item.quantity - 1, item.quantity)}
                                                disabled={item.quantity <= 1 || processingId === item.productId}
                                                className="w-8 h-8 flex items-center justify-center font-black text-slate-500 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-250 active:scale-90 disabled:opacity-30"
                                            >-</button>
                                            <span className="font-black text-slate-800 dark:text-white text-sm">{item.quantity}</span>
                                            <button 
                                                onClick={() => !processingId && updateQuantity(item.productId, item.quantity + 1, item.quantity)}
                                                disabled={processingId === item.productId}
                                                className="w-8 h-8 flex items-center justify-center font-black text-slate-500 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-250 active:scale-90 disabled:opacity-30"
                                            >+</button>
                                        </div>
                                        <button 
                                            onClick={() => window.confirm('هل تريد حذف هذه اللعبة من السلة؟') && removeFromCart(item.productId, item.quantity)}
                                            className="p-3 text-rose-500 bg-rose-50 dark:bg-rose-955/20 rounded-xl active:bg-rose-100 dark:active:bg-rose-900/30"
                                        >
                                            <Trash2 size={20} />
                                        </button>
                                    </div>
                                </div>

                                {/* Desktop View: Price, Quantity & Delete */}
                                <div className="hidden md:flex items-center gap-6">
                                    <div className="flex items-center bg-slate-50 dark:bg-slate-900 p-1.5 rounded-2xl gap-4 border border-slate-100 dark:border-slate-800">
                                        <button 
                                            onClick={() => !processingId && updateQuantity(item.productId, item.quantity - 1, item.quantity)}
                                            disabled={item.quantity <= 1 || processingId === item.productId}
                                            className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white dark:hover:bg-[#1e293b] hover:shadow-sm font-black text-xl text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-all disabled:opacity-30"
                                        >-</button>
                                        <span className="font-black text-xl text-slate-800 dark:text-white min-w-[20px] text-center">{item.quantity}</span>
                                        <button 
                                            onClick={() => !processingId && updateQuantity(item.productId, item.quantity + 1, item.quantity)}
                                            disabled={processingId === item.productId}
                                            className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white dark:hover:bg-[#1e293b] hover:shadow-sm font-black text-xl text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-all disabled:opacity-30"
                                        >+</button>
                                    </div>
                                    <div className="text-left min-w-[100px]">
                                        <div className="text-xs font-bold text-slate-400 dark:text-white mb-1">الإجمالي</div>
                                        <div className="text-xl font-black text-amber-600 dark:text-amber-450 flex items-center justify-end gap-1">
                                            {item.price * item.quantity}
                                            <Star size={16} className="fill-amber-500 text-amber-500" />
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => window.confirm('\u0647\u0644 \u062a\u0631\u064a\u062f \u062d\u0630\u0641 \u0647\u0630\u0647 \u0627\u0644\u0644\u0631\u0628\u0629 \u0645\u0646 \u0627\u0644\u0633\u0644\u0629\u061f') && removeFromCart(item.productId, item.quantity)}
                                        className="p-4 text-rose-500 bg-rose-50 dark:bg-rose-955/20 rounded-2xl hover:bg-rose-100 dark:hover:bg-rose-900/30 hover:text-rose-600 dark:hover:text-rose-400 transition-all active:scale-90"
                                    >
                                        <Trash2 size={24} />
                                    </button>
                                </div>

                                {processingId === item.productId && (
                                    <div className="absolute inset-0 bg-white/60 dark:bg-slate-900/60 backdrop-blur-[1px] flex items-center justify-center z-10 transition-all">
                                        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-600"></div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Order Summary Sidebar */}
                    <div className="lg:sticky lg:top-24 space-y-6">
                        <div className="bg-white dark:bg-[#1e293b] p-8 rounded-[2.5rem] shadow-sm border border-slate-50 dark:border-slate-800 overflow-hidden relative text-slate-800 dark:text-slate-200">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl -mr-16 -mt-16"></div>
                            <h2 className="text-2xl font-black text-slate-800 dark:text-white mb-8 pb-4 border-b border-slate-100 dark:border-slate-800">ملخص الطلب</h2>
                            
                            <div className="space-y-4 mb-10">
                                <div className="flex justify-between items-center text-slate-500 dark:text-white font-bold">
                                    <span>عدد الألعاب</span>
                                    <span className="text-slate-800 dark:text-slate-200">{getCartCount()} ألعاب</span>
                                </div>
                                <div className="flex justify-between items-center pt-4 border-t border-slate-100 dark:border-slate-800">
                                    <span className="text-lg font-black text-slate-800 dark:text-white">إجمالي المطلوب</span>
                                    <div className="flex items-center gap-2 text-2xl font-black text-amber-600 dark:text-amber-450">
                                        {getCartTotal()}
                                        <Star size={24} className="fill-amber-500 text-amber-500" />
                                    </div>
                                </div>
                            </div>

                            <div className={`p-6 rounded-3xl mb-8 border-2 transition-all group ${points < getCartTotal() ? 'bg-rose-50 dark:bg-rose-950/25 border-rose-100 dark:border-rose-950/30' : 'bg-blue-50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/40'}`}>
                                <div className="flex justify-between items-center mb-4">
                                    <span className="font-black text-slate-600 dark:text-white">رصيدك الحالي</span>
                                    <div className="flex items-center gap-1.5 text-xl font-black text-amber-600 dark:text-amber-450">
                                        {points}
                                        <Star size={20} className="fill-amber-500 text-amber-500" />
                                    </div>
                                </div>
                                {points < getCartTotal() && (
                                    <div className="flex items-start gap-2 p-3 bg-white/60 dark:bg-slate-900/60 rounded-2xl text-rose-600 dark:text-rose-450 text-xs font-bold leading-relaxed">
                                        <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                        <span>رصيدك لا يكفي! تحتاج {getCartTotal() - points} صفة إضافية.</span>
                                    </div>
                                )}
                            </div>

                            {/* Cart Expiry Alert */}
                            <div className="bg-amber-50 dark:bg-amber-950/15 p-5 rounded-3xl border border-amber-100 dark:border-amber-900/30 flex gap-4 mb-10">
                                <div className="bg-amber-100 dark:bg-[#0f172a] p-2 rounded-xl text-amber-600 dark:text-amber-400 h-fit">
                                    <Clock size={20} />
                                </div>
                                <div>
                                    <span className="block font-black text-amber-800 dark:text-amber-200 text-sm mb-1">تنبيه هام:</span>
                                    <p className="text-amber-700/80 dark:text-amber-450/85 text-[11px] font-bold leading-normal">
                                        الألعاب المحجوزة تعود للمخزن تلقائياً إذا لم يتم إتمام الشراء خلال <strong className="text-amber-900 dark:text-amber-300">60 دقيقة</strong>.
                                    </p>
                                </div>
                            </div>

                            {!isStoreOpen && (
                                <div className="bg-rose-500 text-white p-4 rounded-2xl mb-6 flex items-center gap-3 font-black text-xs shadow-lg dark:shadow-none">
                                    <Clock size={20} />
                                    <span>{schedule?.isManualOpen === false ? 'معرض الصفات مغلق حالياً بقرار من الخدمة.' : 'معرض الصفات مغلق الآن.'}</span>
                                </div>
                            )}

                            <button
                                onClick={handleCheckout}
                                disabled={loading || points < getCartTotal() || !isStoreOpen}
                                className={`w-full py-5 rounded-3xl text-xl font-black flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl dark:shadow-none ${
                                    (loading || points < getCartTotal() || !isStoreOpen)
                                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-505 cursor-not-allowed shadow-none'
                                    : 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-emerald-100 dark:shadow-none'
                                }`}
                            >
                                {loading ? (
                                    <div className="animate-spin rounded-full h-6 w-6 border-2 border-white/30 border-t-white"></div>
                                ) : (
                                    <>
                                        <CheckCircle size={24} />
                                        <span>{!isStoreOpen ? 'معرض الصفات مغلق' : 'تأكيد الشراء'}</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
}
