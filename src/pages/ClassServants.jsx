import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, getDoc, db } from '../firebase';
import { useNavigate } from 'react-router-dom';
import { Phone, PhoneCall, Users, Shield, ArrowRight, FileSpreadsheet } from 'lucide-react';
import { exportServantsToExcel } from '../utils/excelExport';

export default function ClassServants({ isEmbedded = false, embeddedClass = '' }) {
    const navigate = useNavigate();
    const servantId = localStorage.getItem('servantId');
    const [servant, setServant] = useState(null);
    const [classServants, setClassServants] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!servantId) {
            navigate('/login');
            return;
        }

        let isMounted = true;
        const fetchServant = async () => {
            try {
                const docRef = doc(db, 'servants', servantId);
                const docSnap = await getDoc(docRef);
                if (!isMounted) return;
                if (!docSnap.exists()) {
                    navigate('/login');
                    return;
                }
                setServant({ id: docSnap.id, ...docSnap.data() });
            } catch (err) {
                console.error("Error fetching servant details:", err);
                if (isMounted) setLoading(false);
            }
        };

        fetchServant();
        return () => {
            isMounted = false;
        };
    }, [servantId, navigate]);

    useEffect(() => {
        if (!servant) return;

        const unsub = onSnapshot(collection(db, 'servants'), (snap) => {
            const allServants = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            
            const filtered = allServants.filter(s => {
                if (s.id === servant.id) return false; // exclude self
                if (s.isActive === false || s.status !== 'approved') return false; // exclude deactivated/non-approved
                
                // Check if embedded and filter accordingly
                if (isEmbedded && embeddedClass) {
                    if (embeddedClass === 'الكل') {
                        return s.assignedStage === servant.assignedStage;
                    }
                    return s.myClasses?.includes(embeddedClass) || s.assignedClass === embeddedClass;
                }

                if (servant.role === 'أمين مرحلة') {
                    // Stage admin sees servants in their stage
                    return s.assignedStage === servant.assignedStage || s.assignedClass === servant.assignedClass;
                }
                return s.assignedClass === servant.assignedClass;
            });
            
            setClassServants(filtered);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching class servants:", error);
            setLoading(false);
        });

        return () => {
            unsub();
        };
    }, [servant, isEmbedded, embeddedClass]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
                <p className="text-lg font-medium text-slate-500 dark:text-slate-400">جاري التحميل...</p>
            </div>
        );
    }

    return (
        <div className={isEmbedded ? "w-full text-right" : "min-h-screen bg-slate-50 text-slate-900 dark:bg-[#0f172a] dark:text-slate-50 transition-colors duration-300 py-8"} dir="rtl">
            <div className={isEmbedded ? "" : "max-w-5xl mx-auto px-4"}>
                 {!isEmbedded && (
                     <button 
                        onClick={() => navigate('/servant/profile')}
                        className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-bold hover:text-blue-600 dark:hover:text-blue-400 mb-6 transition-colors"
                    >
                        <ArrowRight size={20} />
                        العودة للوحة التحكم
                    </button>
                 )}

                <header className="mb-10 text-center md:text-right flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 dark:text-white flex items-center gap-3">
                            <Users className="text-blue-600 dark:text-blue-400" size={36} />
                            خدام {embeddedClass || servant.assignedClass || servant.assignedStage || 'الفصل'}
                        </h1>
                        <p className="text-slate-500 dark:text-slate-400 font-bold mt-2">بيانات التواصل مع خدام مدارس الأحد شركاء الخدمة لسهولة التنسیق والمتابعة.</p>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <button
                            type="button"
                            onClick={() => {
                                const allToExport = servant ? [servant, ...classServants] : classServants;
                                exportServantsToExcel(allToExport, embeddedClass || servant?.assignedClass || 'الفصل');
                            }}
                            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 rounded-xl font-bold text-sm shadow-md transition-all cursor-pointer border-none"
                            title="تصدير بيانات الخدام لإكسيل"
                        >
                            <FileSpreadsheet size={18} />
                            <span>تصدير إلى إكسيل</span>
                        </button>
                        <div className="bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 font-black px-6 py-3 rounded-xl border border-blue-100 dark:border-blue-900/50 flex items-center gap-2">
                            <Shield size={20} />
                            إجمالي خدام مدارس الأحد: {classServants.length + (servant ? 1 : 0)}
                        </div>
                    </div>
                </header>

                {classServants.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {classServants.map((s, idx) => (
                            <div key={s.id} className="bg-white dark:bg-[#1e293b] rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 hover:shadow-md transition-shadow relative overflow-hidden group">
                                
                                <div className="flex items-start gap-4 mb-6">
                                    <div className="h-14 w-14 rounded-full bg-slate-100 dark:bg-[#0f172a] flex items-center justify-center text-slate-400 dark:text-slate-500 border-2 border-white dark:border-slate-800 shadow-sm flex-shrink-0">
                                        <UserAvatar name={s.name || 'خادم'} />
                                    </div>
                                    <div className="pt-2">
                                        <h3 className="font-black text-slate-800 dark:text-white text-lg mb-1 leading-none">{s.name}</h3>
                                        <span className="text-xs font-bold px-2 py-1 bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 rounded">
                                            {s.role || 'خادم فصل'}
                                        </span>
                                    </div>
                                </div>

                                <button 
                                    onClick={() => window.location.href = `tel:${s.phone}`}
                                    className="w-full flex items-center justify-center gap-3 bg-slate-50 dark:bg-[#0f172a] hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-slate-700 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-400 border border-slate-200 dark:border-slate-800 hover:border-emerald-200 dark:hover:border-emerald-800/80 p-3 rounded-xl font-black transition-colors group/btn"
                                >
                                    <PhoneCall size={18} className="text-slate-400 dark:text-slate-500 group-hover/btn:text-emerald-600 dark:group-hover/btn:text-emerald-400" />
                                    {s.phone || 'لا يوجد رقم'}
                                </button>

                                {/* Accent line */}
                                <div className="absolute top-0 right-0 w-1 h-full bg-blue-600 dark:bg-blue-500"></div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="bg-white dark:bg-[#1e293b] rounded-2xl border border-slate-200 dark:border-slate-800 p-16 text-center shadow-sm">
                        <Users size={64} className="mx-auto text-slate-200 dark:text-slate-700 mb-4" />
                        <h3 className="text-2xl font-black text-slate-400 dark:text-slate-500 mb-2">لا يوجد خدام آخرون</h3>
                        <p className="text-slate-500 dark:text-slate-400 font-bold">أنت الخادم الوحيد المُسجل في هذا الفصل حالياً.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

const UserAvatar = ({ name }) => {
    let initial = 'خ';
    if (name && typeof name === 'string') {
        initial = name.charAt(0);
    } else if (name && typeof name === 'object' && name.name) {
        initial = name.name.charAt(0);
    }
    return <span className="font-black text-2xl">{initial}</span>;
}
