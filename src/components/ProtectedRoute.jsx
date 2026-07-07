import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * بوابات الأمان وحماية المسارات المفصولة بناءً على الصلاحيات والرتب الجديدة
 *
 * /student/* → الطلاب والمخدومين فقط (isStudent)
 * /servant/* → الخدام وأمناء المراحل (isServant أو الخادم العام للرؤية)
 * /admin/store & /admin/orders → مسارات مشتركة (الكل مسموح له حسب فلاتره المصرحة)
 * /admin/* → الخادم العام وأمين المرحلة (حيث يعرض كل منهما لوحته المخصصة)
 */
const ProtectedRoute = ({ children }) => {
  const { isGeneralAdmin, isStageServant, isServant, isStudent, servant, loading, logout, pageLocks } = useAuth();
  const location = useLocation();

  // حارس التحميل الصارم - يمنع عبور أي مسار أو قراءة داتا طاالما الحساب لم يتم تحميله بالكامل (حالة undefined)
  if (loading || servant === undefined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-[#0f172a] gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600 dark:border-blue-400"></div>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 font-bold">جاري تحميل بيانات الحساب بأمان...</p>
      </div>
    );
  }

  const path = location.pathname;

  // ── اعتراض الصفحات المغلقة مؤقتاً للخدام والمخدومين (مع تخطي الأدمن العام) ──
  if (!isGeneralAdmin && pageLocks) {
    const matchedLockInfo = Object.values(pageLocks).find(lockInfo => {
      if (!lockInfo || !lockInfo.isLocked || !lockInfo.path) return false;
      return path === lockInfo.path || path.startsWith(lockInfo.path + '/');
    });

    if (matchedLockInfo) {
      const lockInfo = matchedLockInfo;
      return (
        <div className="min-h-[70vh] flex items-center justify-center bg-slate-50 dark:bg-[#0f172a] p-4 text-slate-800 dark:text-slate-200" dir="rtl">
          <div className="w-full max-w-lg bg-white dark:bg-[#1e293b] p-8 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 text-center space-y-6 animate-in fade-in zoom-in-95 duration-300">
            <div className="bg-amber-100 dark:bg-amber-500/10 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto shadow-inner text-amber-500 animate-pulse">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            </div>
            
            <div className="space-y-3">
              <h1 className="text-xl font-black text-slate-900 dark:text-white">عذراً، هذه الصفحة غير متاحة مؤقتاً</h1>
              <div className="p-4 bg-slate-50 dark:bg-[#0f172a] rounded-2xl border border-slate-150 dark:border-slate-800">
                <p className="text-slate-600 dark:text-slate-355 font-bold leading-relaxed text-sm">
                  {lockInfo.message || 'الصفحة تحت الإنشاء وتحديث البيانات حالياً. يرجى المحاولة لاحقاً.'}
                </p>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                يتم الآن إجراء بعض التحسينات لتقديم تجربة خدمة أفضل. شكراً لتفهمكم! 🛠️✨
              </p>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => window.history.back()}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-lg transition-all active:scale-[0.98] cursor-pointer"
              >
                العودة للصفحة السابقة
              </button>
            </div>
          </div>
        </div>
      );
    }
  }

  // ── 0. التحقق من حالة حساب الخادم المعلق أو المرفوض أو المحذوف ─────────────────────────────
  if (!isGeneralAdmin && servant && (servant.status === 'pending' || servant.status === 'rejected' || servant.status === 'deleted')) {
    const isPending = servant.status === 'pending';
    const isDeleted = servant.status === 'deleted';
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0f172a] p-4 text-slate-800 dark:text-slate-200" dir="rtl">
        <div className="w-full max-w-md bg-white dark:bg-[#1e293b] p-8 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 text-center space-y-6 animate-in fade-in zoom-in-95 duration-300">
          {isPending ? (
            <>
              <div className="bg-amber-100 dark:bg-amber-500/10 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto shadow-inner text-amber-500 fill-amber-500 animate-pulse">
                <span className="text-4xl">⏳</span>
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-black text-slate-900 dark:text-white">حسابك قيد المراجعة</h1>
                <p className="text-slate-550 dark:text-slate-400 font-bold leading-relaxed text-base">
                  تم إرسال طلبك بنجاح. حسابك حالياً قيد الانتظار في انتظار موافقة أمين الخدمة لتفعيله.
                </p>
              </div>
            </>
          ) : isDeleted ? (
            <>
              <div className="bg-rose-100 dark:bg-rose-500/10 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto shadow-inner text-rose-500">
                <span className="text-4xl">❌</span>
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-black text-slate-900 dark:text-white">تم حذف الحساب</h1>
                <p className="text-slate-550 dark:text-slate-400 font-bold leading-relaxed text-base">
                  نأسف، لقد تم حذف حسابك من قبل الإدارة. يرجى مراجعة المسؤول.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="bg-rose-100 dark:bg-rose-500/10 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto shadow-inner text-rose-500">
                <span className="text-4xl">❌</span>
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-black text-slate-900 dark:text-white">تم رفض الحساب</h1>
                <p className="text-slate-550 dark:text-slate-400 font-bold leading-relaxed text-base">
                  نأسف، لقد تم رفض طلب تسجيلك من قبل أمين الخدمة. يرجى مراجعة البيانات أو التواصل مع الإدارة.
                </p>
              </div>
            </>
          )}

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={async () => {
                try {
                  await logout();
                  window.location.href = '/admin/login';
                } catch (err) {
                  console.error("Logout error:", err);
                }
              }}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg transition-all active:scale-[0.98] cursor-pointer font-bold"
            >
              تسجيل الخروج والعودة
            </button>
          </div>
        </div>
      </div>
    );
  }
  console.log("Route Guard Check -> User:", servant?.name || "خادم عام/مجهول", "isGeneralAdmin:", isGeneralAdmin, "isStageServant:", isStageServant, "Path:", path);

  // ── 1. مسارات المخدومين / الطلاب ──────────────────────────────────────────────
  if (path.startsWith('/student')) {
    if (!isStudent) return <Navigate to="/login" replace />;
    return children;
  }

  // ── 2. مسارات الخدام (تغطي أمين الفصل وأمين المرحلة والخادم العام) ──────────────────
  if (path.startsWith('/servant')) {
    if (!isServant && !isGeneralAdmin && !isStageServant) return <Navigate to="/login" replace />;
    return children;
  }

  // ── 3. المسارات المشتركة لمعرض الصفات والطلبات ─────────────────────────────────
  if (path.startsWith('/admin/store') || path.startsWith('/admin/orders')) {
    if (!isGeneralAdmin && !isServant && !isStageServant) return <Navigate to="/login" replace />;
    return children;
  }

  // ── 4. مسارات الإدارة الكبرى ولوحات التحكم (/admin/*) ────────────────────────────────
  // مسموح فقط للخادم العام (الأمين العام) وأمين المرحلة (ليعرض لوحته الخاصة المعزولة)
  if (path.startsWith('/admin')) {
    if (!isGeneralAdmin && !isStageServant) return <Navigate to="/login" replace />;
    return children;
  }

  // ── 5. حماية التراجع لأي مسار آخر غير معرف ──────────────────────────────────────
  if (!isGeneralAdmin && !isServant && !isStudent) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default ProtectedRoute;