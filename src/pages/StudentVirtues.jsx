import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, onSnapshot, db } from '../firebase';
import { Star, Trophy, Award, BookOpen, Heart, Activity } from 'lucide-react';

const VirtueCard = ({ title, points, icon: Icon, color, description }) => {
    const isPremium = points >= 100;
    
    return (
        <div className={`relative overflow-hidden p-8 rounded-3xl border-2 transition-all duration-500 group ${
            isPremium 
            ? 'bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-955/20 dark:to-amber-900/10 border-amber-200 dark:border-amber-800 shadow-xl scale-105' 
            : 'bg-white dark:bg-[#1e293b] border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-md text-slate-800 dark:text-slate-200'
        }`}>
            {isPremium && (
                <div className="absolute -top-4 -right-4 bg-amber-400 text-white p-6 rounded-full rotate-12 shadow-lg animate-pulse">
                    <Trophy size={24} />
                </div>
            )}
            
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 transition-transform duration-500 group-hover:rotate-12 ${
                isPremium ? 'bg-amber-400 text-white' : `${color} text-white`
            }`}>
                <Icon size={32} />
            </div>
            
            <h3 className={`text-xl font-black mb-2 ${isPremium ? 'text-amber-900 dark:text-amber-300' : 'text-slate-800 dark:text-white'}`}>
                {title}
            </h3>
            
            <p className={`text-sm font-bold mb-6 ${isPremium ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`}>
                {description}
            </p>
            
            <div className="flex items-baseline gap-2">
                <span className={`text-5xl font-black ${isPremium ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-200'}`}>
                    {points}
                </span>
                <span className={`text-sm font-bold uppercase tracking-widest ${isPremium ? 'text-amber-500 dark:text-amber-500/80' : 'text-slate-400 dark:text-slate-500'}`}>
                    نقطة
                </span>
            </div>

            {isPremium && (
                <div className="mt-6 flex items-center gap-2">
                    <div className="h-1 flex-1 bg-amber-200 dark:bg-amber-950/80 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-500 w-full animate-progress" />
                    </div>
                    <span className="text-[10px] font-black text-amber-600 dark:text-amber-400">مستوى متميز</span>
                </div>
            )}
        </div>
    );
};

export default function StudentVirtues() {
    const [student, setStudent] = useState(null);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        const studentId = localStorage.getItem('studentId');
        if (!studentId) {
            navigate('/login');
            return;
        }

        const unsub = onSnapshot(doc(db, 'students', studentId), (docSnap) => {
            if (docSnap.exists()) {
                setStudent({ id: docSnap.id, ...docSnap.data() });
            } else {
                navigate('/login');
            }
            setLoading(false);
        }, (error) => {
            console.error("Error fetching virtues:", error);
            setLoading(false);
        });

        return () => unsub();
    }, [navigate]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
                <p className="text-lg font-black text-slate-400">جاري فتح معرض الصفات...</p>
            </div>
        );
    }

    const virtues = student?.virtues || {};
    
    return (
        <div className="max-w-6xl mx-auto px-4 py-12" dir="rtl">
            <header className="text-center mb-16 space-y-4">
                <div className="inline-flex items-center gap-2 bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-4 py-2 rounded-full font-black text-sm mb-4 border border-amber-200/50 dark:border-amber-900/30">
                    <Award size={18} /> معرض الصفات المتميز
                </div>
                <h1 className="text-5xl font-black text-slate-900 dark:text-white tracking-tight">لوحة الشرف الخاصة بك</h1>
                <p className="text-xl text-slate-500 dark:text-slate-400 font-bold max-w-2xl mx-auto">
                    كل نقطة تحصل عليها هي خطوة نحو التميز والنمو الروحي. استمر في الاجتهاد!
                </p>
                
                <div className="mt-8 bg-white dark:bg-[#1e293b] inline-flex flex-col items-center p-6 rounded-3xl border-2 border-slate-100 dark:border-slate-800 shadow-sm">
                    <span className="text-slate-400 dark:text-slate-550 font-black text-sm uppercase mb-1">الرصيد الكلي لمعرض الصفات</span>
                    <div className="flex items-center gap-3">
                        <Star size={32} className="text-amber-500 fill-amber-500" />
                        <span className="text-5xl font-black text-slate-800 dark:text-slate-200">{student?.points || 0}</span>
                    </div>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                <VirtueCard 
                    title="الالتزام بالحضور"
                    points={virtues.attendanceCommitment || 0}
                    icon={Activity}
                    color="bg-blue-500"
                    description="الواظبة على القدوم والمشاركة بانتظام"
                />
                <VirtueCard 
                    title="المشاركة التفاعلية"
                    points={virtues.participation || 0}
                    icon={Heart}
                    color="bg-rose-500"
                    description="التفاعل الإيجابي مع الأنشطة والدروس"
                />
                <VirtueCard 
                    title="السلوك الحسن"
                    points={virtues.behavior || 0}
                    icon={Award}
                    color="bg-emerald-500"
                    description="القدوة الصالحة في التعامل مع الآخرين"
                />
                <VirtueCard 
                    title="حفظ الآيات"
                    points={virtues.verses || 0}
                    icon={BookOpen}
                    color="bg-purple-500"
                    description="حفظ وفهم كلمة الله في الكتاب المقدس"
                />
            </div>
            
            <footer className="mt-20 text-center text-slate-400 dark:text-slate-500 font-bold p-8 border-t border-slate-100 dark:border-slate-800">
                سيتم تحديث هذه النقاط بواسطة خدامك بانتظام.
            </footer>
        </div>
    );
}
