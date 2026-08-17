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

  const isAccountSavedInMultiList = (id) => {
    if (!id) return false;
    try {
      const saved = localStorage.getItem('savedAccounts');
      if (!saved) return false;
      const list = JSON.parse(saved);
      return Array.isArray(list) && list.some(acc => String(acc.id) === String(id) || String(acc.code || '') === String(id));
    } catch {
      return false;
    }
  };

  // Helper to handle session expiration on startup
  const getInitialStudentId = () => {
    const sId = localStorage.getItem('studentId');
    if (!sId) return null;

    const activeType = localStorage.getItem('activeAccountType');
    if (activeType && activeType !== 'student') return null;

    const isRemembered = localStorage.getItem('rememberMe') === 'true';
    const hasTempSession = sessionStorage.getItem('tempSessionActive') === 'true';
    const isSaved = isAccountSavedInMultiList(sId);

    if (!isRemembered && !hasTempSession && !isSaved) {
      localStorage.removeItem('studentId');
      localStorage.removeItem('studentLastPasswordUpdate');
      localStorage.removeItem('studentLastPasswordUpdateId');
      return null;
    }
    return sId;
  };

  const getInitialServantId = () => {
    const svId = localStorage.getItem('servantId');
    if (!svId) return null;

    const activeType = localStorage.getItem('activeAccountType');
    if (activeType && activeType === 'student') return null;

    const isRemembered = localStorage.getItem('rememberMe') === 'true';
    const hasTempSession = sessionStorage.getItem('tempSessionActive') === 'true';
    const isSaved = isAccountSavedInMultiList(svId);

    if (!isRemembered && !hasTempSession && !isSaved) {
      localStorage.removeItem('servantId');
      return null;
    }
    return svId;
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
            const isGeneralAdminUser = docSnap.id === 'SWyYts3l9Tc79IyzCOIFud8aOXn1' ||
                                       data.isGeneralAdmin === true || 
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
        if ((!storedServantId && !storedStudentId) || (!servantIdState && !studentId)) {
          setServant(null); // حل الـ undefined إلى null لإنهاء التحميل بأمان
          setLoading(false);
        }
      }
    });

    return () => unsubscribeAuth();
  }, [servantIdState, studentId]);

  // 2. Monitor Servant Session
  useEffect(() => {
    if (user) return; 
    if (!servantIdState) {
      setServant(null);
      if (!studentId) setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribeSnapshot = onSnapshot(doc(db, 'servants', servantIdState), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const roleNorm = normalizeArabic(data.role);
        const isGeneralAdminUser = docSnap.id === 'SWyYts3l9Tc79IyzCOIFud8aOXn1' ||
                                   data.isGeneralAdmin === true || 
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
      setLoading(false);
    });

    return () => unsubscribeSnapshot();
  }, [servantIdState, user, studentId]);

  // 3. Monitor Student Session
  useEffect(() => {
    if (user) return; 
    if (!studentId) {
      setStudentId(null);
      setStudent(null);
      if (!servantIdState) setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribeSnapshot = onSnapshot(doc(db, 'students', studentId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setStudent({ id: docSnap.id, ...data });
        
        const storedLastUpdate = localStorage.getItem('studentLastPasswordUpdate');
        const storedLastUpdateStudentId = localStorage.getItem('studentLastPasswordUpdateId');
        const currentLastUpdate = data.lastPasswordUpdate ? 
          (data.lastPasswordUpdate.toMillis ? data.lastPasswordUpdate.toMillis() : data.lastPasswordUpdate) 
          : 0;

        if (storedLastUpdateStudentId === docSnap.id && storedLastUpdate && String(currentLastUpdate) !== String(storedLastUpdate)) {
          localStorage.removeItem('studentId');
          localStorage.removeItem('studentLastPasswordUpdate');
          localStorage.removeItem('studentLastPasswordUpdateId');
          setStudentId(null);
          setStudent(null);
          window.location.href = '/login';
        } else {
          localStorage.setItem('studentLastPasswordUpdate', String(currentLastUpdate));
          localStorage.setItem('studentLastPasswordUpdateId', docSnap.id);
        }
      } else {
        localStorage.removeItem('studentId');
        setStudentId(null);
        setStudent(null);
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching student snapshot:", error);
      setStudent(null);
      setLoading(false);
    });

    return () => unsubscribeSnapshot();
  }, [studentId, user, servantIdState]);

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
    
    // 1. Identify active session user IDs across all potential roles
    const activeServantId = servant?.id || servantIdState || localStorage.getItem('servantId');
    const activeStudentId = student?.id || studentId || localStorage.getItem('studentId');
    const activeAuthUid = user?.uid || auth.currentUser?.uid;

    // 2. Non-blocking FCM token cleanup safeguard (with 1s timeout to prevent hanging on serviceWorker.ready)
    const purgeFCM = async () => {
      try {
        if (!('serviceWorker' in navigator)) return;
        const messaging = getMessaging();
        const swReadyPromise = Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) => setTimeout(() => reject(new Error('SW ready timeout')), 1000))
        ]);
        const registration = await swReadyPromise.catch(() => null);
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
    };

    // Run FCM purge in background without blocking login/logout flow
    purgeFCM().catch(() => {});

    // 3. Clear localStorage and sessionStorage keys of previous accounts
    localStorage.removeItem('servantId');
    localStorage.removeItem('studentId');
    localStorage.removeItem('studentLastPasswordUpdate');
    localStorage.removeItem('studentLastPasswordUpdateId');
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
    const res = await signInWithEmailAndPassword(auth, email, password);

    if (res.user && rememberMe) {
      saveAccountToMultiList({
        id: res.user.uid,
        type: 'admin',
        name: res.user.displayName || email.split('@')[0] || 'أمين عام',
        photoUrl: res.user.photoURL || null,
        role: 'أمين عام',
        email: email,
        password: password
      });
    }

    return res;
  };

  // Multi-Account Management
  const getSavedAccountsFromStorage = () => {
    try {
      const saved = localStorage.getItem('savedAccounts');
      if (!saved) return [];
      const list = JSON.parse(saved);
      return list.map(acc => {
        if (String(acc.id) === 'SWyYts3l9Tc79IyzCOIFud8aOXn1' || (acc.email && String(acc.email).toLowerCase() === 'michealehab123@gmail.com')) {
          return { ...acc, role: 'أمين عام', type: 'admin' };
        }
        return acc;
      });
    } catch {
      return [];
    }
  };

  const [savedAccountsState, setSavedAccountsState] = useState(getSavedAccountsFromStorage);

  const saveAccountToMultiList = (accData) => {
    if (!accData || !accData.id) return;
    const currentList = getSavedAccountsFromStorage();
    const existing = currentList.find(item => String(item.id) === String(accData.id));
    const filtered = currentList.filter(item => String(item.id) !== String(accData.id));
    const isGenAdminAcc = String(accData.id) === 'SWyYts3l9Tc79IyzCOIFud8aOXn1' || 
                          (accData.email && String(accData.email).toLowerCase() === 'michealehab123@gmail.com') ||
                          accData.type === 'admin';

    const updatedAcc = {
      id: String(accData.id),
      type: isGenAdminAcc ? 'admin' : (accData.type || 'student'),
      name: accData.name || 'مستخدم',
      photoUrl: accData.photoUrl || null,
      role: isGenAdminAcc ? 'أمين عام' : (accData.role || (accData.type === 'student' ? 'مخدوم' : 'خادم')),
      code: accData.code ? String(accData.code) : null,
      email: accData.email || existing?.email || null,
      password: accData.password || existing?.password || null,
      lastActive: Date.now(),
      rememberMe: true
    };
    const newAccounts = [updatedAcc, ...filtered];
    localStorage.setItem('savedAccounts', JSON.stringify(newAccounts));
    setSavedAccountsState(newAccounts);
  };

  const removeSavedAccount = (accountId) => {
    const currentList = getSavedAccountsFromStorage();
    const filtered = currentList.filter(item => String(item.id) !== String(accountId));
    localStorage.setItem('savedAccounts', JSON.stringify(filtered));
    setSavedAccountsState(filtered);
  };

  // Auto-sync current remembered profile to savedAccounts
  useEffect(() => {
    const isRemembered = localStorage.getItem('rememberMe') === 'true';
    if (!isRemembered) return;

    if (student) {
      saveAccountToMultiList({
        id: student.id,
        type: 'student',
        name: student.name,
        photoUrl: student.photoUrl,
        role: 'مخدوم',
        code: student.code || student.id,
        password: student.password
      });
    } else if (servant) {
      const roleNorm = normalizeArabic(servant.role);
      const isGenAdminUser = servant.id === 'SWyYts3l9Tc79IyzCOIFud8aOXn1' ||
                             servant.isGeneralAdmin === true ||
                             roleNorm === 'امين عام' ||
                             roleNorm === 'خادم عام' ||
                             roleNorm === 'عام';
      saveAccountToMultiList({
        id: servant.id,
        type: isGenAdminUser ? 'admin' : 'servant',
        name: servant.name || servant.displayName || (isGenAdminUser ? 'أمين عام الخدمة' : 'خادم'),
        photoUrl: servant.photoUrl || servant.photoURL || null,
        role: isGenAdminUser ? 'أمين عام' : (servant.role || 'خادم'),
        code: servant.code || servant.id,
        password: servant.password
      });
    } else if (user) {
      saveAccountToMultiList({
        id: user.uid,
        type: 'admin',
        name: user.displayName || user.email?.split('@')[0] || 'أمين عام',
        photoUrl: user.photoURL || null,
        role: 'أمين عام',
        email: user.email
      });
    }
  }, [student, servant, user]);

  const switchAccount = async (targetAccount) => {
    if (!targetAccount || !targetAccount.id) return;
    setLoading(true);

    // تنظيف وحذف توكن الإشعارات من الحساب السابق أولاً قبل التبديل
    await performPurge();

    // Set persistence flag
    localStorage.setItem('rememberMe', 'true');

    if (targetAccount.type === 'student') {
      localStorage.setItem('activeAccountType', 'student');
      localStorage.removeItem('servantId');
      localStorage.removeItem('studentLastPasswordUpdate');
      localStorage.removeItem('studentLastPasswordUpdateId');
      localStorage.setItem('studentId', targetAccount.id);
      setServant(null);
      setServantIdState(null);
      setUser(null);
      setStudentId(targetAccount.id);
      await signOut(auth).catch(() => {});
      window.location.href = '/student/dashboard';
    } else if (targetAccount.type === 'servant') {
      localStorage.setItem('activeAccountType', 'servant');
      localStorage.removeItem('studentId');
      localStorage.removeItem('studentLastPasswordUpdate');
      localStorage.removeItem('studentLastPasswordUpdateId');
      localStorage.setItem('servantId', targetAccount.id);
      setStudent(null);
      setStudentId(null);
      setUser(null);
      setServantIdState(targetAccount.id);
      await signOut(auth).catch(() => {});
      
      const roleNorm = targetAccount.role ? normalizeArabic(targetAccount.role) : '';
      if (roleNorm === 'امين عام' || roleNorm === 'خادم عام' || roleNorm === 'عام') {
        window.location.href = '/admin';
      } else {
        window.location.href = '/servant/dashboard';
      }
    } else if (targetAccount.type === 'admin') {
      localStorage.setItem('activeAccountType', 'admin');
      localStorage.removeItem('studentId');
      localStorage.removeItem('studentLastPasswordUpdate');
      localStorage.removeItem('studentLastPasswordUpdateId');

      if (targetAccount.id) {
        localStorage.setItem('servantId', targetAccount.id);
        setServantIdState(targetAccount.id);
      }

      setStudent(null);
      setStudentId(null);

      // If email and password are provided, execute Firebase Auth login:
      if (targetAccount.email && targetAccount.password) {
        try {
          await login(targetAccount.email, targetAccount.password, true);
          window.location.href = '/admin';
          return;
        } catch (e) {
          console.error("Failed to auto sign in admin account with credentials", e);
        }
      }

      // If Firebase Auth currentUser is already active for this admin email:
      if (auth.currentUser && targetAccount.email && auth.currentUser.email?.toLowerCase() === targetAccount.email.toLowerCase()) {
        setUser(auth.currentUser);
        window.location.href = '/admin';
        return;
      }

      window.location.href = '/admin';
    }
  };

  const updateProfilePhoto = async (newPhotoUrl) => {
    try {
      if (studentId) {
        await updateDoc(doc(db, 'students', studentId), { photoUrl: newPhotoUrl });
        setStudent(prev => prev ? { ...prev, photoUrl: newPhotoUrl } : prev);
      } else if (servantIdState) {
        await updateDoc(doc(db, 'servants', servantIdState), { photoUrl: newPhotoUrl });
        setServant(prev => prev ? { ...prev, photoUrl: newPhotoUrl } : prev);
      } else if (user?.uid) {
        await updateDoc(doc(db, 'servants', user.uid), { photoUrl: newPhotoUrl }).catch(() => {});
        await updateDoc(doc(db, 'users', user.uid), { photoUrl: newPhotoUrl }).catch(() => {});
        setServant(prev => prev ? { ...prev, photoUrl: newPhotoUrl } : prev);
      }

      // Also update photoUrl in savedAccounts list in storage
      const activeId = studentId || servantIdState || user?.uid;
      if (activeId) {
        const currentList = getSavedAccountsFromStorage();
        const updatedList = currentList.map(acc => {
          if (String(acc.id) === String(activeId)) {
            return { ...acc, photoUrl: newPhotoUrl };
          }
          return acc;
        });
        localStorage.setItem('savedAccounts', JSON.stringify(updatedList));
        setSavedAccountsState(updatedList);
      }
    } catch (err) {
      console.error("Error updating profile photo:", err);
      throw err;
    }
  };

  const logout = async (autoSwitchToNext = true) => {
    const currentActiveId = studentId || servantIdState || user?.uid;
    const isRemembered = localStorage.getItem('rememberMe') === 'true';

    // Perform session purge
    await performPurge();

    // If current account was NOT remembered, remove it from savedAccounts
    if (!isRemembered && currentActiveId) {
      removeSavedAccount(currentActiveId);
    }

    if (autoSwitchToNext) {
      // Check if there are remaining saved accounts
      const remaining = getSavedAccountsFromStorage();
      const otherAccounts = remaining.filter(a => String(a.id) !== String(currentActiveId));

      if (otherAccounts.length > 0) {
        // Auto-switch to the next saved account!
        const nextAccount = otherAccounts[0];
        await switchAccount(nextAccount);
      } else {
        // No other saved accounts, redirect to login page
        window.location.href = '/login';
      }
    }
  };

  const setStudentSession = async (id, lastUpdate, rememberMe = false) => {
    // Clean up first to ensure fresh state
    localStorage.removeItem('servantId');
    localStorage.setItem('activeAccountType', 'student');
    setServantIdState(null);
    setServant(null);

    localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');
    if (rememberMe) {
      localStorage.setItem('studentId', id);
      if (lastUpdate) {
        localStorage.setItem('studentLastPasswordUpdate', String(lastUpdate));
        localStorage.setItem('studentLastPasswordUpdateId', id);
      }
      sessionStorage.removeItem('tempSessionActive');
    } else {
      localStorage.setItem('studentId', id);
      if (lastUpdate) {
        localStorage.setItem('studentLastPasswordUpdate', String(lastUpdate));
        localStorage.setItem('studentLastPasswordUpdateId', id);
      }
      sessionStorage.setItem('tempSessionActive', 'true');
    }
    setStudentId(id);
  };

  const setServantSession = (id, rememberMe = false) => {
    localStorage.removeItem('studentId');
    localStorage.removeItem('studentLastPasswordUpdate');
    localStorage.removeItem('studentLastPasswordUpdateId');
    localStorage.setItem('activeAccountType', 'servant');
    setStudentId(null);
    setStudent(null);

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
    localStorage.setItem('activeAccountType', 'servant');

    localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');
    if (rememberMe) {
      localStorage.setItem('servantId', id);
      sessionStorage.removeItem('tempSessionActive');
    } else {
      localStorage.setItem('servantId', id);
      sessionStorage.setItem('tempSessionActive', 'true');
    }
    setStudentId(null);
    setStudent(null);
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
  
  // الخادم العام هو فقط من يملك رتبة أمين عام أو خادم عام، أو لديه حقل isGeneralAdmin، أو معرف SWyYts3l9Tc79IyzCOIFud8aOXn1، أو مسجل بإيميل الأدمن العام
  const isGeneralAdmin = (!!servant && (
    servant.id === 'SWyYts3l9Tc79IyzCOIFud8aOXn1' ||
    servant.isGeneralAdmin === true ||
    roleNorm === 'امين عام' ||
    roleNorm === 'خادم عام' ||
    roleNorm === 'عام'
  )) || (!!user && (
    user.uid === 'SWyYts3l9Tc79IyzCOIFud8aOXn1' ||
    !servant || 
    roleNorm === 'امين عام' || 
    roleNorm === 'خادم عام' || 
    roleNorm === 'عام' || 
    servant?.isGeneralAdmin === true ||
    (user.email && user.email.toLowerCase() === 'michealehab123@gmail.com')
  ));
  
  // رتبة أمين المرحلة مستقلة بذاتها ومغلقة على نطاقها
  const isStageServant = !!servant && roleNorm.includes('مرحله') && !isGeneralAdmin;
  
  // رتبة أمين الفصل
  const isClassServant = !!servant && (roleNorm.includes('فصل') || roleNorm.includes('خادم')) && !isStageServant && !isGeneralAdmin;

  const currentAccount = useMemo(() => {
    if (student) {
      return {
        id: student.id,
        type: 'student',
        name: student.name || 'مخدوم',
        photoUrl: student.photoUrl || null,
        role: 'مخدوم',
        code: student.code || student.id
      };
    }
    if (servant) {
      const roleNorm = normalizeArabic(servant.role);
      const isGenAdminUser = servant.id === 'SWyYts3l9Tc79IyzCOIFud8aOXn1' ||
                             servant.isGeneralAdmin === true ||
                             roleNorm === 'امين عام' ||
                             roleNorm === 'خادم عام' ||
                             roleNorm === 'عام' ||
                             (user?.email && user.email.toLowerCase() === 'michealehab123@gmail.com');
      return {
        id: servant.id,
        type: isGenAdminUser ? 'admin' : 'servant',
        name: servant.name || servant.displayName || (isGenAdminUser ? 'أمين عام الخدمة' : 'خادم'),
        photoUrl: servant.photoUrl || servant.photoURL || null,
        role: isGenAdminUser ? 'أمين عام' : (servant.role || 'خادم'),
        code: servant.code || servant.id,
        email: user?.email || servant.email || null
      };
    }
    if (user) {
      return {
        id: user.uid,
        type: 'admin',
        name: user.displayName || user.email?.split('@')[0] || 'أمين عام',
        photoUrl: user.photoURL || null,
        role: 'أمين عام',
        email: user.email
      };
    }
    return null;
  }, [student, servant, user]);

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
    currentAccount,
    savedAccounts: savedAccountsState,
    switchAccount,
    removeSavedAccount,
    updateProfilePhoto,
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
    performPurge,
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