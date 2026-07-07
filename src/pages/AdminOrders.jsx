import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc, runTransaction, serverTimestamp, db } from '../firebase';
import { ShoppingCart, Check, Clock, Package, Printer, Undo, RotateCcw } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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

export default function AdminOrders() {
    const { user, isGeneralAdmin, isServant, servant, loading: authLoading, authorizedClasses } = useAuth();
    const [orders, setOrders] = useState([]);
    const [studentsMap, setStudentsMap] = useState({});
    const [productsMap, setProductsMap] = useState({});
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('pending'); // 'pending' | 'delivered' | 'all'
    const [stageFilter, setStageFilter] = useState('');
    const [classFilter, setClassFilter] = useState('all');
    const [initializedForId, setInitializedForId] = useState(null);

    useEffect(() => {
        if (authLoading) return;

        const currentUserId = (isGeneralAdmin && user?.uid) || servant?.id || 'guest';
        if (initializedForId === currentUserId) return;

        const storedStage = localStorage.getItem('selectedStageFilter');
        const storedClass = localStorage.getItem('selectedClassFilter');

        let stageToUse = storedStage || '';
        let classToUse = storedClass || 'all';

        if (isServant && servant) {
            const servantStage = servant.assignedStage || servant.grade || '';
            stageToUse = servantStage;
            
            if (classToUse !== 'all' && !authorizedClasses.includes(classToUse)) {
                classToUse = authorizedClasses.length > 1 ? 'all' : (authorizedClasses[0] || 'all');
            }
        } else if (isGeneralAdmin) {
            if (!stageToUse) {
                stageToUse = 'ابتدائي';
            }
        }

        setStageFilter(stageToUse);
        setClassFilter(classToUse);
        setInitializedForId(currentUserId);
    }, [isServant, servant, isGeneralAdmin, authLoading, user, initializedForId]);

    const classesJoin = (authorizedClasses || []).join(',');
    useEffect(() => {
        if (!isGeneralAdmin && authorizedClasses && authorizedClasses.length > 0) {
            if (classFilter !== 'all' && !authorizedClasses.includes(classFilter)) {
                const defaultClass = authorizedClasses.length > 1 ? 'all' : authorizedClasses[0];
                setClassFilter(defaultClass);
                localStorage.setItem('selectedClassFilter', defaultClass === 'all' ? '' : defaultClass);
            }
        }
    }, [isGeneralAdmin, classesJoin, classFilter]);

    useEffect(() => {
        if ((!user && !isServant) || authLoading) return;

        const unsubStudents = onSnapshot(collection(db, 'students'), (snapshot) => {
            const sm = {};
            snapshot.docs.forEach(doc => { sm[doc.id] = doc.data(); });
            setStudentsMap(sm);
        });

        const unsubProducts = onSnapshot(collection(db, 'products'), (snapshot) => {
            const pm = {};
            snapshot.docs.forEach(doc => { pm[doc.id] = doc.data(); });
            setProductsMap(pm);
        });

        const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
        const unsubOrders = onSnapshot(q, (snapshot) => {
            const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setOrders(list);
            setLoading(false);

            // Clean up archived orders older than 15 days
            list.forEach(async (order) => {
                if (order.status === 'delivered' && order.deliveredAt) {
                    let deliveredTime = 0;
                    if (typeof order.deliveredAt.toDate === 'function') {
                        deliveredTime = order.deliveredAt.toDate().getTime();
                    } else if (order.deliveredAt && typeof order.deliveredAt.seconds === 'number') {
                        deliveredTime = order.deliveredAt.seconds * 1000;
                    } else {
                        deliveredTime = new Date(order.deliveredAt).getTime();
                    }
                    if (deliveredTime && (Date.now() - deliveredTime > 15 * 24 * 60 * 60 * 1000)) {
                        try {
                            await deleteDoc(doc(db, 'orders', order.id));
                            console.log(`Auto-deleted expired archived order: ${order.id}`);
                        } catch (err) {
                            console.error("Auto-delete expired order error:", err);
                        }
                    }
                }
            });
        }, (error) => {
            console.error("Error fetching orders:", error);
            setLoading(false);
        });

        return () => { unsubStudents(); unsubProducts(); unsubOrders(); };
    }, [user, isServant, authLoading]);

    if (authLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600 dark:border-blue-400"></div>
                <p className="text-lg font-medium text-gray-600 dark:text-slate-400">جاري التحقق من الصلاحيات...</p>
            </div>
        );
    }

    if (!user && !isServant) return <Navigate to="/admin/login" replace />;

    const getDeliveredAtTime = (order) => {
        if (!order) return 0;
        if (order.deliveredAt === null) return Date.now(); // Newly delivered under cache sync
        if (typeof order.deliveredAt === 'undefined') return Date.now(); // Default to now if undefined but status is delivered
        
        let t = 0;
        if (typeof order.deliveredAt.toDate === 'function') {
            t = order.deliveredAt.toDate().getTime();
        } else if (order.deliveredAt && typeof order.deliveredAt.seconds === 'number') {
            t = order.deliveredAt.seconds * 1000;
        } else {
            t = new Date(order.deliveredAt).getTime();
        }
        
        if (isNaN(t) || t === 0) {
            return Date.now(); // Fallback for local placeholders to keep in "delivered" tab
        }
        return t;
    };

    const markDelivered = async (orderId) => {
        if(window.confirm("هل أنت متأكد من تسليم هذا الطلب للمخدوم؟")) {
            try {
                await updateDoc(doc(db, 'orders', orderId), { 
                    status: 'delivered',
                    deliveredAt: serverTimestamp() 
                });
            } catch (error) {
                console.error("Error updating order status:", error);
                alert("حدث خطأ أثناء تحديث حالة الطلب");
            }
        }
    };

    const deleteOrder = async (orderId) => {
        const order = orders.find(o => o.id === orderId);
        if (!order) return;
        const isDelivered = order.status === 'delivered';
        const confirmMsg = isDelivered ? "هل أنت متأكد من حذف هذا الطلب المؤرشف نهائياً؟" : "هل أنت متأكد من حذف الطلب؟ سيتم استرداد النقاط للمخدوم وإعادة اللعبة للمخزن آلياً.";

        if(window.confirm(confirmMsg)) {
            try {
                if (isDelivered) {
                    await deleteDoc(doc(db, 'orders', orderId));
                } else {
                    await runTransaction(db, async (transaction) => {
                        const orderRef = doc(db, 'orders', orderId);
                        const orderSnap = await transaction.get(orderRef);
                        if (!orderSnap.exists()) throw new Error("الطلب غير موجود");
                        const orderData = orderSnap.data();
                        const studentRef = doc(db, 'students', orderData.studentId);
                        const studentSnap = await transaction.get(studentRef);
                        if (!studentSnap.exists()) throw new Error("بيانات المخدوم غير موجودة");

                        const productRefs = [];
                        const productSnaps = [];
                        for (const item of orderData.items || []) {
                            const pid = item.productId || item.id;
                            if (!pid) continue;
                            const pRef = doc(db, 'products', pid);
                            productRefs.push(pRef);
                            productSnaps.push(await transaction.get(pRef));
                        }

                        const currentPoints = studentSnap.data().points || 0;
                        transaction.update(studentRef, { points: currentPoints + (orderData.totalCost || 0) });

                        for (let i = 0; i < productRefs.length; i++) {
                            const pSnap = productSnaps[i];
                            if (pSnap.exists()) {
                                const newStock = (pSnap.data().stock || 0) + orderData.items[i].quantity;
                                transaction.update(productRefs[i], { stock: newStock });
                            }
                        }
                        transaction.delete(orderRef);
                    });
                }
                alert("تم تنفيذ العملية بنجاح.");
            } catch (error) {
                console.error("Error deleting order:", error);
                alert("حدث خطأ أثناء حذف الطلب: " + (error.message || ""));
            }
        }
    };

    const handleReturnOrder = async (orderId) => {
        const order = orders.find(o => o.id === orderId);
        if (!order) return;
        if(window.confirm('هل تريد إلغاء هذا الطلب تماماً؟ سيتم استرداد جميع النقاط للمخدوم وإعادة اللعبة للمخزن فوراً.')) {
            try {
                await runTransaction(db, async (transaction) => {
                    const orderRef = doc(db, 'orders', orderId);
                    const orderSnap = await transaction.get(orderRef);
                    if (!orderSnap.exists()) throw new Error("الطلب غير موجود");
                    const orderData = orderSnap.data();
                    const studentRef = doc(db, 'students', orderData.studentId);
                    const studentSnap = await transaction.get(studentRef);
                    if (!studentSnap.exists()) throw new Error("بيانات المخدوم غير موجودة");

                    const productRefs = [];
                    const productSnaps = [];
                    for (const item of orderData.items || []) {
                        const pid = item.productId || item.id;
                        if (!pid) continue;
                        const pRef = doc(db, 'products', pid);
                        productRefs.push(pRef);
                        productSnaps.push(await transaction.get(pRef));
                    }

                    const currentPoints = studentSnap.data().points || 0;
                    transaction.update(studentRef, { points: currentPoints + (orderData.totalCost || 0) });

                    for (let i = 0; i < productRefs.length; i++) {
                        const pSnap = productSnaps[i];
                        if (pSnap.exists()) {
                            const newStock = (pSnap.data().stock || 0) + orderData.items[i].quantity;
                            transaction.update(productRefs[i], { stock: newStock });
                        }
                    }
                    transaction.delete(orderRef);
                });
                alert("تم إلغاء الطلب واسترداد النقاط بنجاح.");
            } catch (error) {
                console.error("Error processing refund:", error);
                alert("حدث خطأ أثناء معالجة الاسترداد: " + (error.message || ""));
            }
        }
    };

    const moveToWaiting = async (orderId) => {
        if(window.confirm("هل تريد إعادة هذا الطلب لقائمة الانتظار؟")) {
            try {
                await updateDoc(doc(db, 'orders', orderId), { status: 'pending' });
                alert("تمت الإعادة لقائمة الانتظار");
            } catch (error) {
                console.error("Error moving to waiting:", error);
                alert("حدث خطأ أثناء تحديث حالة الطلب");
            }
        }
    };

    const getEffectiveGrade = (order) => {
        const studentDoc = studentsMap[order.studentId];
        if (studentDoc?.schoolGrade) return studentDoc.schoolGrade;
        
        let recordedGrade = order.schoolGrade || order.grade || order.studentGrade;
        if (recordedGrade === 'ملائكة') return 'حضانة/ملائكة';
        return recordedGrade || 'غير محدد';
    };

    const getEffectiveClass = (order) => {
        const studentDoc = studentsMap[order.studentId];
        return studentDoc?.assignedClass || order.assignedClass || order.className || 'غير محدد';
    };

    const isGradeManaged = (gradeName) => {
        if (isGeneralAdmin) return true;
        return (authorizedClasses || []).includes(gradeName);
    };

    const getRepresentativeImage = (order) => {
        if (order.itemImage) return order.itemImage;
        if (order.items?.[0]?.images?.[0]) return order.items[0].images[0];
        const productId = order.itemId || order.items?.[0]?.productId || order.items?.[0]?.id;
        if (productId && productsMap[productId]?.images?.[0]) return productsMap[productId].images[0];
        return 'https://via.placeholder.com/150?text=No+Image';
    };

    const filteredOrders = orders.filter(o => {
        const isPending = (o.status === 'pending' || o.status === 'completed');
        const isDelivered = (o.status === 'delivered');
        const deliveredTime = getDeliveredAtTime(o);
        const isOld = isDelivered && (Date.now() - deliveredTime > 24 * 60 * 60 * 1000);
        const isExpired = isDelivered && (Date.now() - deliveredTime > 15 * 24 * 60 * 60 * 1000);

        let statusMatch = false;
        if (filter === 'all') statusMatch = !isExpired;
        else if (filter === 'pending') statusMatch = isPending;
        else if (filter === 'delivered') statusMatch = isDelivered && !isOld;
        else if (filter === 'archived') statusMatch = isOld && !isExpired;

        if (!statusMatch) return false;

        const orderClass = getEffectiveClass(o);
        if (!isGradeManaged(orderClass)) return false;

        if (isGeneralAdmin && stageFilter) {
            const allowedClasses = STAGE_CLASS_MAP[stageFilter] || [];
            if (!allowedClasses.includes(orderClass)) return false;
        }

        if (classFilter === 'all') return true;
        return orderClass === classFilter;
    });

    const handlePrint = () => window.print();

    const totalItemsMap = {};
    filteredOrders.forEach(order => {
        order.items?.forEach(item => {
            totalItemsMap[item.name] = (totalItemsMap[item.name] || 0) + item.quantity;
        });
    });

    return (
        <div className="max-w-6xl mx-auto px-4 py-8 mb-8" dir="rtl">
            <style>
                {`
                @media print {
                    .no-print { display: none !important; }
                    body { background: white !important; font-size: 11pt; }
                    .order-card { 
                        break-inside: avoid; 
                        border: 1px solid #ddd !important; 
                        margin-bottom: 10px !important; 
                        padding: 10px !important;
                    }
                    .print-header { display: block !important; text-align: center; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 10px; }
                }
                .print-header { display: none; }
                `}
            </style>

            <div className="print-header">
                <h1 className="text-2xl font-bold">كشف طلبات معرض الصفات</h1>
                <p>المرحلة: {stageFilter || 'الكل'} | الفصل: {classFilter === 'all' ? 'الكل' : classFilter} | الحالة: {filter}</p>
            </div>

            <div className="no-print flex flex-col md:flex-row justify-between items-center gap-6 mb-10 pb-6 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-4">
                    <ShoppingCart size={32} className="text-blue-600 dark:text-blue-400" />
                    <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-100">طلبات معرض الصفات</h1>
                </div>
                <button onClick={handlePrint} className="bg-slate-800 dark:bg-slate-800 text-white px-6 py-3 rounded-lg font-bold shadow-md hover:bg-slate-900 dark:hover:bg-slate-700 flex items-center gap-2 cursor-pointer">
                    <Printer size={20} /> طباعة الكشوف
                </button>
            </div>
            
            <div className="no-print space-y-6 mb-10">
                <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-lg gap-1 max-w-lg">
                    {[
                        { id: 'pending', label: `الانتظار (${orders.filter(o => o.status === 'pending' || o.status === 'completed').length})` }, 
                        { id: 'delivered', label: `طلبات معرض الصفات المستلمة (${orders.filter(o => {
                            const isOld = o.status === 'delivered' && (Date.now() - getDeliveredAtTime(o) > 24 * 60 * 60 * 1000);
                            return o.status === 'delivered' && !isOld;
                        }).length})` }, 
                        { id: 'archived', label: `أرشيف طلبات معرض الصفات المستلمة (${orders.filter(o => {
                            const deliveredTime = getDeliveredAtTime(o);
                            const isOld = o.status === 'delivered' && (Date.now() - deliveredTime > 24 * 60 * 60 * 1000);
                            const isExpired = o.status === 'delivered' && (Date.now() - deliveredTime > 15 * 24 * 60 * 60 * 1000);
                            return o.status === 'delivered' && isOld && !isExpired;
                        }).length})` },
                        { id: 'all', label: 'الكل' }
                    ].map(btn => (
                        <button 
                            key={btn.id}
                            onClick={() => setFilter(btn.id)}
                            className={`flex-1 py-2 px-3 rounded-md font-bold text-xs transition-all cursor-pointer ${filter === btn.id ? 'bg-white dark:bg-[#1e293b] text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-355'}`}
                        >
                            {btn.label}
                        </button>
                    ))}
                </div>

                {isGeneralAdmin || isServant ? (
                    <div className="flex flex-col sm:flex-row items-start gap-4 bg-white dark:bg-[#1e293b] p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                        <label className="font-bold text-slate-600 dark:text-slate-400 pt-2.5">تصفية طلبات معرض الصفات:</label>
                        <div className="flex flex-col sm:flex-row gap-3 flex-1 w-full">
                            {/* Stage Selector */}
                            {isGeneralAdmin ? (
                                <select
                                    value={stageFilter}
                                    onChange={e => {
                                        const nextStage = e.target.value;
                                        setStageFilter(nextStage);
                                        localStorage.setItem('selectedStageFilter', nextStage);
                                        setClassFilter('all');
                                        localStorage.setItem('selectedClassFilter', '');
                                    }}
                                    className="w-full sm:w-44 p-2 bg-white dark:bg-[#1e293b] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-lg font-bold outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="">كل المراحل</option>
                                    {Object.keys(STAGE_CLASS_MAP).map(s => (
                                        <option key={s} value={s}>{s}</option>
                                    ))}
                                </select>
                            ) : (
                                <div className="w-full sm:w-44 p-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg font-bold text-slate-700 dark:text-slate-200">
                                    المرحلة: {stageFilter || 'غير محدد'}
                                </div>
                            )}

                            {/* Class Selector */}
                            {isGeneralAdmin ? (
                                <select
                                    value={classFilter}
                                    onChange={e => {
                                        const nextClass = e.target.value;
                                        setClassFilter(nextClass);
                                        localStorage.setItem('selectedClassFilter', nextClass === 'all' ? '' : nextClass);
                                    }}
                                    className="w-full sm:w-56 p-2 bg-white dark:bg-[#1e293b] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-lg font-bold outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                                    disabled={!stageFilter}
                                >
                                    <option value="all">{stageFilter ? 'كل فصول المرحلة' : 'اختر المرحلة أولاً'}</option>
                                    {(STAGE_CLASS_MAP[stageFilter] || []).map(cls => (
                                        <option key={cls} value={cls}>{cls}</option>
                                    ))}
                                </select>
                            ) : (
                                <select
                                    value={classFilter}
                                    onChange={e => {
                                        const nextClass = e.target.value;
                                        setClassFilter(nextClass);
                                        localStorage.setItem('selectedClassFilter', nextClass === 'all' ? '' : nextClass);
                                    }}
                                    className="w-full sm:w-56 p-2 bg-white dark:bg-[#1e293b] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-lg font-bold outline-none focus:ring-2 focus:ring-blue-500"
                                    disabled={authorizedClasses.length <= 1}
                                >
                                    {authorizedClasses.length > 1 && <option value="all">كل الفصول</option>}
                                    {(authorizedClasses || []).map(cls => (
                                        <option key={cls} value={cls}>{cls}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    </div>
                ) : null}
            </div>

            {loading ? (
                <div className="text-center py-20 font-bold text-slate-400 dark:text-slate-500">جاري التحميل...</div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    {filteredOrders.length === 0 ? (
                        <div className="col-span-full text-center py-20 font-bold text-slate-450 dark:text-slate-500 bg-white dark:bg-[#1e293b] rounded-2xl border border-slate-200 dark:border-slate-800">
                            لا توجد طلبات لعرضها في هذه التصفية.
                        </div>
                    ) : (
                        filteredOrders.map(order => (
                            <div key={order.id} className="order-card bg-white dark:bg-[#1e293b] p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col">
                                <div className="mb-4">
                                    <h3 className="font-bold text-lg text-slate-800 dark:text-white">{order.studentName}</h3>
                                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                                        <span className="inline-block bg-slate-100 dark:bg-transparent text-slate-600 dark:text-white text-base font-medium px-2 py-0.5 rounded border border-slate-200 dark:border-none dark:p-0">
                                            {getEffectiveGrade(order)}
                                        </span>
                                        <span className="inline-block bg-blue-50 dark:bg-transparent text-blue-600 dark:text-white text-base font-medium px-2.5 py-1 rounded-full border border-blue-100 dark:border-none dark:p-0">
                                            فصل: {getEffectiveClass(order)}
                                        </span>
                                        {order.status === 'pending' && (
                                            <span className="inline-block bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm font-semibold tracking-wide px-3 py-1 rounded-full border border-amber-250 dark:border-amber-500/20">
                                                معلق
                                            </span>
                                        )}
                                        {order.status === 'delivered' && (
                                            <span className="inline-block bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-sm font-semibold tracking-wide px-3 py-1 rounded-full border border-emerald-250 dark:border-emerald-500/20">
                                                تم التسليم
                                            </span>
                                        )}
                                        {order.status !== 'pending' && order.status !== 'delivered' && (
                                            <span className="inline-block bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 text-sm font-semibold tracking-wide px-3 py-1 rounded-full border border-rose-250 dark:border-rose-500/20">
                                                ملغي
                                            </span>
                                        )}
                                    </div>
                                    {order.createdAt && (
                                        <div className="text-base text-slate-300 dark:text-slate-200 font-medium mt-2">
                                            تاريخ الطلب: {order.createdAt.toDate ? order.createdAt.toDate().toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : new Date(order.createdAt).toLocaleDateString('ar-EG')}
                                        </div>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-2 mb-4">
                                    {order.items?.map((item, i) => {
                                        const pid = item.productId || item.id;
                                        const img = item.images?.[0] || productsMap[pid]?.images?.[0] || 'https://via.placeholder.com/150?text=No+Image';
                                        return (
                                            <div key={i} className="h-24 bg-slate-50 dark:bg-slate-900 rounded-lg overflow-hidden border border-slate-100 dark:border-slate-800 relative group">
                                                <img src={img} alt={item.name} className="w-full h-full object-cover transition-transform group-hover:scale-110" title={item.name} />
                                                {item.quantity > 1 && (
                                                    <div className="absolute top-1 left-1 bg-blue-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded shadow-sm">
                                                        × {item.quantity}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {/* Fallback if no items but have legacy single image */}
                                    {(!order.items || order.items.length === 0) && (
                                        <div className="col-span-2 h-32 bg-slate-50 dark:bg-slate-900 rounded-lg overflow-hidden border border-slate-100 dark:border-slate-805">
                                            <img src={getRepresentativeImage(order)} alt="Product" className="w-full h-full object-cover" />
                                        </div>
                                    )}
                                </div>

                                <div className="flex-1 space-y-2 mb-6">
                                    {order.items?.map((item, i) => (
                                        <div key={i} className="text-sm font-bold flex justify-between border-b border-slate-50 dark:border-slate-800/50 pb-1 text-slate-700 dark:text-slate-200 animate-none">
                                            <span className="text-lg font-semibold dark:text-slate-100">{item.name} (x{item.quantity})</span>
                                            <span className="text-xl font-bold text-amber-500 dark:text-amber-400">{item.price * item.quantity} ص</span>
                                        </div>
                                    ))}
                                    <div className="pt-2 font-bold flex justify-between text-slate-800 dark:text-slate-200 border-t border-slate-100 dark:border-slate-800">
                                        <span className="text-lg font-semibold">الإجمالي</span>
                                        <span className="text-xl font-bold text-amber-500 dark:text-amber-400">{order.totalCost} صفة</span>
                                    </div>
                                </div>

                                <div className="no-print mt-auto flex gap-2">
                                    {order.status !== 'delivered' ? (
                                        <>
                                            <button onClick={() => markDelivered(order.id)} className="flex-1 bg-emerald-500 dark:bg-emerald-600 text-white py-2 rounded-lg font-bold hover:bg-emerald-600 dark:hover:bg-emerald-500 transition-colors flex items-center justify-center gap-1 cursor-pointer">
                                                <Check size={16} /> تسليم
                                            </button>
                                            <button onClick={() => deleteOrder(order.id)} className="p-2 bg-rose-50 dark:bg-slate-800 text-rose-500 dark:text-rose-400 rounded-lg hover:bg-rose-105 border border-transparent dark:border-slate-700 hover:dark:bg-slate-700 cursor-pointer"><RotateCcw size={16}/></button>
                                        </>
                                    ) : (
                                        <div className="flex gap-2 w-full">
                                            <button onClick={() => moveToWaiting(order.id)} className="flex-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 py-2 rounded-lg font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all flex items-center justify-center gap-1 cursor-pointer">
                                                <Undo size={16} /> إعادة للانتظار
                                            </button>
                                            <button onClick={() => handleReturnOrder(order.id)} className="p-2 bg-amber-50 dark:bg-slate-800 text-amber-600 dark:text-amber-400 rounded-lg hover:bg-amber-100 dark:hover:bg-slate-700 border border-transparent dark:border-slate-700 cursor-pointer" title="إرجاع اللعبة واسترداد النقاط">
                                                <RotateCcw size={16} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
