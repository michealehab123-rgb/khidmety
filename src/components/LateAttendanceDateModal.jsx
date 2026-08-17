import { useState, useMemo } from 'react';
import { X, Calendar, AlertTriangle, CheckCircle, Clock } from 'lucide-react';

export default function LateAttendanceDateModal({
  isOpen,
  onClose,
  onSelectDate = () => {}
}) {
  const [selectedDate, setSelectedDate] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Calculate recent past Fridays
  const recentFridays = useMemo(() => {
    const fridays = [];
    const now = new Date();
    const currentDay = now.getDay();
    
    // Days since last Friday
    const daysSinceFriday = currentDay >= 5 ? currentDay - 5 : currentDay + 2;
    
    for (let i = 0; i < 4; i++) {
      const fDate = new Date(now);
      fDate.setDate(now.getDate() - daysSinceFriday - (i * 7));
      
      const yyyy = fDate.getFullYear();
      const mm = String(fDate.getMonth() + 1).padStart(2, '0');
      const dd = String(fDate.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      
      const label = i === 0 
        ? `الجمعة الماضية (${dateStr})`
        : i === 1 
        ? `الجمعة قبل الماضية (${dateStr})`
        : `الجمعة منذ ${i} أسابيع (${dateStr})`;

      fridays.push({ dateStr, label });
    }
    return fridays;
  }, []);

  const handleConfirm = (dateStr) => {
    const dateToTest = dateStr || selectedDate;
    if (!dateToTest) {
      setErrorMsg('يرجى اختيار تاريخ أولاً');
      return;
    }

    const testDate = new Date(dateToTest);
    if (isNaN(testDate.getTime())) {
      setErrorMsg('التاريخ المختار غير صالح');
      return;
    }

    if (testDate.getDay() !== 5) {
      setErrorMsg('عذراً، يجب اختيار يوم جمعة فقط لتسجيل الحضور المتأخر ⚠️');
      return;
    }

    setErrorMsg('');
    onSelectDate(dateToTest);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-[#1e293b] w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800 bg-amber-50 dark:bg-amber-950/30">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-xl">
              <Clock size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                اختيار يوم الجمعة للحضور المتأخر ⏳
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                حدد يوم الجمعة المراد التسجيل والإضافة له بأثر رجعي
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          
          {/* Recent Fridays Quick Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-2">
              اختيار سريع لآخر أيام جمعة:
            </label>
            <div className="grid grid-cols-1 gap-2">
              {recentFridays.map((item) => (
                <button
                  key={item.dateStr}
                  onClick={() => handleConfirm(item.dateStr)}
                  className="w-full p-3 text-right bg-slate-50 hover:bg-amber-50 dark:bg-[#0f172a] dark:hover:bg-amber-950/40 border border-slate-200 hover:border-amber-400 dark:border-slate-800 text-slate-800 dark:text-slate-200 font-bold text-xs rounded-xl transition-all flex items-center justify-between cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Calendar size={14} className="text-amber-500" />
                    {item.label}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-full font-bold">
                    يوم جمعة ✅
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
            <span className="flex-shrink mx-4 text-xs font-bold text-slate-400">أو اختر تاريخ من التقويم</span>
            <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
          </div>

          {/* Manual Date Input */}
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1.5">
              <Calendar size={14} className="text-amber-500" />
              تاريخ يوم الجمعة المطلوب:
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setErrorMsg('');
              }}
              className="w-full p-3 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-amber-500 text-sm"
            />
          </div>

          {/* Validation Error Message */}
          {errorMsg && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0f172a] flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="py-2.5 px-4 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs hover:bg-slate-300 transition-colors cursor-pointer"
          >
            إلغاء
          </button>
          <button
            onClick={() => handleConfirm(selectedDate)}
            disabled={!selectedDate}
            className="py-2.5 px-5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs shadow-md shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center gap-1.5"
          >
            <CheckCircle size={14} />
            تأكيد واختيار الجمعة 🚀
          </button>
        </div>

      </div>
    </div>
  );
}
