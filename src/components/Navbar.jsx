import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, ShoppingCart, Sun, Moon, ShoppingBag, Menu, X, Bell } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import SyncButton from './SyncButton';
import NotificationModal from './NotificationModal';
import { db, collection, query, orderBy, onSnapshot } from '../firebase';

const navLinkClass = (isActive) =>
    `text-sm font-bold transition-colors px-2.5 py-1.5 rounded-lg
    ${isActive
        ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40'
        : 'text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800/60'
    }`;

const mobileNavLinkClass = (isActive) =>
    `text-base font-black transition-all py-3.5 px-4 rounded-xl block text-right w-full
    ${isActive
        ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 shadow-sm'
        : 'text-slate-600 dark:text-slate-350 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800/60'
    }`;

export default function Navbar() {
    const location = useLocation();
    const navigate = useNavigate();
    const cartContext = useCart();
    const getCartCount = cartContext ? cartContext.getCartCount : () => 0;
    const { isGeneralAdmin, isServant, isStudent, servant, student, logout, loading, storeVisible } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [isBellModalOpen, setIsBellModalOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [showTooltip, setShowTooltip] = useState(false);

    useEffect(() => {
        if (unreadCount > 0) {
            // تأخير بسيط لمنع ظهور الـ tooltip المزعج فور تحميل الصفحة
            const t = setTimeout(() => setShowTooltip(true), 1500);
            return () => clearTimeout(t);
        } else {
            setShowTooltip(false);
        }
    }, [unreadCount]);

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

                // Handle scheduled notifications filtering
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

    const handleLogout = async () => {
        try {
            await logout();
            navigate(isStudent ? '/login' : (isServant ? '/login' : '/admin/login'));
        } catch (error) {
            console.error('Logout error', error);
        }
    };

    const isActive = (path) => location.pathname === path;

    const renderLinks = (isMobile = false) => {
        const linkClass = isMobile ? mobileNavLinkClass : navLinkClass;
        const handleLinkClick = () => {
            if (isMobile) {
                setIsOpen(false);
            }
        };

        if (isStudent && !isGeneralAdmin && !isServant) {
            return (
                <>
                    <Link to="/student/dashboard" className={linkClass(isActive('/student/dashboard'))} onClick={handleLinkClick}>
                        البروفايل
                    </Link>
                    {storeVisible !== false && (
                        <Link to="/student/store" className={linkClass(isActive('/student/store'))} onClick={handleLinkClick}>
                            معرض الصفات
                        </Link>
                    )}
                </>
            );
        }

        if (isGenAdmin) {
            return (
                <>
                    <Link to="/admin" className={linkClass(isActive('/admin') && (!location.search.includes('tab=') || location.search.includes('tab=master_console')))} onClick={handleLinkClick}>
                        الرئيسه
                    </Link>
                    <Link to="/admin?tab=attendance" className={linkClass(isActive('/admin') && location.search.includes('tab=attendance'))} onClick={handleLinkClick}>
                        إدارة المخدومين
                    </Link>
                    <Link to="/admin/attendance" className={linkClass(isActive('/admin/attendance'))} onClick={handleLinkClick}>
                        كشوف حضور المخدومين
                    </Link>
                    <Link to="/admin/visitation" className={linkClass(isActive('/admin/visitation'))} onClick={handleLinkClick}>
                        الافتقاد والمتابعه
                    </Link>
                    <Link to="/admin/store" className={linkClass(isActive('/admin/store'))} onClick={handleLinkClick}>
                        إدارة معرض الصفات
                    </Link>
                    <Link to="/admin/orders" className={linkClass(isActive('/admin/orders'))} onClick={handleLinkClick}>
                        طلبات معرض الصفات
                    </Link>
                    <Link to="/admin/servants" className={linkClass(isActive('/admin/servants'))} onClick={handleLinkClick}>
                        إدارة خدام مدارس الأحد
                    </Link>
                    <Link to="/admin?tab=notifications" className={linkClass(isActive('/admin') && location.search.includes('tab=notifications'))} onClick={handleLinkClick}>
                         اداره الإشعارات
                    </Link>
                    <Link to="/servant/send-reports" className={linkClass(isActive('/servant/send-reports'))} onClick={handleLinkClick}>
                        إرسال التقارير 📊
                    </Link>
                    <Link to="/admin/settings" className={linkClass(isActive('/admin/settings'))} onClick={handleLinkClick}>
                        الإعدادات والتحكم ⚙️
                    </Link>
                </>
            );
        }

        if (isStageAdmin) {
            const overviewPath = isGeneralAdmin ? '/admin' : '/servant/profile';
            const idaraPath = isGeneralAdmin ? '/admin?tab=attendance' : '/servant/dashboard?tab=attendance';
            const notificationsPath = isGeneralAdmin ? '/admin?tab=notifications' : '/servant/dashboard?tab=notifications';
            const attendancePath = isGeneralAdmin ? '/admin/attendance' : '/servant/attendance';
            const visitationPath = isGeneralAdmin ? '/admin/visitation' : '/servant/visitation';
            const ordersPath = '/admin/orders';

            const isOverviewActive = isActive(overviewPath) && !location.search.includes('tab=');
            const isIdaraActive = isGeneralAdmin 
                ? (isActive('/admin') && location.search.includes('tab=attendance')) 
                : (isActive('/servant/dashboard') && (location.search.includes('tab=attendance') || !location.search.includes('tab=')));
            const isNotificationsActive = isGeneralAdmin
                ? (isActive('/admin') && location.search.includes('tab=notifications'))
                : (isActive('/servant/dashboard') && location.search.includes('tab=notifications'));

            return (
                <>
                    <Link to={overviewPath} className={linkClass(isOverviewActive)} onClick={handleLinkClick}>
                        الرئيسه
                    </Link>
                    <Link to={idaraPath} className={linkClass(isIdaraActive)} onClick={handleLinkClick}>
                        إدارة المخدومين
                    </Link>
                    <Link to={attendancePath} className={linkClass(isActive(attendancePath))} onClick={handleLinkClick}>
                        كشوف حضور المخدومين
                    </Link>
                    <Link to={visitationPath} className={linkClass(isActive(visitationPath))} onClick={handleLinkClick}>
                        الافتقاد والمتابعه
                    </Link>
                    <Link to="/admin/store" className={linkClass(isActive('/admin/store'))} onClick={handleLinkClick}>
                        إدارة معرض الصفات
                    </Link>
                    <Link to={ordersPath} className={linkClass(isActive(ordersPath))} onClick={handleLinkClick}>
                        طلبات معرض الصفات
                    </Link>
                    <Link to="/admin/servants" className={linkClass(isActive('/admin/servants'))} onClick={handleLinkClick}>
                        إدارة خدام مدارس الأحد
                    </Link>
                    <Link to={notificationsPath} className={linkClass(isNotificationsActive)} onClick={handleLinkClick}>
                         اداره الإشعارات
                    </Link>
                    <Link to="/servant/send-reports" className={linkClass(isActive('/servant/send-reports'))} onClick={handleLinkClick}>
                        إرسال التقارير 📊
                    </Link>
                    {isGeneralAdmin && (
                        <Link to="/admin/settings" className={linkClass(isActive('/admin/settings'))} onClick={handleLinkClick}>
                            الإعدادات والتحكم ⚙️
                        </Link>
                    )}
                </>
            );
        }

        if (isClassServant) {
            const isIdaraActive = isActive('/servant/dashboard') && (location.search.includes('tab=attendance') || !location.search.includes('tab='));
            const isNotificationsActive = isActive('/servant/dashboard') && location.search.includes('tab=notifications');
            return (
                <>
                    <Link to="/servant/profile" className={linkClass(isActive('/servant/profile'))} onClick={handleLinkClick}>
                        الرئيسه
                    </Link>
                    <Link to="/servant/dashboard?tab=attendance" className={linkClass(isIdaraActive)} onClick={handleLinkClick}>
                        إدارة المخدومين
                    </Link>
                    <Link to="/servant/attendance" className={linkClass(isActive('/servant/attendance'))} onClick={handleLinkClick}>
                        كشوف حضور المخدومين
                    </Link>
                    <Link to="/servant/visitation" className={linkClass(isActive('/servant/visitation'))} onClick={handleLinkClick}>
                        الافتقاد والمتابعه
                    </Link>
                    <Link to="/admin/store" className={linkClass(isActive('/admin/store'))} onClick={handleLinkClick}>
                        إدارة معرض الصفات
                    </Link>
                    <Link to="/servant/orders" className={linkClass(isActive('/servant/orders'))} onClick={handleLinkClick}>
                        طلبات معرض الصفات
                    </Link>
                    <Link to="/servant/dashboard?tab=notifications" className={linkClass(isNotificationsActive)} onClick={handleLinkClick}>
                       اداره الإشعارات
                    </Link>
                    <Link to="/servant/send-reports" className={linkClass(isActive('/servant/send-reports'))} onClick={handleLinkClick}>
                        إرسال التقارير 📊
                    </Link>
                </>
            );
        }

        return null;
    };

    return (
        <>
            <nav
                className="bg-white dark:bg-[#1e293b] border-b border-slate-100 dark:border-slate-800 px-6 py-3.5 shadow-sm flex justify-between items-center sticky top-0 z-50 transition-colors duration-300 print:hidden"
                dir="rtl"
            >
                {/* ── Logo & Mobile Hamburger ─────────────────────────────────── */}
                <div className="flex items-center gap-4 md:gap-8">
                    <button
                        onClick={() => setIsOpen(!isOpen)}
                        className="md:hidden p-2 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition-all"
                        aria-label="Toggle Menu"
                    >
                        {isOpen ? <X size={22} /> : <Menu size={22} />}
                    </button>

                    <span className="text-xl font-black bg-gradient-to-l from-blue-500 to-teal-400 bg-clip-text text-transparent">
                        خدمتي
                    </span>

                    <div className="hidden md:flex items-center gap-1">
                        {renderLinks(false)}
                    </div>
                </div>

                {/* ── Right side: Cart / Theme / Logout ────────────────────────── */}
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
                                {unreadCount > 0 && (
                                    <span className="absolute top-1.5 right-1.5 bg-red-500 w-2 h-2 rounded-full border border-white dark:border-[#1e293b] animate-pulse"></span>
                                )}
                            </button>

                            {/* Tooltip bubble pointing from the bell */}
                            {showTooltip && unreadCount > 0 && (
                                <div className="absolute right-[-70px] top-12 z-50 w-64 bg-white/95 dark:bg-indigo-950/60 dark:backdrop-blur-md text-slate-700 dark:text-indigo-100 p-3 rounded-xl shadow-xl border border-slate-200/80 dark:border-indigo-500/30 flex items-center gap-2 animate-bounce-subtle text-xs font-bold transition-all duration-300" dir="rtl">
                                    {/* Arrow pointing up */}
                                    <div className="absolute -top-1.5 right-[86px] w-3 h-3 bg-white/95 dark:bg-indigo-950/60 border-l border-t border-slate-200/80 dark:border-indigo-500/30 transform rotate-45"></div>
                                    <div className="flex-1 text-right leading-relaxed">
                                        لديك رسائل وتنبيهات غير مقروءة في مركز الإشعارات 🔔
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Theme toggle */}
                    <button
                        onClick={toggleTheme}
                        className="p-2.5 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition-all duration-300 flex items-center justify-center border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                        aria-label="Toggle Theme"
                    >
                        {theme === 'light'
                            ? <Moon size={18} className="transition-transform duration-500" />
                            : <Sun size={18} className="transition-transform duration-500 rotate-180 text-amber-400" />
                        }
                    </button>

                    {/* Logout */}
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 px-4 py-2 text-red-500 dark:text-red-400 font-bold hover:bg-red-50 dark:hover:bg-rose-955/35 rounded-lg transition-all text-sm"
                    >
                        <LogOut size={18} />
                        <span>خروج</span>
                    </button>
                </div>
            </nav>

            {/* ── Mobile Drawer ───────────────────────────────────────────── */}
            {isOpen && (
                <div className="md:hidden fixed inset-x-0 top-[65px] bottom-0 bg-white/95 dark:bg-[#1e293b]/95 backdrop-blur-md z-40 flex flex-col p-6 border-t border-slate-100 dark:border-slate-800 overflow-y-auto animate-in fade-in slide-in-from-top-5">
                    <div className="flex flex-col gap-2">
                        {renderLinks(true)}
                    </div>
                </div>
            )}

            <NotificationModal isOpen={isBellModalOpen} onClose={() => setIsBellModalOpen(false)} />
        </>
    );
}
