import { useNavigate } from 'react-router-dom';
import { ArrowRight, LayoutDashboard } from 'lucide-react';

export default function MyClass() {
    const navigate = useNavigate();

    return (
        <div className="max-w-4xl mx-auto px-4 py-16 text-center" dir="rtl">
            <LayoutDashboard size={64} className="mx-auto mb-6 text-blue-500" />
            <h1 className="text-3xl font-black text-slate-800 mb-4">دخول فصلي</h1>
            <p className="text-slate-500 text-lg mb-8">
                هذه الصفحة قيد التطوير. قريباً ستتمكن من رؤية مخدومين فصلك ومتابعة غيابهم ومشاركتهم.
            </p>
            <button 
                onClick={() => navigate('/servant/profile')}
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 transition-colors"
            >
                <ArrowRight size={20} />
                العودة للصفحة الشخصية
            </button>
        </div>
    );
}
