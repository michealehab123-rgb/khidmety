import React, { useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, UserPlus, LogOut, Trash2, CheckCircle2, ShieldCheck, Sparkles, Camera, ChevronLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function AccountMenuDropdown({ isOpen, onClose, onOpenAvatarViewer }) {
  const navigate = useNavigate();
  const dropdownRef = useRef(null);
  const { 
    currentAccount, 
    savedAccounts, 
    switchAccount, 
    removeSavedAccount, 
    performPurge,
    logout 
  } = useAuth();

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSwitch = async (account) => {
    onClose();
    await switchAccount(account);
  };

  const handleAddAccount = async () => {
    onClose();
    if (performPurge) await performPurge();
    window.location.href = '/login?addAccount=true';
  };

  const handleLogoutCurrent = async () => {
    onClose();
    await logout();
  };

  // Role color generator
  const getRoleBadgeStyle = (role) => {
    if (!role) return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
    if (role.includes('عام')) return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300';
    if (role.includes('مرحله')) return 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-300';
    if (role.includes('خادم') || role.includes('فصل')) return 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300';
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300';
  };

  return (
    <div
      ref={dropdownRef}
      className="absolute top-16 left-4 sm:left-6 z-50 w-80 sm:w-96 bg-white/95 dark:bg-[#1e293b]/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-slate-200/80 dark:border-slate-700/70 overflow-hidden animate-in fade-in slide-in-from-top-3 duration-200"
      dir="rtl"
    >
      {/* ── Active Profile Header Card ────────────────────────────────────── */}
      <div className="p-5 bg-gradient-to-br from-blue-50/80 via-slate-50 to-indigo-50/50 dark:from-slate-800/80 dark:via-[#1e293b] dark:to-indigo-950/40 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-4">
          {/* Avatar button with photo zoom overlay trigger */}
          <div className="relative group cursor-pointer" onClick={() => { onClose(); onOpenAvatarViewer(); }}>
            <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-blue-500 shadow-md bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center">
              {currentAccount?.photoUrl ? (
                <img
                  src={currentAccount.photoUrl}
                  alt={currentAccount.name}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                />
              ) : (
                <User size={32} className="text-white" />
              )}
            </div>
            {/* Camera icon overlay */}
            <div className="absolute inset-0 bg-slate-950/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
              <Camera size={18} />
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-base font-black text-slate-800 dark:text-slate-100 truncate">
                {currentAccount?.name || 'مستخدم غير معروف'}
              </h4>
              <Sparkles size={16} className="text-amber-400 shrink-0" />
            </div>

            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-full border ${getRoleBadgeStyle(currentAccount?.role)}`}>
                {currentAccount?.role || 'مستخدم'}
              </span>
              {currentAccount?.code && (
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  #{currentAccount.code}
                </span>
              )}
            </div>

            <button
              onClick={() => { onClose(); onOpenAvatarViewer(); }}
              className="mt-2 text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              <span>عرض / تعديل الصورة الشخصية</span>
              <ChevronLeft size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Saved Accounts Section ───────────────────────────────────────── */}
      <div className="p-4 max-h-60 overflow-y-auto">
        <div className="flex items-center justify-between px-1 mb-2">
          <span className="text-xs font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            الحسابات المحفوظة ({savedAccounts.length})
          </span>
          <span className="text-[10px] font-bold text-slate-400">
            ميزة التبديل السريع
          </span>
        </div>

        {savedAccounts.length === 0 ? (
          <div className="p-4 text-center text-xs font-medium text-slate-400 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
            لا توجد حسابات أخرى محفوظة على هذا الجهاز. اختر "تذكرني" عند تسجيل الدخول لحفظ الحسابات هنا.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {savedAccounts.map((acc) => {
              const isActive = String(acc.id) === String(currentAccount?.id);
              return (
                <div
                  key={acc.id}
                  className={`group relative flex items-center justify-between p-3 rounded-2xl border transition-all cursor-pointer select-none ${
                    isActive
                      ? 'bg-blue-50/70 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 shadow-sm pointer-events-none'
                      : 'bg-slate-50/50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-[0.99]'
                  }`}
                  onClick={() => !isActive && handleSwitch(acc)}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="relative w-10 h-10 rounded-full overflow-hidden border border-slate-200 dark:border-slate-600 bg-gradient-to-tr from-blue-400 to-indigo-500 flex items-center justify-center shrink-0">
                      {acc.photoUrl ? (
                        <img src={acc.photoUrl} alt={acc.name} className="w-full h-full object-cover" />
                      ) : (
                        <User size={20} className="text-white" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">
                          {acc.name}
                        </span>
                        {isActive && (
                          <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                        )}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate">
                        {acc.role} {acc.code ? `• #${acc.code}` : ''}
                      </div>
                    </div>
                  </div>

                  {!isActive && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (window.confirm(`هل أنت تأكد من إزالة حساب "${acc.name}" من هذا الجهاز؟`)) {
                          removeSavedAccount(acc.id);
                        }
                      }}
                      className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-955/40 rounded-xl transition-all shrink-0 mr-2"
                      title="إزالة الحساب من الجهاز"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Actions Footer ────────────────────────────────────────────────── */}
      <div className="p-4 bg-slate-50/80 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-2">
        {/* Add account button */}
        <button
          onClick={handleAddAccount}
          className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-md shadow-blue-500/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
        >
          <UserPlus size={18} />
          <span>إضافة حساب جديد</span>
        </button>
        <p className="text-[10px] text-center font-bold text-slate-400 dark:text-slate-500">
          تأكد من اختيار "تذكرني" عند تسجل الدخول لحفظ الحساب للتبديل السريع
        </p>

        {/* Logout button */}
        <button
          onClick={handleLogoutCurrent}
          className="w-full py-2 px-4 text-rose-500 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-955/35 font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors mt-1"
        >
          <LogOut size={16} />
          <span>تسجيل الخروج من الحساب الحالي</span>
        </button>
      </div>
    </div>
  );
}
