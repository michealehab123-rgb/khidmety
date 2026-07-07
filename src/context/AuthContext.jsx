import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { auth } from '../firebase';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  signOut,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from 'firebase/auth';
import { doc, onSnapshot, db, getDoc, updateDoc, arrayRemove, deleteField } from '../firebase';
import { getMessaging, getToken, deleteToken } from 'firebase/messaging';

const AuthContext = createContext();

// دالة موحدة لتنظيف الحروف العربي لضمان دقة مقارنة الرتب
const normalizeArabic = (str) => {
  if (!str) return '';
  return str
    .replace(/[أإآا]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/[ةه]/g, 'ه')
    .trim();
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // General Admin (Firebase Auth)
  const [servant, setServant] = useState(undefined); // يبتدئ كـ undefined لتمييز حالة جاري التحميل عن "لا يوجد حساب"

  // Helper to handle session expiration on startup
  const getInitialStudentId = () => {
    const isRemembered = localStorage.getItem('rememberMe') === 'true';
    const hasTempSession = sessionStorage.getItem('tempSessionActive') === 'true';
    if (localStorage.getItem('rememberMe') === 'false' && !hasTempSession) {
      localStorage.removeItem('studentId');
      localStorage.removeItem('studentLastPasswordUpdate');
      localStorage.removeItem('servantId');
      localStorage.removeItem('rememberMe');
      return null;
    }
    return localStorage.getItem('studentId');
  };

  const getInitialServantId = () => {
    const isRemembered = localStorage.getItem('rememberMe') === 'true';
    const hasTempSession = sessionStorage.getItem('tempSessionActive') === 'true';
    if (localStorage.getItem('rememberMe') === 'false' && !hasTempSession) {
      localStorage.removeItem('studentId');
      localStorage.removeItem('studentLastPasswordUpdate');
      localStorage.removeItem('servantId');
      localStorage.removeItem('rememberMe');
      return null;
    }
    return localStorage.getItem('servantId');
  };

  const [studentId, setStudentId] = useState(getInitialStudentId);
  const [servantIdState, setServantIdState] = useState(getInitialServantId);
  const [loading, setLoading] = useState(true);

  // Cascading Store configurations
  const [student, setStudent] = useState(null);
  const [storeVisible, setStoreVisible] = useState(true);
  const [storeEnabled, setStoreEnabled] = useState(true);
  const [storeSchedule, setStoreSchedule] = useState(null);

  // Page Lock settings (fetched once on load to minimize reads)
  const [pageLocks, setPageLocks] = useState({});

  useEffect(() => {
    const fetchPageLocks = async () => {
      try {
        const docRef = doc(db, 'settings', 'page_locks');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setPageLocks(docSnap.data() || {});
        }
      } catch (err) {
        console.error("Error fetching page locks:", err);
      }
    };
    fetchPageLocks();
  }, []);

  // 1. Monitor General Admin (Firebase Auth)
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (authUser) => {
      setUser(authUser);
      if (authUser) {
        setStudentId(null);
        
        try {
          // Fetch the servant document from Firestore
          const docRef = doc(db, 'servants', authUser.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            const roleNorm = normalizeArabic(data.role);
            const isGeneralAdminUser = data.isGeneralAdmin === true || 
                                       roleNorm === 'امين عام' || 
                                       roleNorm === 'خادم عام' || 
                                       roleNorm === 'عام' || 
                                       authUser.email?.toLowerCase() === 'michealehab123@gmail.com';

            if (!isGeneralAdminUser && (data.status !== 'approved' || data.isActive === false)) {
              await auth.signOut();
              setServant(null);
              setServantIdState(null);
              localStorage.removeItem('servantId');
              setLoading(false);
              return;
            }
            setServant({ id: docSnap.id, ...data });
            setServantIdState(docSnap.id);
            localStorage.setItem('servantId', docSnap.id);
          } else {
            const userRef = doc(db, 'users', authUser.uid);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
              const data = userSnap.data();
              if (data.status === 'rejected' || data.status === 'deleted' || data.isActive === false) {
                await auth.signOut();
                setServant(null);
                setServantIdState(null);
                localStorage.removeItem('servantId');
                setLoading(false);
                return;
              }
              const roleNorm = normalizeArabic(data.role);
              const isAllowedUser = roleNorm.includes('فصل') || 
                                    roleNorm.includes('مرحله') || 
                                    roleNorm.includes('خادم') || 
                                    roleNorm === 'امين عام' || 
                                    roleNorm === 'خادم عام' || 
                                    roleNorm === 'عام' || 
                                    data.isGeneralAdmin === true ||
                                    authUser.email?.toLowerCase() === 'michealehab123@gmail.com';
              if (isAllowedUser) {
                setServant({ id: userSnap.id, ...data });
                setServantIdState(userSnap.id);
                localStorage.setItem('servantId', userSnap.id);
              } else {
                setServant(null);
                setServantIdState(null);
              }
            } else {
              setServant(null);
              setServantIdState(null);
            }
          }
        } catch (err) {
          console.error("Error fetching auth user role:", err);
          setServant(null);
          setServantIdState(null);
        }
        setLoading(false);
      } else {
        const storedServantId = localStorage.getItem('servantId');
        const storedStudentId = localStorage.getItem('studentId');
        if (!storedServantId && !storedStudentId) {
          setServant(null); // حل الـ undefined إلى null لإنهاء التحميل بأمان
          setLoading(false);
        }
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // 2. Monitor Servant Session
  useEffect(() => {
    if (user) return; 
    if (!servantIdState) {
      setServant(null);
      return;
    }

    setLoading(true);
    const unsubscribeSnapshot = onSnapshot(doc(db, 'servants', servantIdState), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const roleNorm = normalizeArabic(data.role);
        const isGeneralAdminUser = data.isGeneralAdmin === true || 
                                   roleNorm === 'امين عام' || 
                                   roleNorm === 'خادم عام' || 
                                   roleNorm === 'عام';

        if (!isGeneralAdminUser && (data.status !== 'approved' || data.isActive === false)) {
          localStorage.removeItem('servantId');
          setServantIdState(null);
          setServant(null);
          window.location.href = '/login';
        } else {
          setServant({ id: docSnap.id, ...data });
        }
      } else {
        localStorage.removeItem('servantId');
        setServantIdState(null);
        setServant(null);
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching servant snapshot:", error);
      setServant(null);
    });

    return () => unsubscribeSnapshot();
  }, [servantIdState, user]);

  // 3. Monitor Student Session
  useEffect(() => {
    if (user) return; 
    if (!studentId) {
      setStudentId(null);
      setStudent(null);
      return;
    }

    setLoading(true);
    const unsubscribeSnapshot = onSnapshot(doc(db, 'students', studentId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setStudent({ id: docSnap.id, ...data });
        
        const storedLastUpdate = localStorage.getItem('studentLastPasswordUpdate');
        const currentLastUpdate = data.lastPasswordUpdate ? 
          (data.lastPasswordUpdate.toMillis ? data.lastPasswordUpdate.toMillis() : data.lastPasswordUpdate) 
          : 0;

        if (storedLastUpdate && String(currentLastUpdate) !== String(storedLastUpdate)) {
          localStorage.removeItem('studentId');
          localStorage.removeItem('studentLastPasswordUpdate');
          setStudentId(null);
          setStudent(null);
          window.location.href = '/login';
        }
      } else {
        localStorage.removeItem('studentId');
        setStudentId(null);
        setStudent(null);
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching student snapshot:", error);
      setLoading(false);
    });

    return () => unsubscribeSnapshot();
  }, [studentId, user]);

  // 4. Cascading Store Config Monitor
  useEffect(() => {
    if (!studentId || !student) {
      setStoreVisible(true);
      setStoreEnabled(true);
      setStoreSchedule(null);
      return;
    }

    const getSafeClassId = (className) => {
      if (!className) return '';
      return className.replace(/\//g, '-');
    };

    const getStudentStage = (studentData) => {
      if (!studentData) return '';
      let rawStage = studentData.stage || studentData.assignedStage || '';
      if (rawStage) return rawStage;
      const grade = studentData.schoolGrade || studentData.assignedClass || '';
      const normalizedGrade = grade.trim();
      if (
        normalizedGrade.includes('ابتدائي') || 
        normalizedGrade.includes('ابتدائى') || 
        normalizedGrade.includes('حضانة') || 
        normalizedGrade.includes('ملائكة')
      ) return 'ابتدائي';
      if (normalizedGrade.includes('اعدادي') || normalizedGrade.includes('اعدادى')) return 'اعدادي';
      if (normalizedGrade.includes('ثانوي') || normalizedGrade.includes('ثانوى')) return 'ثانوي';
      return '';
    };

    const studentClass = student.assignedClass || student.schoolGrade || '';
    const studentStage = getStudentStage(student);
    const safeClassId = getSafeClassId(studentClass);

    const docRefs = {
      global: doc(db, 'store_config', 'global')
    };
    if (studentStage) {
      docRefs.stage = doc(db, 'store_config', `stage-${studentStage}`);
    }
    if (safeClassId) {
      docRefs.class = doc(db, 'store_config', safeClassId);
    }

    let snaps = { global: null, stage: null, class: null };

    const updateResolvedConfig = () => {
      let resolvedVisible = true;
      let resolvedEnabled = true;
      let resolvedSchedule = null;

      if (snaps.class && snaps.class.exists()) {
        const data = snaps.class.data();
        if (data.storeVisible !== undefined) resolvedVisible = data.storeVisible;
        if (data.storeEnabled !== undefined) resolvedEnabled = data.storeEnabled;
        else if (data.isOpen !== undefined) resolvedEnabled = data.isOpen;
        resolvedSchedule = data;
      }
      else if (snaps.stage && snaps.stage.exists()) {
        const data = snaps.stage.data();
        if (data.storeVisible !== undefined) resolvedVisible = data.storeVisible;
        if (data.storeEnabled !== undefined) resolvedEnabled = data.storeEnabled;
        else if (data.isOpen !== undefined) resolvedEnabled = data.isOpen;
        resolvedSchedule = data;
      }
      else if (snaps.global && snaps.global.exists()) {
        const data = snaps.global.data();
        if (data.storeVisible !== undefined) resolvedVisible = data.storeVisible;
        if (data.storeEnabled !== undefined) resolvedEnabled = data.storeEnabled;
        else if (data.isOpen !== undefined) resolvedEnabled = data.isOpen;
        resolvedSchedule = data;
      }

      setStoreVisible(resolvedVisible);
      setStoreEnabled(resolvedEnabled);
      setStoreSchedule({
        ...resolvedSchedule,
        isOpen: resolvedEnabled,
        storeEnabled: resolvedEnabled,
        storeVisible: resolvedVisible
      });
    };

    const unsubs = [];

    unsubs.push(onSnapshot(docRefs.global, (snap) => {
      snaps.global = snap;
      updateResolvedConfig();
    }, (err) => console.error("Error global config snapshot:", err)));

    if (docRefs.stage) {
      unsubs.push(onSnapshot(docRefs.stage, (snap) => {
        snaps.stage = snap;
        updateResolvedConfig();
      }, (err) => console.error("Error stage config snapshot:", err)));
    }

    if (docRefs.class) {
      unsubs.push(onSnapshot(docRefs.class, (snap) => {
        snaps.class = snap;
        updateResolvedConfig();
      }, (err) => console.error("Error class config snapshot:", err)));
    }

    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, [studentId, student]);

  const performPurge = async () => {
    console.log('[Auth Cleanup] Initiating purification campaign...');
    try {
      // 1. Identify active session user IDs across all potential roles
      const activeServantId = servant?.id || servantIdState || localStorage.getItem('servantId');
      const activeStudentId = student?.id || studentId || localStorage.getItem('studentId');
      const activeAuthUid = user?.uid || auth.currentUser?.uid;

      // 2. Clear FCM token from Firestore for these IDs
      const messaging = getMessaging();
      const registration = await navigator.serviceWorker.ready.catch(() => null);
      const currentToken = await getToken(messaging, {
        vapidKey: 'BDnkjGySbQVnoSQXpcJB5YafONwklqK5edNUoEuyTJqOdYz2PvQby40zDrT5303ukwxwa_sIBDUqLZ43LUE6L-g',
        serviceWorkerRegistration: registration || undefined
      }).catch(() => null);

      if (currentToken) {
        if (activeServantId) {
          await updateDoc(doc(db, 'servants', activeServantId), {
            fcmToken: deleteField(),
            fcmTokens: deleteField()
          }).catch(() => {});
        }
        if (activeStudentId) {
          await updateDoc(doc(db, 'students', activeStudentId), {
            fcmToken: deleteField(),
            fcmTokens: deleteField()
          }).catch(() => {});
        }
        if (activeAuthUid) {
          await updateDoc(doc(db, 'servants', activeAuthUid), {
            fcmToken: deleteField(),
            fcmTokens: deleteField()
          }).catch(() => {});
          await updateDoc(doc(db, 'users', activeAuthUid), {
            fcmToken: deleteField(),
            fcmTokens: deleteField()
          }).catch(() => {});
        }
        await deleteToken(messaging).catch(() => {});
        console.log('[Auth Cleanup] Old FCM Token purged from Firestore and client.');
      }
    } catch (err) {
      console.warn('[Auth Cleanup] FCM Token cleanup warning:', err);
    }

    // 3. Clear localStorage and sessionStorage keys of previous accounts
    localStorage.removeItem('servantId');
    localStorage.removeItem('studentId');
    localStorage.removeItem('studentLastPasswordUpdate');
    localStorage.removeItem('rememberMe');
    sessionStorage.removeItem('tempSessionActive');

    // 4. Reset React states
    setServant(null);
    setServantIdState(null);
    setStudentId(null);
    setStudent(null);
    setUser(null);
    setStoreVisible(true);
    setStoreEnabled(true);
    setStoreSchedule(null);

    // 5. Sign out Firebase Auth session
    await signOut(auth).catch(() => {});
    console.log('[Auth Cleanup] Completed client-side and session reset.');
  };

  const login = async (email, password, rememberMe = false) => {
    await performPurge();

    localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');
    if (!rememberMe) {
      sessionStorage.setItem('tempSessionActive', 'true');
    } else {
      sessionStorage.removeItem('tempSessionActive');
    }

    const persistenceType = rememberMe ? browserLocalPersistence : browserSessionPersistence;
    await setPersistence(auth, persistenceType);
    return signInWithEmailAndPassword(auth, email, password);
  };

  const logout = async () => {
    return await performPurge();
  };

  const setStudentSession = async (id, lastUpdate, rememberMe = false) => {
    // Clean up first to ensure fresh state
    localStorage.removeItem('servantId');
    setServantIdState(null);
    setServant(null);

    localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');
    if (rememberMe) {
      localStorage.setItem('studentId', id);
      if (lastUpdate) localStorage.setItem('studentLastPasswordUpdate', lastUpdate);
      sessionStorage.removeItem('tempSessionActive');
    } else {
      localStorage.setItem('studentId', id);
      if (lastUpdate) localStorage.setItem('studentLastPasswordUpdate', lastUpdate);
      sessionStorage.setItem('tempSessionActive', 'true');
    }
    setStudentId(id);
  };

  const setServantSession = (id, rememberMe = false) => {
    localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');
    if (rememberMe) {
      localStorage.setItem('servantId', id);
      sessionStorage.removeItem('tempSessionActive');
    } else {
      localStorage.setItem('servantId', id);
      sessionStorage.setItem('tempSessionActive', 'true');
    }
    setServantIdState(id);
  };

  const loginServantByCode = async (servantData, rememberMe = false) => {
    const id = servantData.id;
    await performPurge();

    localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');
    if (rememberMe) {
      localStorage.setItem('servantId', id);
      sessionStorage.removeItem('tempSessionActive');
    } else {
      localStorage.setItem('servantId', id);
      sessionStorage.setItem('tempSessionActive', 'true');
    }
    setStudentId(null);
    setServant(servantData);          
    setServantIdState(id);            
  };

  // تجميع وحصاد الفصول المصرحة لأمين المرحلة أو أمين الفصل ديناميكياً بدون تسريب
  const authorizedClasses = useMemo(() => {
    if (!servant) return [];
    
    const parseField = (field) => {
      if (!field) return [];
      if (Array.isArray(field)) {
        return field.flatMap(item => typeof item === 'string' ? item.split(',').map(c => c.trim()) : [item]);
      }
      if (typeof field === 'string') {
        return field.split(',').map(c => c.trim());
      }
      return [field];
    };

    const classesFromMyClasses = parseField(servant.myClasses);
    const classesFromManaged = parseField(servant.managedClasses);
    const classesFromAssignedClasses = parseField(servant.assignedClasses);
    const classesFromAssignedClass = servant.assignedClass ? [servant.assignedClass] : [];

    const all = [
      ...classesFromMyClasses,
      ...classesFromManaged,
      ...classesFromAssignedClasses,
      ...classesFromAssignedClass
    ];

    const result = [...new Set(all.filter(Boolean))];

    if (result.length === 0) {
      const roleNorm = servant.role ? normalizeArabic(servant.role) : '';
      if (roleNorm.includes('مرحله')) {
        let myStage = '';
        const rawStage = servant.assignedStage || servant.grade || '';
        if (rawStage.includes('ابتدائي') || rawStage.includes('ابتدائى')) {
          myStage = 'ابتدائي';
        } else if (rawStage.includes('اعدادي') || rawStage.includes('اعدادى')) {
          myStage = 'اعدادي';
        } else if (rawStage.includes('ثانوي') || rawStage.includes('ثانوى')) {
          myStage = 'ثانوي';
        }
        if (myStage) {
          const STAGE_CLASS_MAP = {
            'ابتدائي': ['حضانة/ملائكة', 'أولى ابتدائى', 'ثانية ابتدائى', 'ثالثة ابتدائى', 'رابعة ابتدائى', 'خامسة ابتدائى', 'سادسة ابتدائي'],
            'اعدادي': ['اولي اعدادي', 'تانيه اعدادي', 'تالته اعدادي'],
            'ثانوي': ['اولي ثانوي', 'تانيه ثانوي', 'تالته ثانوي']
          };
          return STAGE_CLASS_MAP[myStage] || [];
        }
      }
    }

    return result;
  }, [servant]);

  // حساب الرتب بشكل معزول وصارم تماماً
  const roleNorm = servant?.role ? normalizeArabic(servant.role) : '';
  
  // الخادم العام هو فقط من يملك رتبة أمين عام أو خادم عام، أو لديه حقل isGeneralAdmin، أو مسجل بإيميل الأدمن العام
  const isGeneralAdmin = !!user && (
    !servant || 
    roleNorm === 'امين عام' || 
    roleNorm === 'خادم عام' || 
    roleNorm === 'عام' || 
    servant?.isGeneralAdmin === true ||
    (user.email && user.email.toLowerCase() === 'michealehab123@gmail.com')
  );
  
  // رتبة أمين المرحلة مستقلة بذاتها ومغلقة على نطاقها
  const isStageServant = !!servant && roleNorm.includes('مرحله') && !isGeneralAdmin;
  
  // رتبة أمين الفصل
  const isClassServant = !!servant && (roleNorm.includes('فصل') || roleNorm.includes('خادم')) && !isStageServant && !isGeneralAdmin;

  const refreshPageLocks = async () => {
    try {
      const docRef = doc(db, 'settings', 'page_locks');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setPageLocks(docSnap.data() || {});
      } else {
        setPageLocks({});
      }
    } catch (err) {
      console.error("Error refreshing page locks:", err);
    }
  };

  const value = {
    user,
    servant,
    student,
    studentId,
    storeVisible,
    storeEnabled,
    storeSchedule,
    authorizedClasses,
    isGeneralAdmin,
    isStageServant,
    isClassServant,
    isServant: isStageServant || isClassServant || (!!servantIdState && !user),
    isStudent: !!studentId && !user && !servantIdState && !servant,
    isAdmin: isGeneralAdmin, // التوافق مع الكود القديم دون تداخل صلاحيات
    login,
    logout,
    setStudentSession,
    setServantSession,
    loginServantByCode,
    pageLocks,
    refreshPageLocks,
    loading: loading || servant === undefined // حارس تحميل يمنع الـ Race Condition
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}