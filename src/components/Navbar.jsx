import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
    LogOut, ShoppingCart, Sun, Moon, ShoppingBag, Menu, X, Bell, User, 
    Home, Users, ClipboardCheck, HeartHandshake, Store, PackageCheck, 
    ShieldCheck, BarChart3, BookOpen, Settings, ChevronLeft, Sparkles 
} from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useAppUpdate } from '../context/AppUpdateContext';
import SyncButton from './SyncButton';
import NotificationModal from './NotificationModal';
import AccountMenuDropdown from './AccountMenuDropdown';
import AvatarViewerModal from './AvatarViewerModal';
import { db, collection, query, orderBy, onSnapshot } from '../firebase';

export default function Navbar() {
    const location = useLocation();
    const navigate = useNavigate();
    const cartContext = useCart();
    const getCartCount = cartContext ? cartContext.getCartCount : () => 0;
    const { isGeneralAdmin, isServant, isStudent, servant, student, logout, loading, storeVisible, currentAccount, savedAccounts } = useAuth();
    const { hasUpdate } = useAppUpdate();
    const [isOpen, setIsOpen] = useState(false);
    const [isBellModalOpen, setIsBellModalOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [showTooltip, setShowTooltip] = useState(false);

    // Multi-account menu & Avatar viewer state
    const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
    const [isAvatarViewerOpen, setIsAvatarViewerOpen] = useState(false);

    useEffect(() => {
        if (unreadCount > 0 || hasUpdate) {
            const t = setTimeout(() => setShowTooltip(true), 1500);
            return () => clearTimeout(t);
        } else {
            setShowTooltip(false);
        }
    }, [unreadCount, hasUpdate]);

    useEffect(() => {
        const currentUserId = servant?.id || student?.id;
        if (!currentUserId && !isGeneralAdmin) {
            setUnreadCount(0);
            return;
        }

        const q = query(collection(db, 'notifications'), orderBy('createdAt', 'desc'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const lastRead = parseInt(localStorage.getItem(`lastReadNotifications_${currentUserId || 'admin'}`) || '0', 10);
            
            const now = new Date();
            const incoming = snapshot.docs.filter(docSnap => {
                const data = docSnap.data();
                if (!data.createdAt) return false;

                const createdAtTime = data.createdAt.toMillis ? data.createdAt.toMillis() : 0;
                const publishAtTime = data.publishAt?.toMillis ? data.publishAt.toMillis() : 0;
                const isScheduledForFuture = publishAtTime > createdAtTime + 1000;
                if (isScheduledForFuture && publishAtTime > now.getTime()) {
                    return false;
                }

                if (isStudent && student) {
                    return (data.recipientType === 'students' || data.recipientType === 'both') && (data.recipientIds?.includes(student.id));
                } else if (isServant && servant) {
                    return (data.recipientType === 'servants' || data.recipientType === 'both') && (data.recipientIds?.includes(servant.id));
                } else if (isGeneralAdmin) {
                    return false;
                }
                return false;
            });

            const unread = incoming.filter(msg => {
                const createdTime = msg.data().createdAt?.toMillis ? msg.data().createdAt.toMillis() : 0;
                return createdTime > lastRead;
            });

            setUnreadCount(unread.length);
        }, (error) => {
            console.error("Error listening to notifications badge:", error);
        });

        return () => unsubscribe();
    }, [servant, student, isGeneralAdmin, isServant, isStudent]);

    const normalizeArabic = (str) => {
        if (!str) return '';
        return str
            .replace(/[أإآا]/g, 'ا')
            .replace(/[ىي]/g, 'ي')
            .replace(/[ةه]/g, 'ه')
            .trim();
    };
    const roleNorm = servant?.role ? normalizeArabic(servant.role) : '';
    const isStageAdmin = roleNorm.includes('مرحله');
    const isGenAdmin = isGeneralAdmin && !isStageAdmin;
    const isClassServant = isServant && !isStageAdmin;

    const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');

    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.toggle('dark', theme === 'dark');
        localStorage.setItem('theme', theme);
    }, [theme]);

    useEffect(() => {
        setIsOpen(false);
    }, [location]);

    const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');

    const cleanPath = location.pathname.toLowerCase().trim().replace(/\/$/, '');
    if (loading || ['/login', '/admin/login', '/servant/register', ''].includes(cleanPath)) {
        return null;
    }

    const isActive = (path, searchCheck = null) => {
        if (searchCheck) {
            return location.pathname === path && searchCheck(location.search);
        }
        return location.pathname === path;
    };

    const getNavItems = () => {
        if (isStudent && !isGeneralAdmin && !isServant) {
            const items = [
                { to: '/student/dashboard', title: 'البروفايل', icon: User, active: isActive('/student/dashboard') },
            ];
            if (storeVisible !== false) {
                items.push({ to: '/student/store', title: 'معرض الصفات', icon: Store, active: isActive('/student/store') });
            }
            return items;
        }

        if (isGenAdmin) {
            return [
                { to: '/admin', title: 'الرئيسية', icon: Home, active: isActive('/admin', s => !s.includes('tab=') || s.includes('tab=master_console')) },
                { to: '/admin?tab=attendance', title: 'إدارة المخدومين', icon: Users, active: isActive('/admin', s => s.includes('tab=attendance')) },
                { to: '/admin/attendance', title: 'كشوف حضور المخدومين', icon: ClipboardCheck, active: isActive('/admin/attendance') },
                { to: '/admin/visitation', title: 'الافتقاد والمتابعة', icon: HeartHandshake, active: isActive('/admin/visitation') },
                { to: '/admin/store', title: 'إدارة معرض الصفات', icon: Store, active: isActive('/admin/store') },
                { to: '/admin/orders', title: 'طلبات معرض الصفات', icon: PackageCheck, active: isActive('/admin/orders') },
                { to: '/mass-readings', title: 'قراءات القداس', icon: BookOpen, active: isActive('/mass-readings') },
                { to: '/admin/servants', title: 'إدارة خدام مدارس الأحد', icon: ShieldCheck, active: isActive('/admin/servants') },
                { to: '/admin?tab=notifications', title: 'إدارة الإشعارات', icon: Bell, active: isActive('/admin', s => s.includes('tab=notifications')) },
                { to: '/servant/send-reports', title: 'إرسال التقارير', icon: BarChart3, active: isActive('/servant/send-reports') },
                { to: '/servant/ai', title: 'الذكاء الاصطناعي', icon: Sparkles, active: isActive('/servant/ai') },
                { to: '/admin/settings', title: 'الإعدادات والتحكم', icon: Settings, active: isActive('/admin/settings') },
            ];
        }

        if (isStageAdmin) {
            const overviewPath = isGeneralAdmin ? '/admin' : '/servant/profile';
            const idaraPath = isGeneralAdmin ? '/admin?tab=attendance' : '/servant/dashboard?tab=attendance';
            const notificationsPath = isGeneralAdmin ? '/admin?tab=notifications' : '/servant/dashboard?tab=notifications';
            const attendancePath = isGeneralAdmin ? '/admin/attendance' : '/servant/attendance';
            const visitationPath = isGeneralAdmin ? '/admin/visitation' : '/servant/visitation';

            const items = [
                { to: overviewPath, title: 'الرئيسية', icon: Home, active: isActive(overviewPath, s => !s.includes('tab=')) },
                { to: idaraPath, title: 'إدارة المخدومين', icon: Users, active: isGeneralAdmin ? isActive('/admin', s => s.includes('tab=attendance')) : isActive('/servant/dashboard', s => s.includes('tab=attendance') || !s.includes('tab=')) },
                { to: attendancePath, title: 'كشوف حضور المخدومين', icon: ClipboardCheck, active: isActive(attendancePath) },
                { to: visitationPath, title: 'الافتقاد والمتابعة', icon: HeartHandshake, active: isActive(visitationPath) },
                { to: '/admin/store', title: 'إدارة معرض الصفات', icon: Store, active: isActive('/admin/store') },
                { to: '/admin/orders', title: 'طلبات معرض الصفات', icon: PackageCheck, active: isActive('/admin/orders') },
                { to: '/mass-readings', title: 'قراءات القداس', icon: BookOpen, active: isActive('/mass-readings') },
                { to: '/admin/servants', title: 'إدارة خدام مدارس الأحد', icon: ShieldCheck, active: isActive('/admin/servants') },
                { to: notificationsPath, title: 'إدارة الإشعارات', icon: Bell, active: isGeneralAdmin ? isActive('/admin', s => s.includes('tab=notifications')) : isActive('/servant/dashboard', s => s.includes('tab=notifications')) },
                { to: '/servant/send-reports', title: 'إرسال التقارير', icon: BarChart3, active: isActive('/servant/send-reports') },
            ];
            if (isGeneralAdmin) {
                items.push({ to: '/admin/settings', title: 'الإعدادات والتحكم', icon: Settings, active: isActive('/admin/settings') });
            }
            return items;
        }

        if (isClassServant) {
            return [
                { to: '/servant/profile', title: 'الرئيسية', icon: Home, active: isActive('/servant/profile') },
                { to: '/servant/dashboard?tab=attendance', title: 'إدارة المخدومين', icon: Users, active: isActive('/servant/dashboard', s => s.includes('tab=attendance') || !s.includes('tab=')) },
                { to: '/servant/attendance', title: 'كشوف حضور المخدومين', icon: ClipboardCheck, active: isActive('/servant/attendance') },
                { to: '/servant/visitation', title: 'الافتقاد والمتابعة', icon: HeartHandshake, active: isActive('/servant/visitation') },
                { to: '/admin/store', title: 'إدارة معرض الصفات', icon: Store, active: isActive('/admin/store') },
                { to: '/servant/orders', title: 'طلبات معرض الصفات', icon: PackageCheck, active: isActive('/servant/orders') },
                { to: '/mass-readings', title: 'قراءات القداس', icon: BookOpen, active: isActive('/mass-readings') },
                { to: '/servant/dashboard?tab=notifications', title: 'إدارة الإشعارات', icon: Bell, active: isActive('/servant/dashboard', s => s.includes('tab=notifications')) },
                { to: '/servant/send-reports', title: 'إرسال التقارير', icon: BarChart3, active: isActive('/servant/send-reports') },
            ];
        }

        return [];
    };

    const navItems = getNavItems();

    return (
        <>
            <nav
                className="bg-white dark:bg-[#1e293b] border-b border-slate-100 dark:border-slate-800 px-4 py-2.5 shadow-sm flex justify-between items-center sticky top-0 z-50 transition-colors duration-300 print:hidden"
                dir="rtl"
            >
                {/* ── Logo & Hamburger ─────────────────────────────────── */}
                <div className="flex items-center gap-3.5 flex-1 min-w-0">
                    <button
                        onClick={() => setIsOpen(!isOpen)}
                        className="p-2.5 text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 bg-slate-50 dark:bg-slate-800/80 hover:bg-blue-50/80 dark:hover:bg-blue-950/50 rounded-xl transition-all duration-300 border border-slate-200/80 dark:border-slate-700/80 hover:border-blue-300 dark:hover:border-blue-700/80 cursor-pointer flex items-center justify-center shadow-xs active:scale-95 group"
                        aria-label="Toggle Menu"
                        title="القائمة الرئيسية"
                    >
                        <Menu size={22} className="transition-transform duration-300 group-hover:scale-110" />
                    </button>

                    <span className="text-xl sm:text-2xl font-black bg-gradient-to-l from-blue-600 via-indigo-500 to-teal-400 bg-clip-text text-transparent select-none tracking-tight">
                        خدمتي
                    </span>
                </div>

                {/* ── Right side: Cart / Sync / Bell / Theme / Profile ────────────────────────── */}
                <div className="flex items-center gap-3">
                    {/* Cart (students only, hidden when store is disabled) */}
                    {isStudent && storeVisible !== false && (
                        <Link
                            to="/student/cart"
                            className="relative p-2 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        >
                            <ShoppingCart size={22} />
                            {getCartCount() > 0 && (
                                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-white dark:border-[#1e293b]">
                                    {getCartCount()}
                                </span>
                            )}
                        </Link>
                    )}

                    {/* Sync Button */}
                    {!isStudent && <SyncButton />}

                    {/* Notification Bell */}
                    {!isGeneralAdmin && (
                        <div className="relative">
                            <button
                                onClick={() => {
                                    setIsBellModalOpen(true);
                                    const currentUserId = servant?.id || student?.id;
                                    localStorage.setItem(`lastReadNotifications_${currentUserId || 'admin'}`, Date.now().toString());
                                    setUnreadCount(0);
                                    setShowTooltip(false);
                                }}
                                className="relative p-2.5 text-slate-500 hover:text-[#271e48] dark:hover:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition-all duration-300 flex items-center justify-center border border-transparent hover:border-slate-200 dark:hover:border-slate-700 cursor-pointer"
                                aria-label="Notifications"
                            >
                                <Bell size={18} />
                                {(unreadCount > 0 || hasUpdate) && (
                                    <span className="absolute top-1.5 right-1.5 bg-red-500 w-2.5 h-2.5 rounded-full border border-white dark:border-[#1e293b] animate-pulse"></span>
                                )}
                            </button>

                            {/* Tooltip bubble pointing from the bell */}
                            {showTooltip && (unreadCount > 0 || hasUpdate) && (
                                <div className="absolute right-[-70px] top-12 z-50 w-64 bg-white/95 dark:bg-indigo-950/60 dark:backdrop-blur-md text-slate-700 dark:text-indigo-100 p-3 rounded-xl shadow-xl border border-slate-200/80 dark:border-indigo-500/30 flex items-center gap-2 animate-bounce-subtle text-xs font-bold transition-all duration-300" dir="rtl">
                                    <div className="absolute -top-1.5 right-[86px] w-3 h-3 bg-white/95 dark:bg-indigo-950/60 border-l border-t border-slate-200/80 dark:border-indigo-500/30 transform rotate-45"></div>
                                    <div className="flex-1 text-right leading-relaxed">
                                        {hasUpdate 
                                            ? 'توجد نسخة جديدة متوفرة من التطبيق بمركز الإشعارات! 🚀'
                                            : 'لديك رسائل وتنبيهات غير مقروءة في مركز الإشعارات 🔔'}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Theme toggle */}
                    <button
                        onClick={toggleTheme}
                        className="p-2.5 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition-all duration-300 flex items-center justify-center border border-transparent hover:border-slate-200 dark:hover:border-slate-700 cursor-pointer"
                        aria-label="Toggle Theme"
                    >
                        {theme === 'light'
                            ? <Moon size={18} className="transition-transform duration-500" />
                            : <Sun size={18} className="transition-transform duration-500 rotate-180 text-amber-400" />
                        }
                    </button>

                    {/* Profile Avatar & Account Switcher */}
                    <div className="relative">
                        <button
                            onClick={() => setIsAccountMenuOpen(!isAccountMenuOpen)}
                            className="p-0.5 rounded-full hover:scale-105 active:scale-95 transition-transform border-2 border-blue-500 shadow-sm group cursor-pointer"
                            aria-label="Account Menu"
                        >
                            <div className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-full overflow-hidden bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center">
                                {currentAccount?.photoUrl ? (
                                    <img
                                        src={currentAccount.photoUrl}
                                        alt={currentAccount.name}
                                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                                    />
                                ) : (
                                    <User size={20} className="text-white" />
                                )}
                                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white dark:border-[#1e293b]"></span>
                            </div>
                        </button>

                        <AccountMenuDropdown
                            isOpen={isAccountMenuOpen}
                            onClose={() => setIsAccountMenuOpen(false)}
                            onOpenAvatarViewer={() => setIsAvatarViewerOpen(true)}
                        />
                    </div>
                </div>
            </nav>

            {/* Avatar Viewer & Editor Modal */}
            <AvatarViewerModal
                isOpen={isAvatarViewerOpen}
                onClose={() => setIsAvatarViewerOpen(false)}
                currentPhotoUrl={currentAccount?.photoUrl}
                userName={currentAccount?.name}
                userRole={currentAccount?.role}
            />

            {/* ── Ultra-Smooth Side Drawer Menu (RTL) ───────────────────────────────────────────── */}
            {isOpen && (
                <div dir="rtl" className="relative z-50">
                    {/* Glass Backdrop with Silky Fade */}
                    <div
                        className="fixed inset-0 bg-slate-950/40 dark:bg-black/65 animate-backdrop-smooth"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Noticeable Fluid Fade-in Side Drawer Panel */}
                    <div className="fixed top-0 bottom-0 right-0 w-full max-w-xs sm:max-w-sm bg-white/95 dark:bg-[#1e293b]/95 backdrop-blur-2xl shadow-2xl z-50 flex flex-col border-l border-slate-200/80 dark:border-slate-800/80 animate-drawer-smooth">
                        {/* Drawer Header */}
                        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-900/40">
                            <div className="flex flex-col">
                                <h2 className="text-xl font-black bg-gradient-to-l from-blue-600 via-indigo-500 to-teal-400 bg-clip-text text-transparent tracking-tight">
                                    خدمتي
                                </h2>
                                {currentAccount?.name && (
                                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                                        مرحباً، {currentAccount.name}
                                    </span>
                                )}
                            </div>

                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-xl transition-all duration-200 cursor-pointer active:scale-90"
                                aria-label="إغلاق القائمة"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Navigation Links List with Staggered Fade */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-1.5 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700">
                            <div className="px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                الصفحات والتنقل
                            </div>

                            {navItems.map((item, idx) => {
                                const Icon = item.icon;
                                const isItemActive = item.active;

                                return (
                                    <Link
                                        key={item.to}
                                        to={item.to}
                                        onClick={() => setIsOpen(false)}
                                        style={{ animationDelay: `${idx * 28 + 40}ms` }}
                                        className={`group relative flex items-center justify-between p-3.5 rounded-2xl transition-all duration-250 transform active:scale-[0.98] animate-nav-item ${
                                            isItemActive
                                                ? 'bg-gradient-to-l from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25 font-black'
                                                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100/90 dark:hover:bg-slate-800/80 hover:translate-x-[-3px] font-bold'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3.5">
                                            <div className={`p-2.5 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-110 ${
                                                isItemActive
                                                    ? 'bg-white/20 text-white backdrop-blur-md shadow-inner'
                                                    : 'bg-slate-100 dark:bg-slate-800/90 text-blue-600 dark:text-blue-400 group-hover:bg-blue-500 group-hover:text-white dark:group-hover:bg-blue-600'
                                            }`}>
                                                <Icon size={19} />
                                            </div>
                                            <span className="text-sm sm:text-base tracking-tight leading-tight">{item.title}</span>
                                        </div>

                                        <ChevronLeft size={17} className={`transition-all duration-300 ${
                                            isItemActive 
                                                ? 'opacity-100 translate-x-0 text-white' 
                                                : 'opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 text-slate-400'
                                        }`} />
                                    </Link>
                                );
                            })}
                        </div>

                        {/* Drawer Footer */}
                        <div className="p-4 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/40 dark:bg-slate-900/30 flex items-center justify-between text-xs font-semibold text-slate-400 dark:text-slate-500">
                            <span>تطبيق خدمتي</span>
                            <span className="bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 px-2.5 py-1 rounded-full text-[11px] font-bold border border-blue-100 dark:border-blue-900/50">
                                إصدار 2.0
                            </span>
                        </div>
                    </div>
                </div>
            )}

            <NotificationModal isOpen={isBellModalOpen} onClose={() => setIsBellModalOpen(false)} />
        </>
    );
}
