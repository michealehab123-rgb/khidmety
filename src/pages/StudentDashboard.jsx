import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { doc, onSnapshot, updateDoc, db, deleteField } from '../firebase';
import { Gift, Star, Calendar, Save, Lock, Plus, User, Award, Smartphone, MapPin, X, QrCode, Camera, CheckCircle, XCircle, BookOpen } from 'lucide-react';
import StudentCard from '../components/StudentCard';

const MiniVirtueBadge = ({ title, points, color }) => (
    <div className="flex flex-col items-center p-4 rounded-2xl bg-slate-50 dark:bg-[#0f172a] border border-slate-100 dark:border-slate-800 transition-all hover:shadow-sm">
        <div className={`w-10 h-10 rounded-xl ${color} text-white flex items-center justify-center mb-2 shadow-sm`}>
            <Award size={20} />
        </div>
        <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 mb-1">{title}</span>
        <span className="text-lg font-black text-slate-800 dark:text-slate-200">{points}</span>
    </div>
);

const getSafeClassId = (className) => {
    if (!className) return '';
    return className.replace(/\//g, '-');
};

const compressImage = (file, maxWidth = 400, maxHeight = 400) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                // Compress to jpeg format at 0.85 quality for crisp resolution
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                resolve(dataUrl);
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
};

export default function StudentDashboard() {
    const [student, setStudent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isBirthday, setIsBirthday] = useState(false);
    const [formData, setFormData] = useState({ 
        name: '', 
        addresses: [''], 
        phones: [''], 
        fatherOfConfession: '',
        birthDate: ''
    });
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const isInit = useRef(false);
    const [consecutiveGiftEnabled, setConsecutiveGiftEnabled] = useState(false);
    const [showCardModal, setShowCardModal] = useState(false);
    const navigate = useNavigate();
    const { storeVisible } = useAuth();
    const [gettingLocation, setGettingLocation] = useState(false);
    const [isMutatingConfession, setIsMutatingConfession] = useState(false);

    useEffect(() => {
        const studentId = localStorage.getItem('studentId');
        if (!studentId) {
            navigate('/login');
            return;
        }

        const unsub = onSnapshot(doc(db, 'students', studentId), (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setStudent({ id: docSnap.id, ...data });
                if (!isInit.current) {
                    setFormData({
                        name: data.name || '',
                        addresses: (data.addresses && data.addresses.length > 0) ? data.addresses : (data.address ? [data.address] : ['']),
                        phones: (data.phones && data.phones.length > 0) ? data.phones : (data.phone ? [data.phone] : ['']),
                        fatherOfConfession: data.fatherOfConfession || '',
                        birthDate: data.birthDate || ''
                    });
                    isInit.current = true;
                }
                checkBirthday(data.birthDate);
            } else {
                navigate('/login');
            }
            setLoading(false);
        }, (error) => {
            console.error("Error fetching student:", error);
            setLoading(false);
        });

        return () => unsub();
    }, [navigate]);

    useEffect(() => {
        if (!student || !student.assignedClass) {
            setConsecutiveGiftEnabled(false);
            return;
        }
        const safeClassId = getSafeClassId(student.assignedClass);
        if (!safeClassId) {
            setConsecutiveGiftEnabled(false);
            return;
        }
        const docRef = doc(db, 'attendance_config', safeClassId);
        const unsub = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                setConsecutiveGiftEnabled(!!docSnap.data().consecutiveGiftEnabled);
            } else {
                setConsecutiveGiftEnabled(false);
            }
        }, (error) => {
            console.error("Error fetching class config:", error);
            setConsecutiveGiftEnabled(false);
        });
        return () => unsub();
    }, [student?.assignedClass]);

    const checkBirthday = (dateString) => {
        if (!dateString) return;
        const today = new Date();
        const birthDate = new Date(dateString);
        if (today.getDate() === birthDate.getDate() && today.getMonth() === birthDate.getMonth()) {
            setIsBirthday(true);
        }
    };

    const handleUpdateInfo = async () => {
        try {
            const finalData = {
                addresses: formData.addresses.filter(a => a.trim() !== ''),
                phones: formData.phones.filter(p => p.trim() !== ''),
                fatherOfConfession: formData.fatherOfConfession
            };

            // Only allow saving birthDate if editable
            const canEditBirthDate = student?.addedViaBulk === true && student?.studentEditedBirthDate !== true;
            if (canEditBirthDate && formData.birthDate && formData.birthDate !== student.birthDate) {
                const selectedDate = new Date(formData.birthDate);
                const today = new Date();
                if (selectedDate > today) {
                    alert('تاريخ الميلاد لا يمكن أن يكون في المستقبل');
                    return;
                }
                finalData.birthDate = formData.birthDate;
                finalData.studentEditedBirthDate = true;
            }

            // Name is read-only and cannot be changed by the student

            await updateDoc(doc(db, 'students', student.id), finalData);
            alert('تم تحديث بياناتك بنجاح');
        } catch (error) {
            console.error("Error updating info:", error);
            alert('حدث خطأ أثناء التحديث');
        }
    };

    const handleGetLocation = () => {
        if (!navigator.geolocation) {
            alert("عذراً، متصفحك لا يدعم ميزة تحديد الموقع الجغرافي.");
            return;
        }

        setGettingLocation(true);
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const { latitude, longitude } = position.coords;
                try {
                    await updateDoc(doc(db, 'students', student.id), {
                        homeLocation: {
                            latitude,
                            longitude,
                            updatedAt: new Date().toISOString()
                        }
                    });
                    alert("📍 تم تحديد موقع المنزل وحفظه بنجاح!");
                } catch (error) {
                    console.error("Error saving location:", error);
                    alert("حدث خطأ أثناء حفظ الموقع، يرجى المحاولة مرة أخرى.");
                } finally {
                    setGettingLocation(false);
                }
            },
            (error) => {
                console.error("Geolocation error:", error);
                let message = "حدث خطأ أثناء تحديد الموقع.";
                if (error.code === error.PERMISSION_DENIED) {
                    message = "يرجى السماح بصلاحية الوصول للموقع الجغرافي لتحديد منزلك.";
                } else if (error.code === error.POSITION_UNAVAILABLE) {
                    message = "معلومات الموقع الجغرافي غير متوفرة حالياً.";
                } else if (error.code === error.TIMEOUT) {
                    message = "انتهت مهلة طلب الحصول على الموقع.";
                }
                alert(message);
                setGettingLocation(false);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    };

    const handleUpdatePassword = async () => {
        if (!newPassword || !confirmPassword) {
            alert('الرجاء إدخال كلمة المرور وتأكيدها');
            return;
        }
        if (newPassword !== confirmPassword) {
            alert('كلمتا المرور غير متطابقتين');
            return;
        }

        try {
            await updateDoc(doc(db, 'students', student.id), {
                password: newPassword,
                isPasswordChanged: true
            });
            alert('تم تغيير كلمة المرور بنجاح');
            setNewPassword('');
            setConfirmPassword('');
        } catch (error) {
            console.error("Error updating password:", error);
            alert('حدث خطأ أثناء تغيير كلمة المرور');
        }
    };

    const handleToggleConfession = async () => {
        if (isMutatingConfession) return;
        setIsMutatingConfession(true);

        const today = new Date();
        const monthKey = `${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
        const isCurrentlyConfessed = student?.confessions?.[monthKey]?.status === true;

        try {
            if (!isCurrentlyConfessed) {
                await updateDoc(doc(db, 'students', student.id), {
                    [`confessions.${monthKey}`]: {
                        status: true,
                        date: new Date().toISOString(),
                        markedBy: 'المخدوم نفسه'
                    }
                });
                alert('تم تسجيل اعترافك لهذا الشهر بنجاح! ⛪🎉');
            } else {
                if (window.confirm('هل أنت متأكد من إلغاء تسجيل اعترافك لهذا الشهر؟')) {
                    await updateDoc(doc(db, 'students', student.id), {
                        [`confessions.${monthKey}`]: deleteField()
                    });
                    alert('تم إلغاء تسجيل الاعتراف.');
                }
            }
        } catch (error) {
            console.error("Error toggling confession:", error);
            alert('حدث خطأ أثناء تعديل حالة الاعتراف.');
        } finally {
            setIsMutatingConfession(false);
        }
    };

    const handlePhotoUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert('الرجاء اختيار ملف صورة صالح');
            return;
        }

        try {
            const base64Str = await compressImage(file, 400, 400);
            await updateDoc(doc(db, 'students', student.id), {
                photoUrl: base64Str
            });
            alert('تم تحديث صورتك الشخصية بنجاح 🥳');
        } catch (error) {
            console.error("Error uploading photo:", error);
            alert('حدث خطأ أثناء رفع الصورة');
        }
    };


    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
                <p className="text-lg font-black text-slate-400">جاري فتح لوحة التحكم...</p>
            </div>
        );
    }
    
    if (!student) return null;

    const virtues = student.virtues || {};

    return (
        <div className="max-w-5xl mx-auto px-4 py-8" dir="rtl">
            <header className="mb-10 text-center md:text-right flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                    <h1 className="text-4xl font-black text-slate-800 dark:text-white">أهلاً، {student.name.split(' ')[0]} 👋</h1>
                    <p className="text-slate-500 dark:text-slate-400 font-bold">إليك نظرة سريعة على تقدمك</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 items-center">
                    <button 
                        onClick={() => setShowCardModal(true)}
                        className="flex items-center gap-2 bg-gradient-to-l from-blue-600 to-teal-500 hover:from-blue-700 hover:to-teal-600 text-white px-5 py-2.5 rounded-2xl font-black text-sm shadow-lg transition-all active:scale-95 cursor-pointer"
                    >
                        <QrCode size={16} />
                        <span>عرض الكارنيه (QR) 💳</span>
                    </button>
                    <div className="bg-blue-600 text-white px-6 py-2.5 rounded-2xl font-black text-sm shadow-lg">
                        كود المخدوم: {student.code}
                    </div>
                </div>
            </header>

            {consecutiveGiftEnabled && (
                <div className="bg-[#1e293b] border border-slate-800 shadow-xl rounded-3xl p-6 text-white mb-10 transition-colors duration-300">
                    <h3 className="text-xl font-black mb-4 text-amber-400 flex items-center gap-2">
                        <span>لوحة التزامك وبطولتك 🏆</span>
                    </h3>
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="flex items-center gap-3 bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50">
                                <span className="text-2xl">🔥</span>
                                <p className="font-bold text-slate-200 text-sm">
                                    استريك الحضور المتتالي: <span className="font-black text-orange-400 text-base px-1" dir="ltr">{student.attendanceStreak || 0}</span>
                                </p>
                            </div>
                            <div className="flex items-center gap-3 bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50">
                                <span className="text-2xl">🎁</span>
                                <p className="font-bold text-slate-200 text-sm">
                                    الهدايا الجاهزة للاستلام: <span className="font-black text-amber-400 text-base px-1" dir="ltr">{student.pendingGifts || 0}</span>
                                </p>
                            </div>
                        </div>
                        <div className="bg-slate-800/30 p-4 rounded-2xl border border-slate-700/40 text-slate-355 text-sm font-semibold text-center leading-relaxed">
                            يلا عاش يا بطل! تعالى مدارس الأحد الأسبوع الجاي علشان تكمل الـ 4 مرات و تاخد الهديه😍
                        </div>
                    </div>
                </div>
            )}

            {isBirthday && (
                <div className="bg-gradient-to-r from-amber-400 to-orange-500 p-1 rounded-3xl mb-10 shadow-xl overflow-hidden animate-in zoom-in duration-500">
                    <div className="bg-white/95 dark:bg-[#1e293b]/95 backdrop-blur-sm p-8 rounded-[22px] text-center relative">
                        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                            <Gift className="absolute top-4 left-4 rotate-12" size={48} />
                            <Star className="absolute bottom-4 right-4 -rotate-12 text-amber-500" size={32} />
                        </div>
                        <Gift size={64} className="mx-auto mb-4 text-amber-500 animate-bounce" />
                        <h2 className="text-3xl font-black text-slate-800 dark:text-white mb-2">عيد ميلاد سعيد! 🎉</h2>
                        <p className="text-slate-600 dark:text-slate-300 font-bold text-lg">كل سنة وأنت طيب ومنور الكنيسة يا {student.name.split(' ')[0]}!</p>
                    </div>
                </div>
            )}

            {storeVisible !== false && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                    <div className="md:col-span-3 bg-white dark:bg-[#1e293b] p-8 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center text-center group hover:border-amber-200 dark:hover:border-amber-550/30 transition-all">
                        <div className="bg-amber-100 dark:bg-amber-500/10 p-4 rounded-2xl mb-4 group-hover:scale-110 transition-transform">
                            <Star size={40} className="text-amber-500 fill-amber-500" />
                        </div>
                        <h3 className="text-slate-450 dark:text-slate-400 font-black text-sm uppercase tracking-widest mb-1">الرصيد الكلي</h3>
                        <p className="text-5xl font-black text-amber-500 dark:text-amber-400 tracking-tighter">{student.points || 0}</p>
                        <Link to="/student/store" className="mt-4 text-amber-600 dark:text-amber-450 font-black text-xs hover:underline">انتقل لمعرض الصفات ←</Link>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white dark:bg-[#1e293b] p-8 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                    <h3 className="text-2xl font-black mb-8 flex items-center gap-3 text-slate-800 dark:text-white">
                        <User size={24} className="text-blue-600 dark:text-blue-400" />
                        البيانات الشخصية
                    </h3>
                    
                    <div className="space-y-6">
                        {/* Student Photo Uploader */}
                        <div className="flex flex-col items-center justify-center mb-6 pb-6 border-b border-slate-100 dark:border-slate-800/80">
                            <div className="relative group">
                                <div className="w-32 h-32 bg-slate-50 dark:bg-[#0f172a] rounded-full flex items-center justify-center border-4 border-slate-200 dark:border-slate-800 shadow-md overflow-hidden transition-all duration-300">
                                    {student.photoUrl ? (
                                        <img 
                                            src={student.photoUrl} 
                                            alt="الصورة الشخصية" 
                                            className="w-full h-full object-cover" 
                                        />
                                    ) : (
                                        <User size={56} className="text-slate-400 dark:text-slate-555" />
                                    )}
                                </div>
                                <label 
                                    htmlFor="photo-upload-input" 
                                    className="absolute bottom-0 right-0 bg-blue-600 hover:bg-blue-700 text-white p-2.5 rounded-full shadow-lg cursor-pointer transition-all duration-200 hover:scale-110 flex items-center justify-center z-10"
                                    title="تحديث الصورة الشخصية"
                                >
                                    <Camera size={14} className="text-white" />
                                    <input 
                                        id="photo-upload-input" 
                                        type="file" 
                                        accept="image/*" 
                                        className="hidden" 
                                        onChange={handlePhotoUpload}
                                    />
                                </label>
                            </div>
                            <p className="text-[10px] font-black text-slate-450 uppercase tracking-widest mt-3">تحديث الصورة الشخصية 📸</p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-400 uppercase tracking-widest mb-2 mr-1">الاسم بالكامل</label>
                                <div className="p-4 bg-slate-50 dark:bg-[#0f172a] rounded-2xl font-black text-slate-500 dark:text-slate-450 border-2 border-transparent">{student.name}</div>
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-400 uppercase tracking-widest mb-2 mr-1">المرحلة الدراسية</label>
                                <div className="p-4 bg-slate-50 dark:bg-[#0f172a] rounded-2xl font-black text-slate-500 dark:text-slate-450 border-2 border-transparent">{student.schoolGrade || '-'}</div>
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-400 uppercase tracking-widest mb-2 mr-1">اسم الفصل</label>
                                <div className="p-4 bg-slate-50 dark:bg-[#0f172a] rounded-2xl font-black text-slate-500 dark:text-slate-450 border-2 border-transparent">{student.assignedClass || '-'}</div>
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-400 uppercase tracking-widest mb-2 mr-1">تاريخ الميلاد</label>
                                {(student.addedViaBulk === true && student.studentEditedBirthDate !== true) ? (
                                    <input 
                                        type="date"
                                        className="w-full p-4 bg-slate-50 dark:bg-[#0f172a] border-2 border-transparent dark:border-slate-800 focus:border-blue-500 dark:focus:border-blue-500 rounded-2xl font-black text-slate-700 dark:text-slate-100 transition-all outline-none" 
                                        value={formData.birthDate || ''}
                                        onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })}
                                    />
                                ) : (
                                    <div className="p-4 bg-slate-50 dark:bg-[#0f172a] rounded-2xl font-black text-slate-500 dark:text-slate-450 border-2 border-transparent flex items-center justify-between">
                                        <span>{student.birthDate || '-'}</span>
                                        <Lock size={14} className="text-slate-400 dark:text-slate-500" />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div>
                            <label className="block text-[10px] font-black text-slate-400 dark:text-slate-400 uppercase tracking-widest mb-2 mr-1">أب الاعتراف</label>
                            <input 
                                className="w-full p-4 bg-slate-50 dark:bg-[#0f172a] border-2 border-transparent dark:border-slate-800 focus:border-blue-500 dark:focus:border-blue-500 rounded-2xl font-black text-slate-700 dark:text-slate-100 transition-all outline-none" 
                                value={formData.fatherOfConfession}
                                onChange={(e) => setFormData({ ...formData, fatherOfConfession: e.target.value })}
                                placeholder="اسم أب الاعتراف"
                            />
                        </div>

                        <div>
                            <label className="text-slate-400 dark:text-slate-400 text-sm font-semibold tracking-wide block mb-1.5 mr-1">أرقام التليفون</label>
                            <div className="space-y-3">
                                {formData.phones.map((phone, idx) => (
                                    <div key={idx} className="flex gap-2 group animate-in slide-in-from-right-2">
                                        <div className="flex-1 relative">
                                            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 dark:text-slate-600"><Smartphone size={16} /></div>
                                            <input 
                                                className="w-full p-4 pr-11 bg-slate-50 dark:bg-[#0f172a] border-2 border-transparent dark:border-slate-800 focus:border-emerald-500 dark:focus:border-emerald-500 rounded-2xl font-black text-slate-700 dark:text-slate-100 transition-all outline-none" 
                                                value={phone}
                                                onChange={(e) => {
                                                    const newPhones = [...formData.phones];
                                                    newPhones[idx] = e.target.value;
                                                    setFormData({ ...formData, phones: newPhones });
                                                }}
                                                placeholder="012XXXXXXXX"
                                                dir="ltr"
                                            />
                                        </div>
                                        {idx === formData.phones.length - 1 ? (
                                            <button onClick={() => setFormData({ ...formData, phones: [...formData.phones, ''] })} className="p-4 bg-emerald-50 dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 border border-transparent dark:border-slate-700 rounded-2xl hover:bg-emerald-100 dark:hover:bg-slate-700 transition-colors">
                                                <Plus size={20} />
                                            </button>
                                        ) : (
                                            <button onClick={() => setFormData({ ...formData, phones: formData.phones.filter((_, i) => i !== idx) })} className="p-4 bg-rose-50 dark:bg-rose-955/20 text-rose-500 dark:text-rose-450 rounded-2xl hover:bg-rose-100 dark:hover:bg-rose-900/20 transition-colors">
                                                <X size={20} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="text-slate-400 dark:text-slate-400 text-sm font-semibold tracking-wide block mb-1.5 mr-1">العنـاوين</label>
                            <div className="space-y-3">
                                {formData.addresses.map((address, idx) => (
                                    <div key={idx} className="flex gap-2 animate-in slide-in-from-left-2">
                                        <div className="flex-1 relative">
                                            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 dark:text-slate-600"><MapPin size={16} /></div>
                                            <input 
                                                className="w-full p-4 pr-11 bg-slate-50 dark:bg-[#0f172a] border-2 border-transparent dark:border-slate-800 focus:border-emerald-500 dark:focus:border-emerald-500 rounded-2xl font-black text-slate-700 dark:text-slate-100 transition-all outline-none" 
                                                value={address}
                                                onChange={(e) => {
                                                    const newAddresses = [...formData.addresses];
                                                    newAddresses[idx] = e.target.value;
                                                    setFormData({ ...formData, addresses: newAddresses });
                                                }}
                                                placeholder="المنطقة، الشارع، الشقة..."
                                            />
                                        </div>
                                        {idx === formData.addresses.length - 1 ? (
                                            <button onClick={() => setFormData({ ...formData, addresses: [...formData.addresses, ''] })} className="p-4 bg-emerald-50 dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 border border-transparent dark:border-slate-700 rounded-2xl hover:bg-emerald-100 dark:hover:bg-slate-700 transition-colors">
                                                <Plus size={20} />
                                            </button>
                                        ) : (
                                            <button onClick={() => setFormData({ ...formData, addresses: formData.addresses.filter((_, i) => i !== idx) })} className="p-4 bg-rose-50 dark:bg-rose-955/20 text-rose-500 dark:text-rose-450 rounded-2xl hover:bg-rose-100 dark:hover:bg-rose-900/20 transition-colors">
                                                <X size={20} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* GPS Location Registration Section */}
                        <div className="p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-150 dark:border-blue-900/40 rounded-2xl">
                            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                                <div className="text-right w-full sm:w-auto">
                                    <h4 className="font-black text-slate-800 dark:text-slate-200 text-sm flex items-center gap-1.5">
                                        <MapPin size={16} className="text-blue-600 dark:text-blue-400" />
                                        موقع المنزل الجغرافي (GPS)
                                    </h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-bold mt-1 leading-relaxed">
                                        {student.homeLocation 
                                            ? `مسجل بنجاح (خط العرض: ${student.homeLocation.latitude.toFixed(4)}، خط الطول: ${student.homeLocation.longitude.toFixed(4)})`
                                            : 'لم يتم تسجيل موقع المنزل بعد. يرجى الضغط على الزر أثناء وجودك في المنزل لتسجيل الإحداثيات بدقة.'}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    disabled={gettingLocation}
                                    onClick={handleGetLocation}
                                    className={`w-full sm:w-auto px-5 py-2.5 rounded-xl text-sm font-black text-white transition-all flex items-center justify-center gap-2 cursor-pointer ${
                                        gettingLocation 
                                            ? 'bg-slate-400 dark:bg-slate-700 cursor-not-allowed'
                                            : student.homeLocation
                                                ? 'bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 shadow-md'
                                                : 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 shadow-md'
                                    }`}
                                >
                                    {gettingLocation ? (
                                        <>
                                            <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                                            <span>جاري التحديد...</span>
                                        </>
                                    ) : student.homeLocation ? (
                                        <>
                                            <MapPin size={15} />
                                            <span>تحديث موقع المنزل 📍</span>
                                        </>
                                    ) : (
                                        <>
                                            <MapPin size={15} />
                                            <span>تحديد موقع المنزل 📍</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                        
                        <button onClick={handleUpdateInfo} className="w-full flex items-center justify-center gap-3 bg-slate-900 text-white font-bold text-base py-3 px-6 rounded-xl hover:bg-black dark:bg-blue-600 dark:hover:bg-blue-500 transition-all duration-200 shadow-md">
                            <Save size={20} /> حفظ التعديلات
                        </button>
                    </div>
                </div>

                <div className="space-y-8">
                    <div className="bg-white dark:bg-[#1e293b] p-8 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                        <h3 className="text-xl font-black mb-6 flex items-center gap-2 text-slate-800 dark:text-white">
                            <Lock size={20} className="text-amber-500" />
                            تغيير كلمة المرور
                        </h3>
                        
                        <div className="space-y-4 mb-6">
                            <input 
                                type="password"
                                className="w-full p-4 bg-slate-50 dark:bg-[#0f172a] border-2 border-transparent dark:border-slate-800 focus:border-amber-500 dark:focus:border-amber-500 rounded-2xl font-black text-slate-700 dark:text-slate-100 outline-none transition-all" 
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="كلمة المرور الجديدة"
                            />
                            <input 
                                type="password"
                                className="w-full p-4 bg-slate-50 dark:bg-[#0f172a] border-2 border-transparent dark:border-slate-800 focus:border-amber-500 dark:focus:border-amber-500 rounded-2xl font-black text-slate-700 dark:text-slate-100 outline-none transition-all" 
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="تأكيد كلمة المرور"
                            />
                        </div>
                        
                        <button onClick={handleUpdatePassword} className="w-full flex items-center justify-center gap-2 bg-amber-500 text-white py-4 rounded-2xl font-black hover:bg-amber-600 transition-all shadow-md">
                            <Lock size={18} /> تحديث كلمة السر
                        </button>
                    </div>

                    {/* كارت متابعة الاعترافات للمخدوم */}
                    <div className="bg-white dark:bg-[#1e293b] p-8 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                        <h3 className="text-xl font-black mb-6 flex items-center justify-between text-slate-800 dark:text-white">
                            <span className="flex items-center gap-2">
                                <BookOpen size={20} className="text-blue-600 dark:text-blue-400" />
                                متابعة اعترافاتي ⛪
                            </span>
                            <span className="bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400 border border-transparent dark:border-purple-500/20 text-sm font-medium px-3 py-1 rounded-lg">
                                إجمالي الاعترافات: {Object.values(student.confessions || {}).filter(c => c && c.status === true).length}
                            </span>
                        </h3>

                        {(() => {
                            const today = new Date();
                            const monthKey = `${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
                            const monthNameAr = today.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
                            const currentConfession = student.confessions?.[monthKey];
                            const isConfessed = currentConfession?.status === true;

                            return (
                                <div className="space-y-4">
                                    <div className="p-4 bg-slate-50 dark:bg-[#0f172a] rounded-2xl border border-slate-150 dark:border-slate-800">
                                        <div className="flex justify-between items-center mb-4">
                                            <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">اعتراف الشهر الحالي</span>
                                            <span className="text-sm font-black text-slate-800 dark:text-slate-100">{monthNameAr}</span>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={handleToggleConfession}
                                            disabled={isMutatingConfession}
                                            className={`w-full py-3 px-4 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all border cursor-pointer active:scale-95 ${
                                                isConfessed
                                                ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-emerald-250 dark:border-emerald-800/80 hover:bg-emerald-100/50 dark:hover:bg-emerald-950/30'
                                                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-750'
                                            }`}
                                        >
                                            {isConfessed ? (
                                                <>
                                                    <CheckCircle size={15} className="text-emerald-500" />
                                                    <span>أنا اعترفت الشهر ده (اضغط للإلغاء)</span>
                                                </>
                                            ) : (
                                                <>
                                                    <XCircle size={15} className="text-slate-450" />
                                                    <span>اضغط لتسجيل "أنا اعترفت الشهر ده"</span>
                                                </>
                                            )}
                                        </button>

                                        {isConfessed && currentConfession && (
                                            <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-800/70 text-[11px] font-bold text-slate-500 dark:text-slate-455 space-y-1">
                                                <div>
                                                    👤 سجل بواسطة: <span className="text-slate-700 dark:text-slate-200 font-black">{currentConfession.markedBy}</span>
                                                </div>
                                                {currentConfession.date && (
                                                    <div>
                                                        📅 بتاريخ: <span className="text-slate-700 dark:text-slate-200 font-black" dir="ltr">{new Date(currentConfession.date).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}
                    </div>

                    <div className="bg-white dark:bg-[#1e293b] p-8 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                        <h3 className="text-xl font-black mb-6 flex items-center justify-between text-slate-800 dark:text-white">
                            <span className="flex items-center gap-2">
                                <Calendar size={20} className="text-blue-600 dark:text-blue-400" />
                                سجل الحضور
                            </span>
                            <span className="bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400 border border-transparent dark:border-blue-500/20 text-sm font-medium px-3 py-1 rounded-lg">
                                {student.attendance?.length || 0} حضور
                            </span>
                        </h3>
                        {student.attendance && student.attendance.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {student.attendance.slice(0, 8).map((date, index) => (
                                    <div key={index} className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-200 border border-slate-100 dark:border-slate-700 text-sm py-1 px-3 rounded-xl">
                                        {new Date(date).toLocaleDateString('ar-EG')}
                                    </div>
                                ))}
                                {student.attendance.length > 8 && (
                                    <div className="bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-400 border border-slate-100 dark:border-slate-700 text-sm py-1 px-3 rounded-xl">
                                        +{student.attendance.length - 8} أخرى
                                    </div>
                                )}
                            </div>
                        ) : (
                            <p className="text-center text-slate-300 dark:text-slate-650 py-10 font-bold text-sm">لا يوجد سجل حضور حالياً</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Student Card Modal */}
            {showCardModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-slate-950/60 backdrop-blur-md animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-[#1e293b] rounded-3xl border border-slate-100 dark:border-slate-800 shadow-2xl p-6 max-w-[548px] w-full relative animate-in zoom-in duration-300">
                        <button 
                            onClick={() => setShowCardModal(false)}
                            className="absolute top-4 left-4 p-2 text-slate-400 hover:text-slate-655 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer z-20"
                        >
                            <X size={20} />
                        </button>
                        <h3 className="text-lg font-black text-slate-800 dark:text-white mb-6 text-center">كارنيه مدارس الأحد الخاص بك</h3>
                        <StudentCard student={student} />
                    </div>
                </div>
            )}
        </div>
    );
}
