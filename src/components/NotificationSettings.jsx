import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { STAGE_CLASSES } from '../constants';
import { 
  db, 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  deleteDoc
} from '../firebase';
import { 
  Bell, 
  CalendarDays, 
  CakeSlice, 
  Settings, 
  Send, 
  History, 
  Users, 
  UserCheck,
  Search, 
  Check, 
  Loader2, 
  Sparkles,
  AlertCircle,
  Plus,
  Trash2,
  Edit
} from 'lucide-react';

export default function NotificationSettings({ quickSendOnly = false }) {
  const { servant, isGeneralAdmin, isStageServant, isClassServant, authorizedClasses } = useAuth();
  
  // Navigation / Tabs within Settings Hub
  const [activeSubTab, setActiveSubTab] = useState(quickSendOnly ? 'send' : 'settings'); // 'settings' | 'send' | 'history'

  // Loading States
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [sendingNotification, setSendingNotification] = useState(false);

  // Success/Error Feedbacks
  const [toast, setToast] = useState(null);

  // Settings State (Periodic & Birthday)
  const [settings, setSettings] = useState({
    liturgyEnabled: false,
    liturgyTime: '06:30',
    liturgyMessage: 'صباح الخير يا بطل! مستنيينك في القداس الصبح، متتأخرش عشان الملاك يكتب اسمك ⛪❤️',
    birthdayEnabled: false,
    birthdayStudentMessage: 'كل سنة وأنت طيب يا بطل {name}! مدرسة الأحد بتتمنالك سنة جميلة مع بابا يسوع 🎉🎂',
    birthdayServantMessage: 'كل سنة وأنت طيب يا هندسة {name}! سنة مباركة في خدمتك وعقبال سنين كتير من العطاء 🌟',
    stageBirthdayServantMessages: {}, // Stage-specific servant greetings
    classBirthdayMessages: {}, // Class-specific student greetings
    periodicAlerts: [] // Array of { id: string, enabled: boolean, days: string[], time: string, message: string }
  });

  // Periodic Alert Editor States
  const [editingAlertId, setEditingAlertId] = useState(null); // null | 'new' | string (id)
  
  // State for Birthday Configuration sub-selectors
  const [birthdayServantStageTab, setBirthdayServantStageTab] = useState('general'); // 'general' | 'ابتدائي' | 'اعدادي' | 'ثانوي'
  const [birthdayStudentStageTab, setBirthdayStudentStageTab] = useState('general'); // 'general' | 'ابتدائي' | 'اعدادي' | 'ثانوي'

  // Attendance filter states
  const [enableAttendanceFilter, setEnableAttendanceFilter] = useState(false);
  const [attendanceFilterType, setAttendanceFilterType] = useState('attendedService'); // 'attendedService' | 'notAttendedService' | 'attendedLiturgy' | 'notAttendedLiturgy'
  const [alertDays, setAlertDays] = useState([]);
  const [alertTime, setAlertTime] = useState('06:30');
  const [isPeriodic, setIsPeriodic] = useState(false);
  const [skipAutoSelect, setSkipAutoSelect] = useState(false);

  // Manual Notification Form State
  const [manualTitle, setManualTitle] = useState('');
  const [manualBody, setManualBody] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRecipients, setSelectedRecipients] = useState([]);
  const [publishType, setPublishType] = useState('now'); // 'now' | 'custom'
  const [publishDate, setPublishDate] = useState('');
  const [publishTime, setPublishTime] = useState('');
  
  // Advanced target states
  const [allDbServants, setAllDbServants] = useState([]);
  const [allDbStudents, setAllDbStudents] = useState([]);
  const [gaTargetType, setGaTargetType] = useState('students'); // 'servants' | 'students' | 'both'
  const [gaServantFilter, setGaServantFilter] = useState('all'); // 'all' | 'stageAdmins' | 'classServants' | 'specificClass'
  const [gaServantClass, setGaServantClass] = useState('');
  const [gaStudentFilter, setGaStudentFilter] = useState('all'); // 'all' | 'specificStage'
  const [gaStudentStages, setGaStudentStages] = useState([]);
  const [gaStudentClasses, setGaStudentClasses] = useState([]);

  // Lists fetched from DB
  const [historyList, setHistoryList] = useState([]);

  const visibleHistoryList = useMemo(() => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return historyList.filter(log => !log.createdAt || log.createdAt > oneDayAgo);
  }, [historyList]);

  const ALL_CLASSES = useMemo(() => Object.values(STAGE_CLASSES).flat(), []);

  // Setup Arabic normalization helper
  const normalizeArabic = (str) => {
    if (!str) return '';
    return str
      .replace(/[أإآا]/g, 'ا')
      .replace(/[ىي]/g, 'ي')
      .replace(/[ةه]/g, 'ه')
      .trim();
  };

  const myStage = useMemo(() => {
    if (!servant) return '';
    const rawStage = servant.assignedStage || servant.grade || '';
    if (rawStage.includes('ابتدائي') || rawStage.includes('ابتدائى')) return 'ابتدائي';
    if (rawStage.includes('اعدادي') || rawStage.includes('اعدادى')) return 'اعدادي';
    if (rawStage.includes('ثانوي') || rawStage.includes('ثانوى')) return 'ثانوي';
    
    const myClassesNorm = (authorizedClasses || []).map(c => normalizeArabic(c));
    for (const [stg, clses] of Object.entries(STAGE_CLASSES)) {
      const stageNorm = clses.map(c => normalizeArabic(c));
      if (myClassesNorm.some(c => stageNorm.includes(c))) {
        return stg;
      }
    }
    return '';
  }, [servant, authorizedClasses]);

  const myClasses = useMemo(() => {
    if (isGeneralAdmin) return Object.values(STAGE_CLASSES).flat();
    return authorizedClasses || [];
  }, [isGeneralAdmin, authorizedClasses]);

  // Sync state with logged-in user context
  useEffect(() => {
    if (!isGeneralAdmin) {
      if (myStage) {
        setGaStudentStages([myStage]);
        setGaStudentClasses(myClasses);
      }
    }
  }, [myStage, myClasses, isGeneralAdmin]);

  // Toast trigger helper
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // 1. Fetch / Listen to Settings Document
  useEffect(() => {
    const docRef = doc(db, 'settings', 'notifications');
    const unsub = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setSettings(prev => ({ ...prev, ...docSnap.data() }));
      }
      setLoadingSettings(false);
    }, (error) => {
      console.error("Error loading notification settings:", error);
      setLoadingSettings(false);
    });

    return () => unsub();
  }, []);

  // 2. Fetch Recipients List dynamically based on user role
  useEffect(() => {
    if (activeSubTab !== 'send' && editingAlertId === null) return;

    const fetchRecipients = async () => {
      setLoadingRecipients(true);
      try {
        // Fetch BOTH servants and students in parallel for everyone
        const [servantsSnap, studentsSnap] = await Promise.all([
          getDocs(collection(db, 'servants')),
          getDocs(collection(db, 'students'))
        ]);

        const servants = servantsSnap.docs
          .filter(d => d.data().status === 'approved' && d.data().isActive !== false)
          .map(d => ({
            id: d.id,
            name: typeof d.data().name === 'object' ? d.data().name.name : d.data().name || '',
            role: d.data().role || '',
            myClasses: d.data().myClasses || (d.data().assignedClass ? [d.data().assignedClass] : []),
            managedClasses: d.data().managedClasses || [],
            assignedStage: d.data().assignedStage || d.data().grade || '',
            fcmToken: d.data().fcmToken || '',
            fcmTokens: d.data().fcmTokens || []
          }));

        const students = studentsSnap.docs.map(d => ({
          id: d.id,
          name: d.data().name || '',
          assignedClass: d.data().assignedClass || '',
          schoolGrade: d.data().schoolGrade || '',
          stage: d.data().stage || '',
          attendance: d.data().attendance || [],
          liturgyAttendance: d.data().liturgyAttendance || [],
          fcmToken: d.data().fcmToken || '',
          fcmTokens: d.data().fcmTokens || []
        }));

        setAllDbServants(servants);
        setAllDbStudents(students);
      } catch (error) {
        console.error("Error fetching recipients:", error);
        showToast('حدث خطأ أثناء تحميل قائمة المستلمين', 'error');
      } finally {
        setLoadingRecipients(false);
      }
    };

    fetchRecipients();
  }, [activeSubTab, editingAlertId]);

  // Calculate final recipients list based on roles and filters
  const recipientsList = useMemo(() => {
    let list = [];

    // Let's determine authorized boundaries
    const myClassesNorm = myClasses.map(c => normalizeArabic(c));
    const stageClassesNorm = myStage ? (STAGE_CLASSES[myStage] || []).map(c => normalizeArabic(c)) : [];

    // 1. Servant Target
    if (gaTargetType === 'servants' || gaTargetType === 'both') {
      if (!isClassServant) {
        let servants = [...allDbServants];

        // Filter out the sender themselves (only for standard sends, not for configuring periodic alerts)
        if (servant?.id && editingAlertId === null) {
          servants = servants.filter(s => s.id !== servant.id);
        }

        // If Stage Admin, filter only class servants of their stage (exclude other stage admins)
        if (isStageServant) {
          servants = servants.filter(s => {
            // Exclude stage admins
            const isStageAdmin = normalizeArabic(s.role).includes('مرحله');
            if (isStageAdmin) return false;

            const sClasses = s.myClasses || (s.assignedClass ? [s.assignedClass] : []);
            const sClassesNorm = sClasses.map(c => normalizeArabic(c));
            const sManagedNorm = (s.managedClasses || []).map(c => normalizeArabic(c));
            const allServantClassesNorm = [...sClassesNorm, ...sManagedNorm];
            return allServantClassesNorm.some(cls => stageClassesNorm.includes(cls));
          });
        }

        // Apply filters
        if (gaServantFilter === 'stageAdmins') {
          servants = servants.filter(s => normalizeArabic(s.role).includes('مرحله'));
        } else if (gaServantFilter === 'classServants') {
          servants = servants.filter(s => 
            (normalizeArabic(s.role).includes('فصل') || normalizeArabic(s.role).includes('خادم')) && 
            !normalizeArabic(s.role).includes('مرحله')
          );
        } else if (gaServantFilter === 'specificClass' && gaServantClass) {
          const classNorm = normalizeArabic(gaServantClass);
          servants = servants.filter(s => {
            const sClasses = s.myClasses || (s.assignedClass ? [s.assignedClass] : []);
            const sClassesNorm = sClasses.map(c => normalizeArabic(c));
            const sManagedNorm = (s.managedClasses || []).map(c => normalizeArabic(c));
            return [...sClassesNorm, ...sManagedNorm].includes(classNorm);
          });
        }

        list = [...list, ...servants];
      }
    }

    // 2. Student Target
    if (gaTargetType === 'students' || gaTargetType === 'both') {
      let students = [...allDbStudents];

      // If Stage Admin, restrict students to their stage classes
      if (isStageServant) {
        students = students.filter(s => stageClassesNorm.includes(normalizeArabic(s.assignedClass)));
      }
      // If Class Servant, restrict students to their class(es)
      else if (isClassServant) {
        students = students.filter(s => myClassesNorm.includes(normalizeArabic(s.assignedClass)));
      }

      // Apply Filters
      if (gaStudentFilter === 'specificStage') {
        const checkedClassesNorm = gaStudentClasses.map(c => normalizeArabic(c));
        students = students.filter(s => checkedClassesNorm.includes(normalizeArabic(s.assignedClass)));
      }

      // Apply Daily Attendance Filter if enabled (Friday attendance targeting logic)
      if (enableAttendanceFilter) {
        const getAttendanceTargetDate = (baseDate = new Date()) => {
          const date = new Date(baseDate);
          const day = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
          let daysToSubtract = 0;
          if (day === 6) daysToSubtract = 1;       // Saturday
          else if (day === 0) daysToSubtract = 2;  // Sunday
          else if (day === 1) daysToSubtract = 3;  // Monday
          else if (day === 2) daysToSubtract = 4;  // Tuesday
          else if (day === 3) daysToSubtract = 5;  // Wednesday
          else if (day === 4) daysToSubtract = 6;  // Thursday
          else if (day === 5) daysToSubtract = 0;  // Friday
          
          date.setDate(date.getDate() - daysToSubtract);
          return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        };
        const targetDateStr = getAttendanceTargetDate();
        
        students = students.filter(s => {
          const attendedService = s.attendance && s.attendance.includes(targetDateStr);
          const attendedLiturgy = s.liturgyAttendance && s.liturgyAttendance.includes(targetDateStr);

          if (attendanceFilterType === 'attendedService') return attendedService;
          if (attendanceFilterType === 'notAttendedService') return !attendedService;
          if (attendanceFilterType === 'attendedLiturgy') return attendedLiturgy;
          if (attendanceFilterType === 'notAttendedLiturgy') return !attendedLiturgy;
          return true;
        });
      }

      list = [...list, ...students];
    }

    return list;
  }, [
    isGeneralAdmin,
    isStageServant,
    isClassServant,
    allDbServants,
    allDbStudents,
    myClasses,
    myStage,
    gaTargetType,
    gaServantFilter,
    gaServantClass,
    gaStudentFilter,
    gaStudentStages,
    gaStudentClasses,
    enableAttendanceFilter,
    attendanceFilterType
  ]);

  // Role-based visibility for periodic alerts
  const filteredPeriodicAlerts = useMemo(() => {
    const rawAlerts = settings.periodicAlerts || [];
    
    // Role-based visibility filtering
    return rawAlerts.filter(alert => {
      if (isGeneralAdmin) return true;
      
      const creatorRole = alert.creatorRole || 'admin';
      const isCreatorAdmin = creatorRole === 'admin' || creatorRole.includes('عام') || alert.createdBy === 'admin';
      
      if (isCreatorAdmin) {
        return false; // General admin alerts are invisible to all other servants
      }
      
      if (isStageServant && servant) {
        // Stage admin sees alerts they created or those created by servants in their stage
        if (alert.createdBy === servant.id) return true;
        if (alert.creatorStage && alert.creatorStage === servant.stage) return true;
        return false;
      }
      
      if (isClassServant && servant) {
        // Class servant sees alerts they created
        if (alert.createdBy === servant.id) return true;
        
        // If created by stage admin of their stage
        const isCreatorStageAdmin = creatorRole.includes('مرحله') || creatorRole.includes('مرحلة');
        if (isCreatorStageAdmin && alert.creatorStage === servant.stage) {
          // Hide if it targets servants
          if (alert.targetType === 'servants') return false;
          return true;
        }
        
        // If created by another servant of their class/stage
        const myClassesNorm = (servant.myClasses || (servant.assignedClass ? [servant.assignedClass] : [])).map(c => normalizeArabic(c));
        const alertClassesNorm = (alert.studentClasses || []).map(c => normalizeArabic(c));
        const hasClassOverlap = alertClassesNorm.some(c => myClassesNorm.includes(c));
        
        if (hasClassOverlap) return true;
        return false;
      }
      
      return false;
    });
  }, [settings.periodicAlerts, isGeneralAdmin, isStageServant, isClassServant, servant]);

  // Auto-select matched recipients when list changes
  useEffect(() => {
    if (skipAutoSelect) {
      setSkipAutoSelect(false);
      return;
    }
    setSelectedRecipients(recipientsList.map(r => r.id));
  }, [recipientsList, skipAutoSelect]);

  // 3. Listen to Notifications Logs History
  useEffect(() => {
    if (activeSubTab !== 'history') return;

    let q = query(collection(db, 'notifications'));
    
    // Non-general admin only sees their own sent notifications
    if (!isGeneralAdmin && servant?.id) {
      q = query(
        collection(db, 'notifications'), 
        where('senderId', '==', servant.id)
      );
    }

    const unsub = onSnapshot(q, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate() : new Date(),
        publishAt: doc.data().publishAt?.toDate ? doc.data().publishAt.toDate() : null
      }));
      // Sort client-side by createdAt descending to avoid composite index requirement
      logs.sort((a, b) => b.createdAt - a.createdAt);
      setHistoryList(logs);
    }, (error) => {
      console.error("Error fetching notification logs:", error);
    });

    return () => unsub();
  }, [activeSubTab, isGeneralAdmin, servant]);

  // Handle saving general settings
  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await setDoc(doc(db, 'settings', 'notifications'), settings, { merge: true });
      showToast('تم حفظ إعدادات الإشعارات بنجاح!');
    } catch (error) {
      console.error("Error saving notification settings:", error);
      showToast('خطأ في حفظ الإعدادات، يرجى المحاولة لاحقاً', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingAlertId(null);
    setManualTitle('');
    setManualBody('');
    setAlertDays([]);
    setAlertTime('06:30');
    setGaTargetType('students');
    setGaServantFilter('all');
    setGaServantClass('');
    setGaStudentFilter('all');
    if (!isGeneralAdmin) {
      if (myStage) {
        setGaStudentStages([myStage]);
        setGaStudentClasses(myClasses);
      }
    } else {
      setGaStudentStages([]);
      setGaStudentClasses([]);
    }
    setSelectedRecipients([]);
    setEnableAttendanceFilter(false);
    setAttendanceFilterType('attendedService');
  };

  // Handle saving periodic alerts list to Firestore (with legacy liturgy sync)
  const savePeriodicAlertsToDb = async (updatedAlerts) => {
    setSavingSettings(true);
    try {
      const firstAlert = updatedAlerts[0] || null;
      const updatedSettings = {
        ...settings,
        periodicAlerts: updatedAlerts,
        liturgyEnabled: firstAlert ? firstAlert.enabled : false,
        liturgyTime: firstAlert ? firstAlert.time : '06:30',
        liturgyMessage: firstAlert ? firstAlert.message : ''
      };
      
      await setDoc(doc(db, 'settings', 'notifications'), updatedSettings, { merge: true });
      setSettings(updatedSettings);
      showToast('تم تحديث التنبيهات الدورية بنجاح!');
      handleCancelEdit();
    } catch (error) {
      console.error("Error saving periodic alerts:", error);
      showToast('خطأ في حفظ التنبيهات، يرجى المحاولة لاحقاً', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleStartEditAlert = (alert) => {
    setSkipAutoSelect(true);
    setEditingAlertId(alert.id);
    setAlertDays(alert.days || []);
    setAlertTime(alert.time || '06:30');
    setManualTitle(alert.title || 'تنبيه دوري');
    setManualBody(alert.message || '');
    setGaTargetType(alert.targetType || 'students');
    setGaServantFilter(alert.servantFilter || 'all');
    setGaServantClass(alert.servantClass || '');
    setGaStudentFilter(alert.studentFilter || 'all');
    setGaStudentStages(alert.studentStages || []);
    setGaStudentClasses(alert.studentClasses || []);
    setSelectedRecipients(alert.selectedRecipients || []);
    setEnableAttendanceFilter(alert.enableAttendanceFilter || false);
    setAttendanceFilterType(alert.attendanceFilterType || 'attendedService');
  };

  const handleSaveAlert = async () => {
    if (alertDays.length === 0) {
      showToast('يرجى اختيار يوم واحد على الأقل', 'error');
      return;
    }
    if (!manualBody.trim()) {
      showToast('يرجى كتابة نص الرسالة الدورية', 'error');
      return;
    }

    let updatedAlerts = [...(settings.periodicAlerts || [])];
    if (editingAlertId === 'new') {
      const newAlert = {
        id: Date.now().toString(),
        enabled: true,
        days: alertDays,
        time: alertTime,
        title: manualTitle.trim() || 'تنبيه دوري',
        message: manualBody.trim(),
        targetType: gaTargetType,
        servantFilter: gaServantFilter,
        servantClass: gaServantClass,
        studentFilter: gaStudentFilter,
        studentStages: gaStudentStages,
        studentClasses: gaStudentClasses,
        selectedRecipients: selectedRecipients,
        enableAttendanceFilter: enableAttendanceFilter,
        attendanceFilterType: attendanceFilterType
      };
      updatedAlerts.push(newAlert);
    } else {
      updatedAlerts = updatedAlerts.map(a => 
        a.id === editingAlertId 
          ? { 
              ...a, 
              days: alertDays, 
              time: alertTime, 
              title: manualTitle.trim() || 'تنبيه دوري',
              message: manualBody.trim(),
              targetType: gaTargetType,
              servantFilter: gaServantFilter,
              servantClass: gaServantClass,
              studentFilter: gaStudentFilter,
              studentStages: gaStudentStages,
              studentClasses: gaStudentClasses,
              selectedRecipients: selectedRecipients,
              enableAttendanceFilter: enableAttendanceFilter,
              attendanceFilterType: attendanceFilterType
            } 
          : a
      );
    }

    await savePeriodicAlertsToDb(updatedAlerts);
  };

  const handleCreateNewPeriodicAlert = async () => {
    if (alertDays.length === 0) {
      showToast('يرجى اختيار يوم واحد على الأقل', 'error');
      return;
    }
    if (!manualBody.trim()) {
      showToast('يرجى كتابة نص الرسالة الدورية', 'error');
      return;
    }
    if (selectedRecipients.length === 0) {
      showToast('يرجى تحديد مستلم واحد على الأقل', 'error');
      return;
    }

    setSavingSettings(true);
    try {
      const newAlert = {
        id: Date.now().toString(),
        enabled: true,
        days: alertDays,
        time: alertTime,
        title: manualTitle.trim() || 'تنبيه دوري',
        message: manualBody.trim(),
        targetType: gaTargetType,
        servantFilter: gaServantFilter,
        servantClass: gaServantClass,
        studentFilter: gaStudentFilter,
        studentStages: gaStudentStages,
        studentClasses: gaStudentClasses,
        selectedRecipients: selectedRecipients,
        enableAttendanceFilter: enableAttendanceFilter,
        attendanceFilterType: attendanceFilterType,
        createdBy: isGeneralAdmin ? 'admin' : (servant?.id || 'admin'),
        creatorRole: isGeneralAdmin ? 'admin' : (servant?.role || 'admin'),
        creatorStage: isGeneralAdmin ? '' : (servant?.stage || '')
      };

      const updatedAlerts = [...(settings.periodicAlerts || []), newAlert];
      const firstAlert = updatedAlerts[0] || null;
      const updatedSettings = {
        ...settings,
        periodicAlerts: updatedAlerts,
        liturgyEnabled: firstAlert ? firstAlert.enabled : false,
        liturgyTime: firstAlert ? firstAlert.time : '06:30',
        liturgyMessage: firstAlert ? firstAlert.message : ''
      };
      
      await setDoc(doc(db, 'settings', 'notifications'), updatedSettings, { merge: true });
      setSettings(updatedSettings);
      showToast('تمت إضافة وحفظ التنبيه الدوري بنجاح!');
      handleCancelEdit();
      setIsPeriodic(false);
      setActiveSubTab('settings');
    } catch (error) {
      console.error("Error creating periodic alert:", error);
      showToast('خطأ في حفظ التنبيه الجديد، يرجى المحاولة لاحقاً', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleToggleAlert = async (alertId) => {
    const updatedAlerts = (settings.periodicAlerts || []).map(a => 
      a.id === alertId ? { ...a, enabled: !a.enabled } : a
    );
    await savePeriodicAlertsToDb(updatedAlerts);
  };

  const handleDeleteAlert = async (alertId) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا التنبيه الدوري؟')) return;
    const updatedAlerts = (settings.periodicAlerts || []).filter(a => a.id !== alertId);
    await savePeriodicAlertsToDb(updatedAlerts);
  };

  // Handle manual dispatch
  const handleSendNotification = async () => {
    if (!manualTitle.trim() || !manualBody.trim()) {
      showToast('يرجى ملء جميع الحقول (العنوان ومحتوى الرسالة)', 'error');
      return;
    }
    if (selectedRecipients.length === 0) {
      showToast('يرجى تحديد مستلم واحد على الأقل', 'error');
      return;
    }
    if (publishType === 'custom' && (!publishDate || !publishTime)) {
      showToast('يرجى تحديد تاريخ ووقت النشر المخصص', 'error');
      return;
    }

    setSendingNotification(true);
    try {
      const targetRecipients = recipientsList.filter(r => selectedRecipients.includes(r.id));
      const recipientNames = targetRecipients.map(r => r.name);

      const isScheduled = publishType === 'custom' && publishDate && publishTime;
      const scheduledAtDate = isScheduled ? new Date(`${publishDate}T${publishTime}`) : null;

      // Extract FCM Tokens
      const tokenSet = new Set();
      targetRecipients.forEach(r => {
        if (r.fcmToken) {
          tokenSet.add(r.fcmToken);
        } else if (r.fcmTokens && Array.isArray(r.fcmTokens)) {
          r.fcmTokens.forEach(token => {
            if (token) tokenSet.add(token);
          });
        }
      });
      const targetTokens = [...tokenSet];

      if (isScheduled) {
        // جدولة الإشعار ليتم إرساله لاحقاً بواسطة الـ Server Cron Job
        const scheduledDoc = {
          title: manualTitle.trim(),
          body: manualBody.trim(),
          senderId: servant?.id || 'admin',
          senderName: servant?.name || 'الأمين العام',
          senderRole: servant?.role || 'أمين عام',
          recipientType: (isGeneralAdmin || isStageServant) ? gaTargetType : 'students',
          recipientIds: selectedRecipients,
          recipientNames: recipientNames,
          createdAt: serverTimestamp(),
          scheduledAt: scheduledAtDate,
          scheduledAtLocal: `${publishDate}T${publishTime}:00`, // Cairo local time string
          tokens: targetTokens, // حفظ التوكنات المستهدفة عند الجدولة
          sentCount: selectedRecipients.length,
          status: 'pending'
        };

        await addDoc(collection(db, 'scheduled_notifications'), scheduledDoc);
        showToast('تم جدولة الإشعار بنجاح! ⏰');
      } else {
        // إرسال فوري
        const notificationDoc = {
          title: manualTitle.trim(),
          body: manualBody.trim(),
          senderId: servant?.id || 'admin',
          senderName: servant?.name || 'الأمين العام',
          senderRole: servant?.role || 'أمين عام',
          recipientType: (isGeneralAdmin || isStageServant) ? gaTargetType : 'students',
          recipientIds: selectedRecipients,
          recipientNames: recipientNames,
          createdAt: serverTimestamp(),
          publishAt: serverTimestamp(),
          sentCount: selectedRecipients.length
        };

        // 1. Save in-app notification in Firestore
        await addDoc(collection(db, 'notifications'), notificationDoc);

        // 2. Broadcast notifications via online Node.js server on Vercel
        console.log(`[FCM Send] Found ${targetTokens.length} unique token(s). Starting send...`);

        if (targetTokens.length === 0) {
          console.warn('[FCM Send] No tokens found for selected recipients! Saving in-app notification only.');
          showToast('تم حفظ التنبيه في جرس التطبيق (لا يوجد أجهزة مسجلة للمستلمين) 🔔');
        } else {
          const replaceNamePlaceholder = (text, name) => {
            if (!text) return '';
            return text
              .replace(/\(name\)/g, name)
              .replace(/\{name\}/g, name)
              .replace(/\[name\]/g, name)
              .replace(/\<name\>/g, name);
          };

          for (const recipient of targetRecipients) {
            const recipientTokens = [];
            if (recipient.fcmToken) {
              recipientTokens.push(recipient.fcmToken);
            } else if (recipient.fcmTokens && Array.isArray(recipient.fcmTokens)) {
              recipient.fcmTokens.forEach(t => { if (t) recipientTokens.push(t); });
            }

            const pTitle = replaceNamePlaceholder(manualTitle.trim(), recipient.name);
            const pBody = replaceNamePlaceholder(manualBody.trim(), recipient.name);

            for (const targetToken of recipientTokens) {
              try {
                console.log(`[FCM Send] Sending personalized notification to: ${recipient.name} (${targetToken.substring(0, 10)}...)`);
                const response = await fetch('https://server-ochre-one-17.vercel.app/api/send-notification', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                    token: targetToken,
                    title: pTitle,
                    body: pBody
                  })
                });
                const data = await response.json();
                if (data.success) {
                  console.log(`[FCM ✅] Sent successfully to: ${recipient.name}`);
                } else {
                  console.error(`[FCM ❌] Server error for: ${recipient.name}. Error: ${data.error}`);
                }
              } catch (fcmErr) {
                console.error('[FCM ❌] Fetch failed:', fcmErr);
              }
            }
          }
          showToast('تم بث الإشعار بنجاح! 🔔');
        }
      }
      
      // Reset Form
      setManualTitle('');
      setManualBody('');
      setSelectedRecipients([]);
      setSearchQuery('');
      setPublishType('now');
      setPublishDate('');
      setPublishTime('');
      
      // Redirect to history tab
      setActiveSubTab('history');
    } catch (error) {
      console.error("Error dispatching notification:", error);
      showToast('حدث خطأ أثناء الإرسال، حاول مرة أخرى', 'error');
    } finally {
      setSendingNotification(false);
    }
  };

    const handleDeleteSentNotification = async (id) => {
    if (!window.confirm('هل أنت متأكد من مسح هذا الإشعار تماماً؟ سيتم حذفه أيضاً من صناديق الوارد لدى المستلمين.')) return;
    try {
      await deleteDoc(doc(db, 'notifications', id));
      showToast('تم مسح الإشعار بنجاح!');
    } catch (error) {
      console.error("Error deleting notification:", error);
      showToast('حدث خطأ أثناء مسح الإشعار، يرجى المحاولة لاحقاً', 'error');
    }
  };

  // Select all / Deselect all recipients
  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedRecipients(filteredRecipients.map(r => r.id));
    } else {
      setSelectedRecipients([]);
    }
  };

  // Filtered recipients list based on search query
  const filteredRecipients = useMemo(() => {
    if (!searchQuery.trim()) return recipientsList;
    const queryNorm = normalizeArabic(searchQuery);
    return recipientsList.filter(r => 
      normalizeArabic(r.name).includes(queryNorm) || 
      (r.role && normalizeArabic(r.role).includes(queryNorm))
    );
  }, [recipientsList, searchQuery]);

  return (
    <div className="w-full text-right" dir="rtl">
      {/* Toast Alert */}
      {toast && (
        <div className={`fixed top-20 left-4 z-50 p-4 rounded-xl shadow-lg flex items-center gap-3 animate-in fade-in slide-in-from-left-5 ${
          toast.type === 'error' 
            ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/50' 
            : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/50'
        }`}>
          {toast.type === 'error' ? <AlertCircle size={20} /> : <Sparkles size={20} />}
          <span className="font-bold text-sm">{toast.message}</span>
        </div>
      )}

      {/* Main Container */}
      {!quickSendOnly && (
        <div className="bg-[#271e48] text-white p-6 rounded-3xl shadow-xl mb-6 relative overflow-hidden">
          {/* Subtle decorative elements */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-teal-500/10 rounded-full blur-3xl -z-10"></div>
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -z-10"></div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="p-2 bg-white/10 rounded-xl">
                  <Bell className="text-teal-400" size={24} />
                </div>
                <h2 className="text-2xl font-black">لوحة التحكم الذكية للإشعارات</h2>
              </div>
              <p className="text-slate-300 text-sm">إدارة التنبيهات الأسبوعية وأعياد الميلاد التلقائية، وإرسال الإشعارات المباشرة للمستهدفين.</p>
            </div>

            {/* Sub Navigation Tabs */}
            <div className="flex bg-white/5 p-1 rounded-2xl border border-white/10 self-start md:self-auto shrink-0">
              <button
                onClick={() => setActiveSubTab('settings')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-base transition-all cursor-pointer ${
                  activeSubTab === 'settings'
                    ? 'bg-white text-[#271e48] shadow-md'
                    : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <Settings size={18} />
                <span>إعدادات التلقائي</span>
              </button>
              <button
                onClick={() => setActiveSubTab('send')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-base transition-all cursor-pointer ${
                  activeSubTab === 'send'
                    ? 'bg-white text-[#271e48] shadow-md'
                    : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <Send size={18} />
                <span>إرسال إشعار يدوي</span>
              </button>
              <button
                onClick={() => setActiveSubTab('history')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-base transition-all cursor-pointer ${
                  activeSubTab === 'history'
                    ? 'bg-white text-[#271e48] shadow-md'
                    : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <History size={18} />
                <span>سجل الإرسال</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading main configurations */}
      {loadingSettings && activeSubTab === 'settings' ? (
        <div className="bg-white dark:bg-[#1e293b] p-12 rounded-3xl shadow-md border border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center gap-4">
          <Loader2 className="animate-spin text-[#271e48] dark:text-teal-400" size={36} />
          <p className="text-slate-500 dark:text-slate-400 font-bold">جاري تحميل إعدادات لوحة التحكم...</p>
        </div>
      ) : (
        <>
          {/* TAB 1: Automatic configurations */}
          {activeSubTab === 'settings' && (
            editingAlertId !== null ? (
              /* Full-page 3-column Editor */
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-300 text-right">
                {/* Form Input fields */}
                <div className="lg:col-span-2 bg-white dark:bg-[#1e293b] p-6 rounded-3xl shadow-md border border-slate-100 dark:border-slate-800 transition-colors duration-300 flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 pb-3 border-b border-slate-150 dark:border-slate-800">
                      <Edit size={18} className="text-indigo-500" />
                      <h3 className="font-black text-lg text-slate-800 dark:text-white">تعديل التنبيه الدوري 📝</h3>
                    </div>

                    {/* Day & Time Scheduler Card */}
                    <div className="p-3 bg-indigo-50/30 dark:bg-[#0f172a]/40 rounded-2xl border border-indigo-150/40 dark:border-slate-800/85 space-y-3">
                      {/* Day Selector */}
                      <div>
                        <label className="block text-slate-500 dark:text-slate-450 text-xs font-bold mb-1.5">أيام الإرسال الدورية:</label>
                        <div className="grid grid-cols-4 gap-2">
                          {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map(day => {
                            const isChecked = alertDays.includes(day);
                            return (
                              <label key={day} className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-350 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setAlertDays(prev => [...prev, day]);
                                    } else {
                                      setAlertDays(prev => prev.filter(d => d !== day));
                                    }
                                  }}
                                  className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                                />
                                <span>{day}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      {/* Time Selector */}
                      <div>
                        <label className="block text-slate-500 dark:text-slate-450 text-xs font-bold mb-1.5">وقت الإرسال الدقيق:</label>
                        <input 
                          type="time" 
                          className="w-full py-2 px-3 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-indigo-500 rounded-lg text-sm font-bold"
                          value={alertTime}
                          onChange={(e) => setAlertTime(e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Target Audience Filters */}
                    <div className="space-y-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                      {/* Target Type Selector */}
                      {(isGeneralAdmin || isStageServant) && (
                        <div>
                          <label className="block text-slate-500 dark:text-white text-sm font-bold mb-1.5 font-sans">فئة المستلمين المستهدفة</label>
                          <select
                            className="w-full py-2.5 px-4 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-indigo-500 rounded-xl text-sm font-bold cursor-pointer"
                            value={gaTargetType}
                            onChange={(e) => {
                              setGaTargetType(e.target.value);
                              setGaServantFilter('all');
                              setGaStudentFilter('all');
                            }}
                          >
                            <option value="servants">الخدام فقط 🧑‍🏫</option>
                            <option value="students">المخدومين فقط 👶</option>
                            <option value="both">الكل (خدام ومخدومين) 👥</option>
                          </select>
                        </div>
                      )}

                      {/* Servants Filter Section */}
                      {(isGeneralAdmin || isStageServant) && (gaTargetType === 'servants' || gaTargetType === 'both') && (
                        <div className="p-3 bg-indigo-50/50 dark:bg-indigo-950/20 rounded-2xl border border-indigo-100/50 dark:border-indigo-900/30 space-y-2">
                          <label className="block text-indigo-700 dark:text-indigo-455 text-xs font-black">تحديد الخدام المستهدفين</label>
                          <select
                            className="w-full py-2 px-3 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-1 focus:ring-indigo-500 rounded-lg text-sm cursor-pointer"
                            value={gaServantFilter}
                            onChange={(e) => setGaServantFilter(e.target.value)}
                          >
                            <option value="all">{isGeneralAdmin ? 'كل الخدام' : 'كل خدام المرحلة'}</option>
                            {isGeneralAdmin && <option value="stageAdmins">أمناء المراحل فقط</option>}
                            {isGeneralAdmin && <option value="classServants">خدام الفصول فقط</option>}
                            <option value="specificClass">{isGeneralAdmin ? 'خدام فصل معين' : 'خدام فصل معين بالمرحلة'}</option>
                          </select>

                          {gaServantFilter === 'specificClass' && (
                            <select
                              className="w-full py-2 px-3 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-1 focus:ring-indigo-500 rounded-lg text-sm mt-2 cursor-pointer font-bold text-slate-700 dark:text-slate-350"
                              value={gaServantClass}
                              onChange={(e) => setGaServantClass(e.target.value)}
                            >
                              <option value="">اختر الفصل...</option>
                              {(isGeneralAdmin ? ALL_CLASSES : myClasses).map(cls => (
                                <option key={cls} value={cls}>{cls}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}

                      {/* Students Filter Section */}
                      {(gaTargetType === 'students' || gaTargetType === 'both') && (
                        <div className="p-3 bg-teal-50/50 dark:bg-teal-950/20 rounded-2xl border border-teal-100/50 dark:border-teal-900/30 space-y-2">
                          <label className="block text-teal-700 dark:text-teal-450 text-xs font-black">تحديد المخدومين المستهدفين</label>
                          <select
                            className="w-full py-2 px-3 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-1 focus:ring-[#271e48] rounded-lg text-sm cursor-pointer mb-2"
                            value={gaStudentFilter}
                            onChange={(e) => setGaStudentFilter(e.target.value)}
                          >
                            <option value="all">كل المخدومين</option>
                            <option value="specificStage">مراحل وفصول معينة</option>
                          </select>

                          {gaStudentFilter === 'specificStage' && (
                            <div className="space-y-3 pt-2">
                              {/* Stage Checkboxes */}
                              <div>
                                <span className="block text-xs text-slate-450 font-bold mb-1.5">اختر المراحل المستهدفة:</span>
                                <div className="flex flex-wrap gap-3">
                                  {['ابتدائي', 'اعدادي', 'ثانوي'].map(stg => {
                                    const isDisabled = !isGeneralAdmin && stg !== myStage;
                                    const isChecked = gaStudentStages.includes(stg);
                                    
                                    if (isDisabled && !isGeneralAdmin) return null;
                                    
                                    return (
                                      <label key={stg} className="flex items-center gap-1.5 text-sm font-bold text-slate-700 dark:text-slate-350 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          disabled={isDisabled}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setGaStudentStages(prev => [...prev, stg]);
                                              const stageClasses = STAGE_CLASSES[stg] || [];
                                              const allowedStageClasses = isGeneralAdmin 
                                                ? stageClasses 
                                                : stageClasses.filter(c => myClasses.includes(c));
                                              setGaStudentClasses(prev => [...new Set([...prev, ...allowedStageClasses])]);
                                            } else {
                                              setGaStudentStages(prev => prev.filter(s => s !== stg));
                                              const stageClasses = STAGE_CLASSES[stg] || [];
                                              setGaStudentClasses(prev => prev.filter(c => !stageClasses.includes(c)));
                                            }
                                          }}
                                          className="rounded text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
                                        />
                                        <span>{stg}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Class Checkboxes for selected stages */}
                              {gaStudentStages.length > 0 && (
                                <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="block text-xs text-slate-455 font-bold">اختر الفصول المستهدفة:</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const allSelectedClasses = gaStudentStages.flatMap(stg => {
                                          const classes = STAGE_CLASSES[stg] || [];
                                          return isGeneralAdmin ? classes : classes.filter(c => myClasses.includes(c));
                                        });
                                        
                                        const isAllChecked = allSelectedClasses.every(c => gaStudentClasses.includes(c));
                                        if (isAllChecked) {
                                          setGaStudentClasses(prev => prev.filter(c => !allSelectedClasses.includes(c)));
                                        } else {
                                          setGaStudentClasses(prev => [...new Set([...prev, ...allSelectedClasses])]);
                                        }
                                      }}
                                      className="text-xs text-teal-600 dark:text-teal-400 font-black hover:underline cursor-pointer border-none bg-transparent"
                                    >
                                      {gaStudentStages.flatMap(stg => {
                                        const classes = STAGE_CLASSES[stg] || [];
                                        return isGeneralAdmin ? classes : classes.filter(c => myClasses.includes(c));
                                      }).every(c => gaStudentClasses.includes(c)) ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
                                    </button>
                                  </div>
                                  
                                  <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-[#0f172a]/50 p-2.5 rounded-xl max-h-40 overflow-y-auto border border-slate-150 dark:border-slate-800/40">
                                    {gaStudentStages.map(stg => {
                                      const stageClasses = STAGE_CLASSES[stg] || [];
                                      const filteredClasses = isGeneralAdmin 
                                        ? stageClasses 
                                        : stageClasses.filter(c => myClasses.includes(c));
                                        
                                      return filteredClasses.map(cls => {
                                        const isChecked = gaStudentClasses.includes(cls);
                                        return (
                                          <label key={cls} className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 cursor-pointer">
                                            <input
                                              type="checkbox"
                                              checked={isChecked}
                                              onChange={(e) => {
                                                if (e.target.checked) {
                                                  setGaStudentClasses(prev => [...prev, cls]);
                                                } else {
                                                  setGaStudentClasses(prev => prev.filter(c => c !== cls));
                                                }
                                              }}
                                              className="rounded text-teal-600 focus:ring-teal-500 w-3 h-3"
                                            />
                                            <span className="truncate">{cls}</span>
                                          </label>
                                        );
                                      });
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                       {/* Daily Attendance Filter */}
                       <div className="p-3 bg-amber-50/40 dark:bg-amber-950/10 rounded-2xl border border-amber-100/50 dark:border-amber-900/30 space-y-2 mt-2">
                         <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-black text-amber-700 dark:text-amber-400">
                           <input
                             type="checkbox"
                             className="w-3.5 h-3.5 rounded text-amber-600 border-slate-350 focus:ring-amber-500"
                             checked={enableAttendanceFilter}
                             onChange={(e) => setEnableAttendanceFilter(e.target.checked)}
                           />
                           <span>تصفية المستهدفين بناءً على الحضور والغياب اليوم 📝</span>
                         </label>
                         
                         {enableAttendanceFilter && (
                           <select
                             className="w-full py-2 px-3 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-1 focus:ring-amber-500 rounded-lg text-sm cursor-pointer mt-1 font-bold"
                             value={attendanceFilterType}
                             onChange={(e) => setAttendanceFilterType(e.target.value)}
                           >
                             <option value="attendedService">الذين حضروا الخدمة اليوم 🟢</option>
                             <option value="notAttendedService">الذين غابوا عن الخدمة اليوم 🔴</option>
                             <option value="attendedLiturgy">الذين حضروا القداس اليوم ⛪</option>
                             <option value="notAttendedLiturgy">الذين غابوا عن القداس اليوم ⚠️</option>
                           </select>
                         )}
                       </div>
                    </div>

                    <div>
                      <label className="block text-slate-500 dark:text-slate-450 text-sm font-bold mb-1.5 font-sans">عنوان الإشعار الدوري</label>
                      <input 
                        type="text" 
                        placeholder="أدخل عنواناً واضحاً للتنبيه"
                        className="w-full py-2.5 px-4 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-indigo-500 rounded-xl text-base font-bold"
                        value={manualTitle}
                        onChange={(e) => setManualTitle(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="block text-slate-500 dark:text-slate-450 text-sm font-bold mb-1.5 font-sans">محتوى الرسالة</label>
                      <textarea
                        rows={5}
                        placeholder="اكتب هنا نص الرسالة الدوري..."
                        className="w-full p-4 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-indigo-500 rounded-xl text-base font-medium resize-none leading-relaxed"
                        value={manualBody}
                        onChange={(e) => setManualBody(e.target.value)}
                      />
                    </div>

                    {/* Target summary helper */}
                    <div className="p-3 bg-slate-50 dark:bg-[#0f172a] rounded-xl border border-slate-100 dark:border-slate-800">
                      <span className="text-sm text-slate-400 block mb-1">المستهدفون بالنظام الحالي:</span>
                      <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                        الترشيح المختار ({recipientsList.length} مستهدف)
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={handleCancelEdit}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-350 py-3.5 rounded-xl font-black text-base transition-all border-none cursor-pointer"
                    >
                      إلغاء
                    </button>
                    <button
                      onClick={handleSaveAlert}
                      disabled={savingSettings}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white py-3.5 rounded-xl font-black text-base shadow-md hover:shadow-lg transition-all active:scale-95 disabled:opacity-50 cursor-pointer border-none"
                    >
                      {savingSettings ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
                      <span>حفظ التعديلات</span>
                    </button>
                  </div>
                </div>

                {/* Right Columns: Recipients List Selection */}
                <div className="lg:col-span-1 bg-white dark:bg-[#1e293b] p-6 rounded-3xl shadow-md border border-slate-100 dark:border-slate-800 flex flex-col">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-150 dark:border-slate-800 mb-4">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-xl">
                        <UserCheck size={20} />
                      </div>
                      <div>
                        <h3 className="font-black text-lg text-slate-800 dark:text-white">قائمة مستلمي التنبيه الدوري</h3>
                        <p className="text-sm text-slate-400">حدد الأشخاص الذين سيصلهم التنبيه الدوري.</p>
                      </div>
                    </div>

                    {/* Search box */}
                    <div className="relative max-w-xs w-full">
                      <span className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-slate-400">
                        <Search size={16} />
                      </span>
                      <input
                        type="text"
                        placeholder="ابحث بالاسم..."
                        className="w-full py-2 pl-3 pr-9 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-1 focus:ring-indigo-500 rounded-xl text-sm font-bold"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </div>
                  </div>

                  {loadingRecipients ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-12 gap-3 text-slate-400">
                      <Loader2 className="animate-spin text-indigo-500" size={28} />
                      <span className="text-sm font-bold">جاري تحميل قائمة الأشخاص من قاعدة البيانات...</span>
                    </div>
                  ) : (
                    <>
                      {/* Header: Select All */}
                      <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-[#0f172a] rounded-xl border border-slate-100 dark:border-slate-800 mb-3">
                        <label className="flex items-center gap-2.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded text-indigo-600 border-slate-350 focus:ring-indigo-500 dark:border-slate-700"
                            checked={filteredRecipients.length > 0 && selectedRecipients.length === filteredRecipients.length}
                            onChange={(e) => handleSelectAll(e.target.checked)}
                            disabled={filteredRecipients.length === 0}
                          />
                          <span className="text-sm font-black text-slate-700 dark:text-slate-300">تحديد الكل ({filteredRecipients.length})</span>
                        </label>
                        <span className="text-sm text-slate-400">محدد حالياً: {selectedRecipients.length} مستلم</span>
                      </div>

                      {/* Checkbox Grid */}
                      <div className="flex-1 max-h-[350px] overflow-y-auto pr-1 space-y-2">
                        {filteredRecipients.length === 0 ? (
                          <div className="text-center py-12 text-slate-500 text-sm">
                            لا توجد نتائج مطابقة لبحثك في النطاق المسموح.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 gap-2">
                            {filteredRecipients.map((person) => {
                              const isChecked = selectedRecipients.includes(person.id);
                              return (
                                <div 
                                  key={person.id}
                                  onClick={() => {
                                    if (isChecked) {
                                      setSelectedRecipients(prev => prev.filter(id => id !== person.id));
                                    } else {
                                      setSelectedRecipients(prev => [...prev, person.id]);
                                    }
                                  }}
                                  className={`p-3 rounded-xl border transition-all duration-200 cursor-pointer flex items-center justify-between ${
                                    isChecked 
                                      ? 'bg-indigo-500/10 border-indigo-500 text-indigo-700 dark:text-indigo-400' 
                                      : 'bg-white dark:bg-[#0f172a]/40 border-slate-100 dark:border-slate-800/80 hover:border-slate-200 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all ${
                                      isChecked 
                                        ? 'bg-indigo-500 border-indigo-500 text-white' 
                                        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0f172a]'
                                    }`}>
                                      {isChecked && <Check size={10} className="text-white" strokeWidth={4} />}
                                    </div>
                                    <div className="text-right">
                                      <p className="text-sm font-bold leading-tight">{person.name}</p>
                                      <p className="text-xs text-slate-400 mt-0.5">
                                        {person.role 
                                          ? `${person.role}` 
                                          : (person.assignedClass ? `مخدوم: ${person.assignedClass}` : 'مخدوم مجهول الفصل')}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                    )}
                  </div>
                </div>
              ) : (
              /* Regular settings tab view: 2-column grid */
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Periodic liturgy reminder settings */}
                <div className="bg-white dark:bg-[#1e293b] p-6 rounded-3xl shadow-md border border-slate-100 dark:border-slate-800 transition-colors duration-300 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800 mb-6">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-450 rounded-xl">
                          <CalendarDays size={22} />
                        </div>
                        <div>
                          <h3 className="font-black text-lg text-slate-800 dark:text-white">التنبيهات الدورية</h3>
                          <p className="text-xs text-slate-400">جدولة التنبيهات وإرسالها تلقائياً للمستهدفين في أيام محددة.</p>
                        </div>
                      </div>
                    </div>

                    {/* Alerts List */}
                    <div className="space-y-4 animate-in fade-in duration-200">
                      <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                        {(!filteredPeriodicAlerts || filteredPeriodicAlerts.length === 0) ? (
                          <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-400">
                            <Bell size={36} className="opacity-25" />
                            <span className="text-xs font-bold text-slate-400">لا توجد تنبيهات دورية حالياً.</span>
                          </div>
                        ) : (
                          filteredPeriodicAlerts.map(alert => (
                            <div 
                              key={alert.id}
                              className="p-3 bg-slate-50 dark:bg-[#0f172a]/40 rounded-2xl border border-slate-150 dark:border-slate-800/80 flex flex-col gap-2 relative overflow-hidden group transition-all"
                            >
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-2">
                                  <div className={`p-1.5 rounded-lg ${alert.enabled ? 'bg-indigo-500/10 text-indigo-500' : 'bg-slate-200 dark:bg-slate-800 text-slate-450'}`}>
                                    <Bell size={14} className={alert.enabled ? "animate-swing" : ""} />
                                  </div>
                                  <div>
                                    <span className="block text-[11px] font-black text-slate-700 dark:text-slate-200">
                                      {alert.title ? `${alert.title} - ` : ''}كل يوم: {alert.days?.join('، ')}
                                    </span>
                                    <span className="block text-[9px] font-bold text-slate-400 dark:text-slate-550 mt-0.5">
                                      الساعة {alert.time} ({alert.targetType === 'servants' ? 'الخدام' : 'المخدومين'})
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2">
                                  {/* Toggle Switch */}
                                  <label className="relative inline-flex items-center cursor-pointer">
                                    <input 
                                      type="checkbox" 
                                      className="sr-only peer"
                                      checked={alert.enabled}
                                      onChange={() => handleToggleAlert(alert.id)}
                                    />
                                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none dark:bg-slate-700 rounded-full peer peer-checked:after:-translate-x-full after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-500"></div>
                                  </label>

                                  <button
                                    onClick={() => handleStartEditAlert(alert)}
                                    className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-indigo-600 rounded-lg cursor-pointer border-none bg-transparent"
                                    title="تعديل"
                                  >
                                    <Edit size={14} />
                                  </button>

                                  <button
                                    onClick={() => handleDeleteAlert(alert.id)}
                                    className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-450 hover:text-rose-600 rounded-lg cursor-pointer border-none bg-transparent"
                                    title="حذف"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>

                              <p className="text-xs text-slate-500 dark:text-slate-350 bg-white dark:bg-[#0f172a] p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/40 leading-relaxed font-semibold whitespace-pre-line text-right">
                                {alert.message}
                              </p>
                              {alert.creatorName && (
                                <span className="text-[9px] text-slate-400 font-bold block text-left">
                                  بواسطة: {alert.creatorName} ({alert.creatorRole})
                                </span>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>

              {/* Automatic birthdays greetings */}
              <div className="bg-white dark:bg-[#1e293b] p-6 rounded-3xl shadow-md border border-slate-100 dark:border-slate-800 transition-colors duration-300 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800 mb-6">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-xl">
                        <CakeSlice size={22} />
                      </div>
                      <div>
                        <h3 className="font-black text-lg text-slate-800 dark:text-white">أعياد الميلاد التلقائية</h3>
                        <p className="text-xs text-slate-400">تهنئة الطلاب والخدام تلقائياً صباح يوم ميلادهم.</p>
                      </div>
                    </div>
                    
                    {/* Toggle Switch */}
                    <div className="flex flex-col items-end">
                      <label className={`relative inline-flex items-center ${isGeneralAdmin ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                        <input 
                          type="checkbox" 
                          className="sr-only peer"
                          checked={settings.birthdayEnabled}
                          disabled={!isGeneralAdmin}
                          onChange={(e) => setSettings({ ...settings, birthdayEnabled: e.target.checked })}
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none dark:bg-slate-700 rounded-full peer peer-checked:after:-translate-x-full after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-500"></div>
                      </label>
                      {!isGeneralAdmin && (
                        <span className="text-[10px] text-amber-500 mt-1 font-bold">تفعيل/تعطيل التهنئة متاح للأمين العام فقط</span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-5">
                    <div className="bg-slate-50 dark:bg-[#0f172a] p-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-l text-slate-500 dark:text-white flex items-start gap-2">
                      <Sparkles size={16} className="text-amber-500 shrink-0 mt-0.5" />
                      <span>يعمل النظام تلقائياً عبر جدولة Cloud Function يومياً في تمام الساعة <b>12:00 AM (منتصف الليل)</b> لمطابقة تواريخ الميلاد وإرسال النصوص التالية. استخدم الرمز <code>{"{name}"}</code> لطباعة اسم الشخص تلقائياً.</span>
                    </div>

                    {/* 1. Servants Birthday Greetings (Hidden for Class Servants) */}
                    {!isClassServant && (
                      <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800/40">
                        <label className="block text-[#271e48] dark:text-white text-base font-black">
                          رسالة التهنئة للخدام 🎂
                        </label>
                        
                        {isGeneralAdmin && (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {[
                              { id: 'general', label: 'الافتراضية العامة' },
                              { id: 'ابتدائي', label: 'مرحلة ابتدائي' },
                              { id: 'اعدادي', label: 'مرحلة إعدادي' },
                              { id: 'ثانوي', label: 'مرحلة ثانوي' }
                            ].map(tab => (
                              <button
                                key={tab.id}
                                type="button"
                                onClick={() => setBirthdayServantStageTab(tab.id)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border-none cursor-pointer ${
                                  birthdayServantStageTab === tab.id
                                    ? 'bg-[#271e48] text-white shadow-sm'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-white hover:bg-slate-200 dark:hover:bg-slate-700'
                                }`}
                              >
                                {tab.label}
                              </button>
                            ))}
                          </div>
                        )}

                        {isGeneralAdmin && birthdayServantStageTab === 'general' && (
                          <div>
                            <p className="text-xs text-white mb-1">الرسالة التلقائية للخدام بجميع المراحل في حال عدم كتابة رسالة مخصصة للمرحلة.</p>
                            <textarea
                              rows={3}
                              className="w-full p-4 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-[#271e48] rounded-xl text-base font-medium resize-none leading-relaxed"
                              value={settings.birthdayServantMessage}
                              onChange={(e) => setSettings({ ...settings, birthdayServantMessage: e.target.value })}
                              disabled={!settings.birthdayEnabled}
                            />
                          </div>
                        )}

                        {isGeneralAdmin && birthdayServantStageTab !== 'general' && (
                          <div>
                            <p className="text-xs text-slate-400 mb-1">الرسالة المخصصة لخدام مرحلة {birthdayServantStageTab}.</p>
                            <textarea
                              rows={3}
                              className="w-full p-4 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-[#271e48] rounded-xl text-base font-medium resize-none leading-relaxed"
                              value={settings.stageBirthdayServantMessages?.[birthdayServantStageTab] || ''}
                              onChange={(e) => {
                                const stageMsg = e.target.value;
                                setSettings(prev => ({
                                  ...prev,
                                  stageBirthdayServantMessages: {
                                    ...prev.stageBirthdayServantMessages,
                                    [birthdayServantStageTab]: stageMsg
                                  }
                                }));
                              }}
                              disabled={!settings.birthdayEnabled}
                              placeholder="اكتب هنا لتهنئة خدام هذه المرحلة تلقائياً، أو اتركها فارغة لاستخدام الرسالة العامة الافتراضية..."
                            />
                          </div>
                        )}

                        {isStageServant && (
                          <div>
                            <p className="text-xs text-slate-400 mb-1">رسالة التهنئة الخاصة بخدام مرحلة {myStage} تحت مسؤوليتك.</p>
                            <textarea
                              rows={3}
                              className="w-full p-4 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-[#271e48] rounded-xl text-base font-medium resize-none leading-relaxed"
                              value={settings.stageBirthdayServantMessages?.[myStage] || ''}
                              onChange={(e) => {
                                const stageMsg = e.target.value;
                                setSettings(prev => ({
                                  ...prev,
                                  stageBirthdayServantMessages: {
                                    ...prev.stageBirthdayServantMessages,
                                    [myStage]: stageMsg
                                  }
                                }));
                              }}
                              disabled={!settings.birthdayEnabled}
                              placeholder="اكتب هنا لتهنئة خدام هذه المرحلة تلقائياً، أو اتركها فارغة لاستخدام الرسالة العامة الافتراضية..."
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* 2. Students Birthday Greetings */}
                    <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800/40">
                      <label className="block text-[#271e48] dark:text-white text-base font-black">
                        رسالة التهنئة للمخدومين 🎂
                      </label>

                      {isGeneralAdmin && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {[
                            { id: 'general', label: 'الافتراضية العامة' },
                            { id: 'ابتدائي', label: 'مرحلة ابتدائي' },
                            { id: 'اعدادي', label: 'مرحلة إعدادي' },
                            { id: 'ثانوي', label: 'مرحلة ثانوي' }
                          ].map(tab => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setBirthdayStudentStageTab(tab.id)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border-none cursor-pointer ${
                                birthdayStudentStageTab === tab.id
                                  ? 'bg-[#271e48] text-white shadow-sm'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-white hover:bg-slate-200 dark:hover:bg-slate-700'
                              }`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* A. General Admin - General Default Student Message */}
                      {isGeneralAdmin && birthdayStudentStageTab === 'general' && (
                        <div>
                          <p className="text-xs text-white mb-1">الرسالة التلقائية للطلاب بجميع الفصول في حال عدم كتابة رسالة مخصصة للفصل.</p>
                          <textarea
                            rows={3}
                            className="w-full p-4 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-[#271e48] rounded-xl text-base font-medium resize-none leading-relaxed"
                            value={settings.birthdayStudentMessage}
                            onChange={(e) => setSettings({ ...settings, birthdayStudentMessage: e.target.value })}
                            disabled={!settings.birthdayEnabled}
                          />
                        </div>
                      )}

                      {/* B. General Admin - Stage specific classes list */}
                      {isGeneralAdmin && birthdayStudentStageTab !== 'general' && (
                        <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1">
                          {(STAGE_CLASSES[birthdayStudentStageTab] || []).map(className => (
                            <div key={className} className="bg-slate-50/50 dark:bg-slate-900/20 p-3 rounded-2xl border border-slate-100 dark:border-slate-800/40">
                              <label className="block text-slate-600 dark:text-slate-350 text-xs font-bold mb-1">
                                {className}
                              </label>
                              <textarea
                                rows={2}
                                className="w-full p-3 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-[#271e48] rounded-xl text-sm font-medium resize-none leading-relaxed"
                                value={settings.classBirthdayMessages?.[className] || ''}
                                onChange={(e) => {
                                  const classMsg = e.target.value;
                                  setSettings(prev => ({
                                    ...prev,
                                    classBirthdayMessages: {
                                      ...prev.classBirthdayMessages,
                                      [className]: classMsg
                                    }
                                  }));
                                }}
                                disabled={!settings.birthdayEnabled}
                                placeholder="اكتب رسالة التهنئة المخصصة لهذا الفصل... (اتركها فارغة لاستخدام الرسالة العامة)"
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      {/* C. Stage Servant - Classes of their stage */}
                      {isStageServant && (
                        <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1">
                          <p className="text-xs text-slate-400 mb-1">الرسائل المخصصة لفصول مرحلة {myStage} تحت مسؤوليتك.</p>
                          {myClasses.map(className => (
                            <div key={className} className="bg-slate-50/50 dark:bg-slate-900/20 p-3 rounded-2xl border border-slate-100 dark:border-slate-800/40">
                              <label className="block text-slate-600 dark:text-slate-350 text-xs font-bold mb-1">
                                {className}
                              </label>
                              <textarea
                                rows={2}
                                className="w-full p-3 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-[#271e48] rounded-xl text-sm font-medium resize-none leading-relaxed"
                                value={settings.classBirthdayMessages?.[className] || ''}
                                onChange={(e) => {
                                  const classMsg = e.target.value;
                                  setSettings(prev => ({
                                    ...prev,
                                    classBirthdayMessages: {
                                      ...prev.classBirthdayMessages,
                                      [className]: classMsg
                                    }
                                  }));
                                }}
                                disabled={!settings.birthdayEnabled}
                                placeholder="اكتب رسالة التهنئة المخصصة لهذا الفصل... (اتركها فارغة لاستخدام الرسالة العامة)"
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      {/* D. Class Servant - Assigned classes only */}
                      {isClassServant && (
                        <div className="space-y-4">
                          <p className="text-xs text-slate-400 mb-1">الرسائل المخصصة لفصولك.</p>
                          {myClasses.map(className => (
                            <div key={className} className="bg-slate-50/50 dark:bg-slate-900/20 p-3 rounded-2xl border border-slate-100 dark:border-slate-800/40">
                              <label className="block text-slate-600 dark:text-slate-350 text-xs font-bold mb-1">
                                {className}
                              </label>
                              <textarea
                                rows={2}
                                className="w-full p-3 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-[#271e48] rounded-xl text-sm font-medium resize-none leading-relaxed"
                                value={settings.classBirthdayMessages?.[className] || ''}
                                onChange={(e) => {
                                  const classMsg = e.target.value;
                                  setSettings(prev => ({
                                    ...prev,
                                    classBirthdayMessages: {
                                      ...prev.classBirthdayMessages,
                                      [className]: classMsg
                                    }
                                  }));
                                }}
                                disabled={!settings.birthdayEnabled}
                                placeholder="اكتب رسالة التهنئة المخصصة لهذا الفصل... (اتركها فارغة لاستخدام الرسالة العامة)"
                              />
                            </div>
                          ))}
                          {myClasses.length === 0 && (
                            <p className="text-sm text-slate-400 text-center py-4 font-bold">لا يوجد فصول مسندة إليك حالياً لتعديل رسائلها.</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                  <button
                    onClick={handleSaveSettings}
                    disabled={savingSettings}
                    className="flex items-center gap-2 bg-[#271e48] hover:bg-[#34275e] text-white px-6 py-3 rounded-xl font-bold text-base shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    {savingSettings ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                    <span>حفظ الإعدادات</span>
                  </button>
                </div>
              </div>
            </div>
            )
          )}

          {/* TAB 2: Manual Notification Sender */}
          {activeSubTab === 'send' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Form Input fields */}
              <div className="lg:col-span-2 bg-white dark:bg-[#1e293b] p-6 rounded-3xl shadow-md border border-slate-100 dark:border-slate-800 transition-colors duration-300 flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex items-center gap-2 pb-3 border-b border-slate-150 dark:border-slate-800">
                    <Send size={18} className="text-teal-500" />
                    <h3 className="font-black text-lg text-slate-800 dark:text-white">تفاصيل الإشعار</h3>
                  </div>

                  {/* Target Audience Filters */}
                  <div className="space-y-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                    {/* Target Type Selector */}
                    {(isGeneralAdmin || isStageServant) && (
                      <div>
                        <label className="block text-slate-500 dark:text-white text-sm font-bold mb-1.5 font-sans">فئة المستلمين المستهدفة</label>
                        <select
                          className="w-full py-2.5 px-4 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-[#271e48] rounded-xl text-sm font-bold cursor-pointer"
                          value={gaTargetType}
                          onChange={(e) => {
                            setGaTargetType(e.target.value);
                            setGaServantFilter('all');
                            setGaStudentFilter('all');
                          }}
                        >
                          <option value="servants">الخدام فقط 🧑‍🏫</option>
                          <option value="students">المخدومين فقط 👶</option>
                          <option value="both">الكل (خدام ومخدومين) 👥</option>
                        </select>
                      </div>
                    )}

                    {/* Servants Filter Section */}
                    {(isGeneralAdmin || isStageServant) && (gaTargetType === 'servants' || gaTargetType === 'both') && (
                      <div className="p-3 bg-indigo-50/50 dark:bg-indigo-950/20 rounded-2xl border border-indigo-100/50 dark:border-indigo-900/30 space-y-2">
                        <label className="block text-indigo-700 dark:text-indigo-455 text-xs font-black">تحديد الخدام المستهدفين</label>
                        <select
                          className="w-full py-2 px-3 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-1 focus:ring-[#271e48] rounded-lg text-sm cursor-pointer"
                          value={gaServantFilter}
                          onChange={(e) => setGaServantFilter(e.target.value)}
                        >
                          <option value="all">{isGeneralAdmin ? 'كل الخدام' : 'كل خدام المرحلة'}</option>
                          {isGeneralAdmin && <option value="stageAdmins">أمناء المراحل فقط</option>}
                          {isGeneralAdmin && <option value="classServants">خدام الفصول فقط</option>}
                          <option value="specificClass">{isGeneralAdmin ? 'خدام فصل معين' : 'خدام فصل معين بالمرحلة'}</option>
                        </select>

                        {gaServantFilter === 'specificClass' && (
                          <select
                            className="w-full py-2 px-3 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-1 focus:ring-[#271e48] rounded-lg text-sm mt-2 cursor-pointer font-bold text-slate-700 dark:text-slate-350"
                            value={gaServantClass}
                            onChange={(e) => setGaServantClass(e.target.value)}
                          >
                            <option value="">اختر الفصل...</option>
                            {(isGeneralAdmin ? ALL_CLASSES : myClasses).map(cls => (
                              <option key={cls} value={cls}>{cls}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}

                    {/* Students Filter Section */}
                    {(gaTargetType === 'students' || gaTargetType === 'both') && (
                      <div className="p-3 bg-teal-50/50 dark:bg-teal-950/20 rounded-2xl border border-teal-100/50 dark:border-teal-900/30 space-y-2">
                        <label className="block text-teal-700 dark:text-teal-450 text-xs font-black">تحديد المخدومين المستهدفين</label>
                        <select
                          className="w-full py-2 px-3 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-1 focus:ring-[#271e48] rounded-lg text-sm cursor-pointer mb-2"
                          value={gaStudentFilter}
                          onChange={(e) => setGaStudentFilter(e.target.value)}
                        >
                          <option value="all">كل المخدومين</option>
                          <option value="specificStage">مراحل وفصول معينة</option>
                        </select>

                        {gaStudentFilter === 'specificStage' && (
                          <div className="space-y-3 pt-2">
                            {/* Stage Checkboxes */}
                            <div>
                              <span className="block text-xs text-white font-bold mb-1.5">اختر المراحل المستهدفة:</span>
                              <div className="flex flex-wrap gap-3">
                                {['ابتدائي', 'اعدادي', 'ثانوي'].map(stg => {
                                  const isDisabled = !isGeneralAdmin && stg !== myStage;
                                  const isChecked = gaStudentStages.includes(stg);
                                  
                                  if (isDisabled && !isGeneralAdmin) return null;
                                  
                                  return (
                                    <label key={stg} className="flex items-center gap-1.5 text-sm font-bold text-slate-700 dark:text-white cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        disabled={isDisabled}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setGaStudentStages(prev => [...prev, stg]);
                                            const stageClasses = STAGE_CLASSES[stg] || [];
                                            const allowedStageClasses = isGeneralAdmin 
                                              ? stageClasses 
                                              : stageClasses.filter(c => myClasses.includes(c));
                                            setGaStudentClasses(prev => [...new Set([...prev, ...allowedStageClasses])]);
                                          } else {
                                            setGaStudentStages(prev => prev.filter(s => s !== stg));
                                            const stageClasses = STAGE_CLASSES[stg] || [];
                                            setGaStudentClasses(prev => prev.filter(c => !stageClasses.includes(c)));
                                          }
                                        }}
                                        className="rounded text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
                                      />
                                      <span>{stg}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Class Checkboxes for selected stages */}
                            {gaStudentStages.length > 0 && (
                              <div className="pt-2 border-t border-slate-100 dark:border-slate-800/60">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="block text-xs text-white font-bold">اختر الفصول المستهدفة:</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const allSelectedClasses = gaStudentStages.flatMap(stg => {
                                        const classes = STAGE_CLASSES[stg] || [];
                                        return isGeneralAdmin ? classes : classes.filter(c => myClasses.includes(c));
                                      });
                                      
                                      const isAllChecked = allSelectedClasses.every(c => gaStudentClasses.includes(c));
                                      if (isAllChecked) {
                                        setGaStudentClasses(prev => prev.filter(c => !allSelectedClasses.includes(c)));
                                      } else {
                                        setGaStudentClasses(prev => [...new Set([...prev, ...allSelectedClasses])]);
                                      }
                                    }}
                                    className="text-xs text-teal-600 dark:text-teal-400 font-black hover:underline cursor-pointer border-none bg-transparent"
                                  >
                                    {gaStudentStages.flatMap(stg => {
                                      const classes = STAGE_CLASSES[stg] || [];
                                      return isGeneralAdmin ? classes : classes.filter(c => myClasses.includes(c));
                                    }).every(c => gaStudentClasses.includes(c)) ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
                                  </button>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-[#0f172a]/50 p-2.5 rounded-xl max-h-40 overflow-y-auto border border-slate-150 dark:border-slate-800/40">
                                  {gaStudentStages.map(stg => {
                                    const stageClasses = STAGE_CLASSES[stg] || [];
                                    const filteredClasses = isGeneralAdmin 
                                      ? stageClasses 
                                      : stageClasses.filter(c => myClasses.includes(c));
                                      
                                    return filteredClasses.map(cls => {
                                      const isChecked = gaStudentClasses.includes(cls);
                                      return (
                                        <label key={cls} className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-white cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={(e) => {
                                              if (e.target.checked) {
                                                setGaStudentClasses(prev => [...prev, cls]);
                                              } else {
                                                setGaStudentClasses(prev => prev.filter(c => c !== cls));
                                              }
                                            }}
                                            className="rounded text-teal-600 focus:ring-teal-500 w-3 h-3"
                                          />
                                          <span className="truncate">{cls}</span>
                                        </label>
                                      );
                                    });
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Daily Attendance Filter */}
                        <div className="p-3 bg-amber-50/40 dark:bg-amber-950/10 rounded-2xl border border-amber-100/50 dark:border-amber-900/30 space-y-2 mt-2">
                          <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-black text-amber-700 dark:text-amber-400">
                            <input
                              type="checkbox"
                              className="w-3.5 h-3.5 rounded text-amber-600 border-slate-350 focus:ring-amber-500"
                              checked={enableAttendanceFilter}
                              onChange={(e) => setEnableAttendanceFilter(e.target.checked)}
                            />
                            <span>تصفية المستهدفين بناءً على الحضور والغياب اليوم 📝</span>
                          </label>
                          
                          {enableAttendanceFilter && (
                            <select
                              className="w-full py-2 px-3 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-1 focus:ring-amber-500 rounded-lg text-sm cursor-pointer mt-1 font-bold"
                              value={attendanceFilterType}
                              onChange={(e) => setAttendanceFilterType(e.target.value)}
                            >
                              <option value="attendedService">الذين حضروا الخدمة اليوم 🟢</option>
                              <option value="notAttendedService">الذين غابوا عن الخدمة اليوم 🔴</option>
                              <option value="attendedLiturgy">الذين حضروا القداس اليوم ⛪</option>
                              <option value="notAttendedLiturgy">الذين غابوا عن القداس اليوم ⚠️</option>
                            </select>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Periodic Checkbox Toggle */}
                  <div className="p-3 bg-slate-50 dark:bg-[#0f172a] rounded-2xl border border-slate-150 dark:border-slate-800 space-y-3">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded text-teal-600 border-slate-350 focus:ring-teal-500 dark:border-slate-700"
                        checked={isPeriodic}
                        onChange={(e) => {
                          setIsPeriodic(e.target.checked);
                          if (e.target.checked && alertDays.length === 0) {
                            setAlertDays(['الجمعة']); // default day
                          }
                        }}
                      />
                      <span className="text-sm font-black text-slate-700 dark:text-white">جعل هذا الإشعار دورياً ومجدولاً ⏰</span>
                    </label>

                    {isPeriodic && (
                      <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800 animate-in fade-in duration-200">
                        {/* Day Selector */}
                        <div>
                          <label className="block text-slate-500 dark:text-white text-xs font-bold mb-1.5">أيام الإرسال الدورية:</label>
                          <div className="grid grid-cols-4 gap-2">
                            {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map(day => {
                              const isChecked = alertDays.includes(day);
                              return (
                                <label key={day} className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-white cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setAlertDays(prev => [...prev, day]);
                                      } else {
                                        setAlertDays(prev => prev.filter(d => d !== day));
                                      }
                                    }}
                                    className="rounded text-teal-650 focus:ring-teal-500 w-3.5 h-3.5"
                                  />
                                  <span>{day}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        {/* Time Selector */}
                        <div>
                          <label className="block text-slate-500 dark:text-white text-xs font-bold mb-1.5">وقت الإرسال الدقيق:</label>
                          <input 
                            type="time" 
                            className="w-full py-2 px-3 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-whit focus:ring-2 focus:ring-teal-500 rounded-lg text-sm font-bold"
                            value={alertTime}
                            onChange={(e) => setAlertTime(e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                  </div>


                  <div>
                    <label className="block text-slate-500 dark:text-white text-sm font-bold mb-1.5">عنوان الرساله</label>
                    <input 
                      type="text" 
                      placeholder="نص عنوان الرساله"
                      className="w-full py-2.5 px-4 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-[#271e48] rounded-xl text-base font-bold"
                      value={manualTitle}
                      onChange={(e) => setManualTitle(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="block text-slate-500 dark:text-white text-sm font-bold mb-1.5">محتوى الرسالة</label>
                    <textarea
                      rows={6}
                      placeholder="اكتب هنا نص الرسالة التفصيلي الذي ترغب في إرساله..."
                      className="w-full p-4 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-[#271e48] rounded-xl text-base font-medium resize-none leading-relaxed"
                      value={manualBody}
                      onChange={(e) => setManualBody(e.target.value)}
                    />
                  </div>

                  {/* Target summary helper */}
                  <div className="p-3 bg-slate-50 dark:bg-[#0f172a] rounded-xl border border-slate-100 dark:border-slate-800">
                    <span className="text-xs text-slate-400 block mb-1">المستهدفون بالنظام الحالي:</span>
                    <span className="text-sm font-bold text-teal-600 dark:text-teal-400">
                      الترشيح المختار ({recipientsList.length} مستهدف)
                    </span>
                  </div>
                </div>

                <button
                  onClick={isPeriodic ? handleCreateNewPeriodicAlert : handleSendNotification}
                  disabled={isPeriodic ? (savingSettings || sendingNotification) : (sendingNotification || savingSettings)}
                  className="mt-6 w-full flex items-center justify-center gap-2 bg-gradient-to-l from-blue-600 to-teal-500 hover:from-blue-700 hover:to-teal-600 text-white py-3.5 rounded-xl font-black text-base shadow-md hover:shadow-lg transition-all active:scale-95 disabled:opacity-50 cursor-pointer border-none"
                >
                  {isPeriodic ? (
                    savingSettings ? <Loader2 className="animate-spin" size={18} /> : <CalendarDays size={18} />
                  ) : (
                    sendingNotification ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />
                  )}
                  <span>
                    {isPeriodic 
                      ? `حفظ كإشعار دوري جديد ⏰ (${selectedRecipients.length} مستلم)` 
                      : `بث الإشعار الآن 📣 (${selectedRecipients.length} مستلم)`
                    }
                  </span>
                </button>
              </div>

              {/* Recipients List Selection */}
              <div className="lg:col-span-1 bg-white dark:bg-[#1e293b] p-6 rounded-3xl shadow-md border border-slate-100 dark:border-slate-800 transition-colors duration-300 flex flex-col">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-150 dark:border-slate-800 mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400 rounded-xl">
                      {isGeneralAdmin || isStageServant ? <UserCheck size={20} /> : <Users size={20} />}
                    </div>
                    <div>
                      <h3 className="font-black text-base text-slate-800 dark:text-white">قائمة المستلمين</h3>
                      <p className="text-xs text-slate-400">حدد الأشخاص الذين سيتم إرسال هذا الإشعار إليهم.</p>
                    </div>
                  </div>

                  {/* Search box */}
                  <div className="relative max-w-xs w-full">
                    <span className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-slate-400">
                      <Search size={16} />
                    </span>
                    <input
                      type="text"
                      placeholder="ابحث بالاسم..."
                      className="w-full py-2 pl-3 pr-9 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-white border border-slate-200 dark:border-slate-800 focus:ring-1 focus:ring-teal-500 rounded-xl text-sm font-bold"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>

                {loadingRecipients ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-12 gap-3 text-slate-400">
                    <Loader2 className="animate-spin text-teal-500" size={28} />
                    <span className="text-xs font-bold">جاري تحميل قائمة الأشخاص من قاعدة البيانات...</span>
                  </div>
                ) : (
                  <>
                    {/* Header: Select All */}
                    <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-[#0f172a] rounded-xl border border-slate-100 dark:border-slate-800 mb-3">
                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded text-teal-600 border-slate-350 focus:ring-teal-500 dark:border-slate-700"
                          checked={filteredRecipients.length > 0 && selectedRecipients.length === filteredRecipients.length}
                          onChange={(e) => handleSelectAll(e.target.checked)}
                          disabled={filteredRecipients.length === 0}
                        />
                        <span className="text-xs font-black text-slate-700 dark:text-slate-300">تحديد الكل ({filteredRecipients.length})</span>
                      </label>
                      <span className="text-xs text-slate-450 dark:text-slate-400">محدد حالياً: {selectedRecipients.length} مستلم</span>
                    </div>

                    {/* Checkbox Grid */}
                    <div className="flex-1 max-h-[350px] overflow-y-auto pr-1 space-y-2">
                      {filteredRecipients.length === 0 ? (
                        <div className="text-center py-12 text-slate-450 dark:text-slate-500 text-xs">
                          لا توجد نتائج مطابقة لبحثك في النطاق المسموح.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-2">
                          {filteredRecipients.map((person) => {
                            const isChecked = selectedRecipients.includes(person.id);
                            return (
                              <div 
                                key={person.id}
                                onClick={() => {
                                  if (isChecked) {
                                    setSelectedRecipients(prev => prev.filter(id => id !== person.id));
                                  } else {
                                    setSelectedRecipients(prev => [...prev, person.id]);
                                  }
                                }}
                                className={`p-3 rounded-xl border transition-all duration-200 cursor-pointer flex items-center justify-between ${
                                  isChecked 
                                    ? 'bg-teal-500/10 border-teal-500 text-teal-700 dark:text-teal-400' 
                                    : 'bg-white dark:bg-[#0f172a]/40 border-slate-100 dark:border-slate-800/80 hover:border-slate-200 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all ${
                                    isChecked 
                                      ? 'bg-teal-500 border-teal-500 text-white' 
                                      : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0f172a]'
                                  }`}>
                                    {isChecked && <Check size={10} strokeWidth={4} />}
                                  </div>
                                  <div className="text-right">
                                    <p className="text-sm font-bold leading-tight">{person.name}</p>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                      {person.role 
                                        ? `${person.role}` 
                                        : (person.assignedClass ? `مخدوم: ${person.assignedClass}` : 'مخدوم مجهول الفصل')}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: History logs */}
          {activeSubTab === 'history' && (
            <div className="bg-white dark:bg-[#1e293b] p-6 rounded-3xl shadow-md border border-slate-100 dark:border-slate-800 transition-colors duration-300">
              <div className="flex items-center gap-2.5 pb-4 border-b border-slate-150 dark:border-slate-800 mb-6">
                <div className="p-2 bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 rounded-xl">
                  <History size={20} />
                </div>
                <div>
                  <h3 className="font-black text-lg text-[#271e48] dark:text-white">سجل بث الإشعارات اليدوية</h3>
                  <p className="text-xs text-slate-400">قائمة بالإشعارات الأخيرة التي تم إرسالها من قبلك أو من الأمين العام.</p>
                </div>
              </div>

              {visibleHistoryList.length === 0 ? (
                <div className="text-center py-16 text-slate-400 dark:text-slate-500 text-sm">
                  لا توجد سجلات للإشعارات المرسلة حتى الآن.
                </div>
              ) : (
                <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
                  {visibleHistoryList.map((log) => (
                    <div 
                      key={log.id}
                      className="p-5 rounded-2xl bg-slate-50 dark:bg-[#0f172a]/30 border border-slate-100 dark:border-slate-800/80 flex flex-col md:flex-row md:items-start justify-between gap-4 transition-all duration-300 hover:shadow-sm"
                    >
                      <div className="space-y-2 text-right">
                        <div className="flex flex-wrap items-center gap-2">
                          {log.publishAt && log.publishAt > new Date() ? (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-white flex items-center gap-1">
                              مجدول ⏳ {log.publishAt.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-600 text-white">
                              تم البث 📣
                            </span>
                          )}
                          <span className="text-xs text-slate-450 dark:text-slate-400">
                            أنشئ في: {log.createdAt.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' })}
                          </span>
                        </div>
                        <h4 className="font-black text-l text-[#271e48] dark:text-white">{log.title}</h4>
                        <p className="text-lg text-slate-600 dark:text-white leading-relaxed max-w-2xl">{log.body}</p>
                      </div>

                      <div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-start gap-2 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800/50 shrink-0">
                        <div className="text-right">
                          <p className="text-[10px] text-slate-400">المرسل:</p>
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                            {log.senderName} ({log.senderRole})
                          </p>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="px-3 py-1 bg-teal-500/10 text-teal-600 dark:text-teal-400 rounded-lg text-xs font-bold">
                            
                          عدد المستلمين: {log.sentCount}
                          </div>
                          <button
                            onClick={() => handleDeleteSentNotification(log.id)}
                            className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-500 rounded-lg transition-colors cursor-pointer border-none bg-transparent flex items-center justify-center"
                            title="مسح الإشعار"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}