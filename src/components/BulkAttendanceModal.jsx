import { useState, useMemo, useEffect } from 'react';
import { db, doc, collection, writeBatch } from '../firebase';
import { 
  X, Search, CheckCircle, AlertTriangle, XCircle, Calendar, 
  Sparkles, Users, AlertCircle, Filter, BellOff
} from 'lucide-react';
import { 
  normalizeArabicAndCompound, 
  calculateNameMatchScore 
} from '../utils/arabicSearch';
import { isStoreVisibleForStudent } from '../utils/storeConfig';

const getSafeClassId = (cls) => {
  if (!cls) return 'default';
  return cls.trim().replace(/[\/\s]/g, '_');
};

export default function BulkAttendanceModal({
  isOpen,
  onClose,
  isLateMode = false,
  defaultDate = null,
  students = [],
  servant = null,
  attendanceConfigs = {},
  storeConfigs = [],
  onSuccess = () => {}
}) {
  // Step 1: Input text & parameters
  const [rawInputText, setRawInputText] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [dateErrorMsg, setDateErrorMsg] = useState('');
  
  // Scope filters
  const [stageFilter, setStageFilter] = useState('الكل');
  const [selectedClasses, setSelectedClasses] = useState([]); // Array of selected classes (empty = all)
  
  // Calculate if store/traits tab is visible for students in current scope
  const isStoreVisibleForCurrentScope = useMemo(() => {
    if (!students || students.length === 0) return true;
    
    const scopedStudents = students.filter(s => {
      const studentStage = s.stage || s.schoolGrade || '';
      if (stageFilter !== 'الكل' && normalizeArabicAndCompound(studentStage) !== normalizeArabicAndCompound(stageFilter)) {
        return false;
      }
      if (selectedClasses.length > 0 && !selectedClasses.includes(s.assignedClass)) {
        return false;
      }
      return true;
    });

    const targetList = scopedStudents.length > 0 ? scopedStudents : students;
    return targetList.some(s => isStoreVisibleForStudent(s, storeConfigs));
  }, [students, storeConfigs, stageFilter, selectedClasses]);

  // Options
  const [markService, setMarkService] = useState(true);
  const [markLiturgy, setMarkLiturgy] = useState(false);
  const [defaultPoints, setDefaultPoints] = useState(5);
  const [suppressNotifications, setSuppressNotifications] = useState(true);

  // Step 2: Matched analysis results
  const [analysisStep, setAnalysisStep] = useState(false); // false = input stage, true = review stage
  const [matchedItems, setMatchedItems] = useState([]); // Array of analyzed items
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState('');

  // Calculate recent Friday options for quick dropdown selection
  const recentFridayOptions = useMemo(() => {
    const fridays = [];
    const now = new Date();
    const currentDay = now.getDay();
    const daysSinceFriday = currentDay >= 5 ? currentDay - 5 : currentDay + 2;
    
    for (let i = 0; i < 8; i++) {
      const fDate = new Date(now);
      fDate.setDate(now.getDate() - daysSinceFriday - (i * 7));
      
      const yyyy = fDate.getFullYear();
      const mm = String(fDate.getMonth() + 1).padStart(2, '0');
      const dd = String(fDate.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      
      let label = '';
      if (i === 0) {
        label = currentDay === 5 ? `الجمعة اليوم (${dateStr})` : `الجمعة الماضية (${dateStr})`;
      } else if (i === 1) {
        label = `الجمعة قبل الماضية (${dateStr})`;
      } else {
        label = `الجمعة منذ ${i} أسابيع (${dateStr})`;
      }

      fridays.push({ dateStr, label });
    }
    return fridays;
  }, []);

  // Reset state when modal opens/closes & update defaultPoints dynamically
  useEffect(() => {
    if (!isOpen) {
      setRawInputText('');
      setAnalysisStep(false);
      setMatchedItems([]);
      setIsSubmitting(false);
      setSubmitProgress('');
      setDateErrorMsg('');
      setSelectedClasses([]);
    } else {
      setDefaultPoints(isStoreVisibleForCurrentScope ? 5 : 0);
      if (defaultDate) {
        setSelectedDate(defaultDate);
      } else {
        const now = new Date();
        const day = now.getDay();
        const diffToFriday = day >= 5 ? day - 5 : day + 2;
        const lastFriday = new Date(now);
        lastFriday.setDate(now.getDate() - diffToFriday);
        const yyyy = lastFriday.getFullYear();
        const mm = String(lastFriday.getMonth() + 1).padStart(2, '0');
        const dd = String(lastFriday.getDate()).padStart(2, '0');
        setSelectedDate(`${yyyy}-${mm}-${dd}`);
      }
    }
  }, [isOpen, isLateMode, defaultDate, isStoreVisibleForCurrentScope]);

  // Reset selected classes when stageFilter changes
  useEffect(() => {
    setSelectedClasses([]);
  }, [stageFilter]);

  // Available stages and classes from passed students list (checking both stage and schoolGrade)
  const availableStages = useMemo(() => {
    const stages = new Set();
    students.forEach(s => {
      const stg = s.stage || s.schoolGrade;
      if (stg) stages.add(stg.trim());
    });
    return Array.from(stages).sort();
  }, [students]);

  const availableClasses = useMemo(() => {
    const classes = new Set();
    students.forEach(s => {
      const studentStage = (s.stage || s.schoolGrade || '').trim();
      if (stageFilter === 'الكل' || studentStage === stageFilter.trim()) {
        if (s.assignedClass && s.assignedClass.trim()) {
          classes.add(s.assignedClass.trim());
        }
      }
    });
    return Array.from(classes).sort();
  }, [students, stageFilter]);

  // Candidates pool filtered by stage and multi-selected classes
  const candidateStudentsPool = useMemo(() => {
    return students.filter(s => {
      const studentStage = (s.stage || s.schoolGrade || '').trim();
      if (stageFilter !== 'الكل' && studentStage !== stageFilter.trim()) {
        return false;
      }
      if (selectedClasses.length > 0) {
        const studentClass = (s.assignedClass || '').trim();
        if (!selectedClasses.includes(studentClass)) {
          return false;
        }
      }
      return true;
    });
  }, [students, stageFilter, selectedClasses]);

  const toggleSelectClass = (clsName) => {
    setSelectedClasses(prev => {
      if (prev.includes(clsName)) {
        return prev.filter(c => c !== clsName);
      } else {
        return [...prev, clsName];
      }
    });
  };


  // Helper to extract student name and optional per-line traits/points written next to it (e.g. "ميخائيل ايهاب 10")
  const extractNameAndPoints = (rawLine) => {
    if (!rawLine) return { nameText: '', pointsOverride: null };

    // Convert Arabic-Indic digits ٠-٩ to English 0-9
    let normalized = rawLine.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

    // Trailing number e.g. "ميخائيل ايهاب 10" or "ميخائيل ايهاب +10" or "ميخائيل ايهاب (10)" or "ميخائيل ايهاب: 10"
    const trailingMatch = normalized.match(/^(.*?)(?:\s*[\(\[\:\-+]?\s*(\d+)\s*[\)\]]?)\s*$/);
    if (trailingMatch && trailingMatch[1].trim()) {
      const namePart = trailingMatch[1].replace(/[\(\[\:\-+]$/, '').trim();
      const pts = parseInt(trailingMatch[2], 10);
      if (namePart.length >= 2 && !isNaN(pts)) {
        return { nameText: namePart, pointsOverride: pts };
      }
    }

    // Leading number e.g. "10 ميخائيل ايهاب" or "+10 ميخائيل ايهاب"
    const leadingMatch = normalized.match(/^\s*([\+]?\d+)\s*[\)\[\:\-+ ]?\s*(.*)$/);
    if (leadingMatch && leadingMatch[2].trim()) {
      const pts = parseInt(leadingMatch[1], 10);
      const namePart = leadingMatch[2].replace(/^[\)\[\:\-+]/, '').trim();
      if (namePart.length >= 2 && !isNaN(pts)) {
        return { nameText: namePart, pointsOverride: pts };
      }
    }

    return { nameText: rawLine.trim(), pointsOverride: null };
  };

  // Analyze pasted names
  const handleAnalyzeNames = () => {
    if (!rawInputText.trim()) return;

    // 1. Split by newlines, commas, or semicolons & extract per-line custom points
    const parsedLines = rawInputText
      .split(/[\n,;،]/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => extractNameAndPoints(line));

    // 2. Deduplicate raw input text & keep track of per-line points overrides
    const lineFrequencyMap = new Map();
    parsedLines.forEach(item => {
      const norm = normalizeArabicAndCompound(item.nameText);
      if (!norm) return;
      if (!lineFrequencyMap.has(norm)) {
        lineFrequencyMap.set(norm, {
          rawText: item.nameText,
          freq: 1,
          pointsOverride: item.pointsOverride
        });
      } else {
        const existing = lineFrequencyMap.get(norm);
        existing.freq += 1;
        if (item.pointsOverride !== null) {
          existing.pointsOverride = item.pointsOverride;
        }
      }
    });

    const uniqueNorms = Array.from(lineFrequencyMap.keys());

    // 3. Score against candidate pool
    const results = uniqueNorms.map((inputNorm, idx) => {
      const entry = lineFrequencyMap.get(inputNorm);
      const rawText = entry.rawText;
      const freq = entry.freq;
      const pointsOverride = entry.pointsOverride;

      // Score all candidate students
      const scoredCandidates = candidateStudentsPool.map(student => {
        const score = calculateNameMatchScore(rawText, student.name);
        return { student, score };
      }).filter(c => c.score >= 40)
        .sort((a, b) => b.score - a.score);

      let status = 'UNRECOGNIZED';
      let selectedStudentId = null;
      let candidates = scoredCandidates.slice(0, 5).map(c => c.student);

      if (scoredCandidates.length === 1 && scoredCandidates[0].score >= 80) {
        status = 'MATCHED';
        selectedStudentId = scoredCandidates[0].student.id;
      } else if (scoredCandidates.length > 1 && scoredCandidates[0].score >= 80) {
        if (scoredCandidates[0].score - scoredCandidates[1].score >= 15) {
          status = 'MATCHED';
          selectedStudentId = scoredCandidates[0].student.id;
        } else {
          status = 'AMBIGUOUS';
          selectedStudentId = scoredCandidates[0].student.id;
        }
      }

      // Check if pre-selected student is ALREADY ATTENDED on selectedDate
      let isAlreadyAttended = false;
      if (selectedStudentId) {
        const st = students.find(s => s.id === selectedStudentId);
        if (st && Array.isArray(st.attendance) && st.attendance.includes(selectedDate)) {
          isAlreadyAttended = true;
        }
      }

      return {
        id: `item_${idx}`,
        rawText,
        frequency: freq,
        status, // 'MATCHED', 'AMBIGUOUS', 'UNRECOGNIZED'
        selectedStudentId,
        candidates,
        isAlreadyAttended,
        action: isAlreadyAttended ? 'skip' : 'mark', // 'mark', 'skip', 'traits_only'
        hasCustomLinePoints: pointsOverride !== null,
        customPoints: pointsOverride !== null ? pointsOverride : defaultPoints
      };
    });

    setMatchedItems(results);
    setAnalysisStep(true);
  };


  // Update a single item's selected student
  const handleSelectStudent = (itemId, studentId) => {
    setMatchedItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;

      const st = students.find(s => s.id === studentId);
      const isAlreadyAttended = st && Array.isArray(st.attendance) && st.attendance.includes(selectedDate);
      
      return {
        ...item,
        selectedStudentId: studentId,
        status: studentId ? (item.candidates.length > 1 ? 'AMBIGUOUS' : 'MATCHED') : 'UNRECOGNIZED',
        isAlreadyAttended,
        action: isAlreadyAttended ? 'skip' : 'mark'
      };
    }));
  };

  // Change action for an item (mark, skip, traits_only)
  const handleItemActionChange = (itemId, newAction) => {
    setMatchedItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      return { ...item, action: newAction };
    }));
  };

  // Change custom points for an item
  const handleCustomPointsChange = (itemId, points) => {
    setMatchedItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      return { ...item, customPoints: Math.max(0, Number(points) || 0) };
    }));
  };

  // Apply default points to all matched items
  const handleApplyGlobalPoints = (pts) => {
    setDefaultPoints(pts);
    setMatchedItems(prev => prev.map(item => ({
      ...item,
      customPoints: pts
    })));
  };

  // Bulk Submit to Firestore with Batch Chunking (Point 1 & Point 2)
  const handleSubmitBatch = async () => {
    const itemsToProcess = matchedItems.filter(item => 
      item.selectedStudentId && item.action !== 'skip'
    );

    if (itemsToProcess.length === 0) {
      alert('لم يتم اختيار أي مخدومين لتحضيرهم.');
      return;
    }

    setIsSubmitting(true);
    setSubmitProgress('جاري تحضير البيانات لعملية الحفظ الجماعي...');

    try {
      const servantName = servant?.name || 'الخادم';
      
      // Point 1: Chunking writes (max 40 students per batch chunk = ~120 ops per batch)
      const CHUNK_SIZE = 40;
      const totalChunks = Math.ceil(itemsToProcess.length / CHUNK_SIZE);
      const updatedStudentsList = [...students];

      for (let i = 0; i < totalChunks; i++) {
        const chunk = itemsToProcess.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        setSubmitProgress(`جاري حفظ الشريحة ${i + 1} من ${totalChunks} (${chunk.length} مخدوم)...`);

        const batch = writeBatch(db);

        for (const item of chunk) {
          const student = students.find(s => s.id === item.selectedStudentId);
          if (!student) continue;

          const studentRef = doc(db, 'students', student.id);
          const attendanceDocId = `${student.id}_${selectedDate}`;
          const attendanceRef = doc(db, 'attendance', attendanceDocId);
          const historyRef = doc(collection(db, 'pointsHistory'));

          const pointsToAdd = Number(item.customPoints || 0);
          const currentAttendance = student.attendance || [];
          const currentLiturgy = student.liturgyAttendance || [];

          let newAttendance = currentAttendance;
          if (item.action === 'mark' && !currentAttendance.includes(selectedDate)) {
            newAttendance = [...currentAttendance, selectedDate];
          }

          let newLiturgy = currentLiturgy;
          if (item.action === 'mark' && markLiturgy && !currentLiturgy.includes(selectedDate)) {
            newLiturgy = [...currentLiturgy, selectedDate];
          }

          const newPoints = (student.points || 0) + pointsToAdd;

          // Streak logic
          const safeClassId = student.assignedClass ? getSafeClassId(student.assignedClass) : '';
          const consecutiveGiftEnabled = !!attendanceConfigs[safeClassId]?.consecutiveGiftEnabled;
          let newStreak = student.attendanceStreak || 0;
          let newGifts = student.pendingGifts || 0;

          if (consecutiveGiftEnabled && item.action === 'mark' && !currentAttendance.includes(selectedDate)) {
            newStreak += 1;
            if (newStreak > 0 && newStreak % 4 === 0) {
              newGifts += 1;
            }
          }

          // 1. Update Student document
          const studentUpdates = {
            attendance: newAttendance,
            liturgyAttendance: newLiturgy,
            points: newPoints
          };
          if (consecutiveGiftEnabled && item.action === 'mark') {
            studentUpdates.attendanceStreak = newStreak;
            studentUpdates.pendingGifts = newGifts;
          }
          batch.update(studentRef, studentUpdates);

          // 2. Set Attendance Record document (Point 2: attendanceDate vs createdAt)
          if (item.action === 'mark') {
            batch.set(attendanceRef, {
              studentId: student.id,
              studentName: student.name,
              assignedClass: student.assignedClass || '',
              stage: student.stage || '',
              servantName,
              date: selectedDate, // attendanceDate
              attendedService: markService,
              attendedLiturgy: markLiturgy,
              pointsAdded: pointsToAdd,
              isLateAttendance: isLateMode,
              createdAt: new Date() // system timestamp
            }, { merge: true });
          }

          // 3. Set Points History document (Point 2: createdAt vs attendanceDate)
          if (pointsToAdd > 0) {
            batch.set(historyRef, {
              studentId: student.id,
              studentName: student.name,
              amount: pointsToAdd,
              points: pointsToAdd,
              reason: isLateMode 
                ? `تسجيل حضور متأخر (${selectedDate}) بواسطة (${servantName})`
                : `حضور يوم الجمعة (${servantName})`,
              attendanceDate: selectedDate,
              createdAt: new Date(), // system timestamp
              suppressNotifications: suppressNotifications // Point 4: Notification suppression flag
            });
          }

          // Update local memory list optimistically
          const idx = updatedStudentsList.findIndex(s => s.id === student.id);
          if (idx !== -1) {
            updatedStudentsList[idx] = {
              ...updatedStudentsList[idx],
              attendance: newAttendance,
              liturgyAttendance: newLiturgy,
              points: newPoints,
              attendanceStreak: newStreak,
              pendingGifts: newGifts
            };
          }
        }

        // Commit chunk batch
        await batch.commit();
      }

      setSubmitProgress('تم الحفظ بنجاح! 🚀');
      onSuccess(updatedStudentsList);
      onClose();
    } catch (error) {
      console.error('Error committing bulk attendance batch:', error);
      alert(error.message || 'حدث خطأ أثناء إجراء التسجيل الجماعي');
    } finally {
      setIsSubmitting(false);
      setSubmitProgress('');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white dark:bg-[#1e293b] w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden my-6">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0f172a]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600/10 text-blue-600 dark:text-blue-400 rounded-xl">
              <Sparkles size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                تسجيل دفعة واحدة ذكي 🚀
                {isLateMode && (
                  <span className="text-xs px-2.5 py-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-full font-bold">
                    حضور متأخر
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                إلصاق قائمة الأسماء للمطابقة الفورية، معالجة التكرارات، وتحديد الصفات بسهولة.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          
          {/* STEP 1: INPUT & CONFIGURATION */}
          {!analysisStep ? (
            <>
              {/* Target Date & Scope Filters */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                
                {/* Date Selection (Friday Only Dropdown) */}
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1.5">
                    <Calendar size={14} className="text-blue-500" />
                    تاريخ الجمعة للحضور:
                  </label>
                  <select
                    value={recentFridayOptions.some(f => f.dateStr === selectedDate) ? selectedDate : (selectedDate ? 'custom' : '')}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val !== 'custom') {
                        setSelectedDate(val);
                        setDateErrorMsg('');
                      }
                    }}
                    className="w-full p-2.5 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 text-sm cursor-pointer"
                  >
                    {recentFridayOptions.map(f => (
                      <option key={f.dateStr} value={f.dateStr}>
                        {f.label}
                      </option>
                    ))}
                    <option value="custom">📅 تاريخ آخر من التقويم...</option>
                  </select>

                  {!recentFridayOptions.some(f => f.dateStr === selectedDate) && (
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSelectedDate(val);
                        if (val) {
                          const d = new Date(val);
                          if (d.getDay() !== 5) {
                            setDateErrorMsg('تنبيه: يجب اختيار يوم جمعة فقط ⚠️');
                          } else {
                            setDateErrorMsg('');
                          }
                        }
                      }}
                      className="mt-2 w-full p-2 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold"
                    />
                  )}
                  {dateErrorMsg && (
                    <div className="mt-1 text-[11px] font-bold text-rose-500 flex items-center gap-1">
                      <AlertTriangle size={12} />
                      <span>{dateErrorMsg}</span>
                    </div>
                  )}
                </div>


                {/* Stage Filter */}
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1.5">
                    <Filter size={14} className="text-blue-500" />
                    المرحلة المستهدفة:
                  </label>
                  <select
                    value={stageFilter}
                    onChange={(e) => setStageFilter(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 text-sm cursor-pointer"
                  >
                    <option value="الكل">كل المراحل ({students.length})</option>
                    {availableStages.map(st => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </div>

                {/* Multi-Class Selection */}
                <div className="sm:col-span-1">
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400">
                      الفصول المستهدفة:
                    </label>
                    <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400">
                      ({candidateStudentsPool.length} مخدوم)
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1 bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setSelectedClasses([])}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        selectedClasses.length === 0
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                      }`}
                    >
                      كل الفصول
                    </button>
                    {availableClasses.map(cls => {
                      const isSelected = selectedClasses.includes(cls);
                      return (
                        <button
                          key={cls}
                          type="button"
                          onClick={() => toggleSelectClass(cls)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                            isSelected
                              ? 'bg-blue-600 text-white shadow-xs'
                              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                          }`}
                        >
                          {isSelected ? '✓ ' : '+ '}
                          {cls}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>


              {/* Raw Text Input */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Users size={16} className="text-blue-500" />
                    أدخل أو الصق قائمة أسماء المخدومين:
                  </label>
                  <span className="text-xs text-slate-400 font-medium">
                    (يمكن كتابة رقم الصفات بجوار اسم المخدوم مثل: مينا جرجس 10)
                  </span>
                </div>
                <textarea
                  rows={8}
                  placeholder={`مثال:\nماريو عماد فايز\nبيشوي جرجس 10 (صفات خاصة للمخدوم)\nعبدالله كامل +15\nمينا أشرف`}
                  value={rawInputText}
                  onChange={(e) => setRawInputText(e.target.value)}
                  className="w-full p-4 bg-slate-50 dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-2xl font-mono text-sm leading-relaxed outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                />
              </div>


              {/* Attendance & Traits Options */}
              <div className="p-4 bg-blue-50/50 dark:bg-blue-900/10 rounded-2xl border border-blue-100 dark:border-blue-800/30 space-y-3">
                <h4 className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider">
                  خيارات الحضور والصفات المبدئية:
                </h4>
                <div className="flex flex-wrap gap-4 items-center">
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-xs text-slate-700 dark:text-slate-300 select-none">
                    <input
                      type="checkbox"
                      checked={markService}
                      onChange={(e) => setMarkService(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                    />
                    تسجيل حضور الخدمة ⛪
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer font-bold text-xs text-slate-700 dark:text-slate-300 select-none">
                    <input
                      type="checkbox"
                      checked={markLiturgy}
                      onChange={(e) => setMarkLiturgy(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                    />
                    تسجيل حضور القداس 🕊️
                  </label>

                  <div className="flex items-center gap-2 mr-auto">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-400">
                      الصفات المضافة للكل:
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={defaultPoints}
                      onChange={(e) => setDefaultPoints(Math.max(0, Number(e.target.value) || 0))}
                      className="w-16 p-1.5 text-center bg-white dark:bg-[#1e293b] border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold"
                    />
                    <span className="text-xs text-slate-500">صفة</span>
                  </div>
                </div>

                {/* Point 4: Notification suppression checkbox */}
                <div className="pt-2 border-t border-blue-200/50 dark:border-blue-800/30">
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-xs text-slate-600 dark:text-slate-400 select-none">
                    <input
                      type="checkbox"
                      checked={suppressNotifications}
                      onChange={(e) => setSuppressNotifications(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                    />
                    <BellOff size={14} className="text-slate-500" />
                    عدم إرسال إشعارات FCM/واتساب لهذه الدفعة (مُوصى به لتقليل الضغط) ⚡
                  </label>
                </div>
              </div>
            </>
          ) : (

            /* STEP 2: REVIEW AND MATCH ANALYSIS */
            <>
              <div className="flex items-center justify-between bg-slate-100 dark:bg-slate-800 p-3 rounded-xl">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    التاريخ: <strong className="text-blue-600 dark:text-blue-400">{selectedDate}</strong>
                  </span>
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    إجمالي الأسماء المدخلة: <strong className="text-blue-600 dark:text-blue-400">{matchedItems.length}</strong>
                  </span>
                </div>
                <button
                  onClick={() => setAnalysisStep(false)}
                  className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  ✏️ تعديل القائمة والخيارات
                </button>
              </div>

              {/* Global Points Quick Changer */}
              <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/30 rounded-xl text-xs">
                <span className="font-bold text-blue-800 dark:text-blue-300">
                  تغيير عدد الصفات المضافة لجميع المقبولين دفعة واحدة:
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={defaultPoints}
                    onChange={(e) => handleApplyGlobalPoints(Math.max(0, Number(e.target.value) || 0))}
                    className="w-16 p-1.5 text-center bg-white dark:bg-[#1e293b] border border-blue-300 dark:border-blue-700 rounded-lg text-xs font-bold"
                  />
                  <span className="text-slate-500 font-bold">صفة</span>
                </div>
              </div>

              {/* Analysis Table */}
              <div className="space-y-3">
                {matchedItems.map((item, index) => {
                  return (
                    <div
                      key={item.id}
                      className={`p-4 rounded-xl border transition-all ${
                        item.action === 'skip'
                          ? 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 opacity-60'
                          : item.status === 'MATCHED' && !item.isAlreadyAttended
                          ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40'
                          : item.isAlreadyAttended
                          ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40'
                          : item.status === 'AMBIGUOUS'
                          ? 'bg-yellow-50/50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800/40'
                          : 'bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-800/40'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        
                        {/* Left: Input name & status badges */}
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-slate-400">#{index + 1}</span>
                            <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                              {item.rawText}
                            </span>
                            {item.frequency > 1 && (
                              <span className="text-[10px] px-2 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-full font-bold">
                                تكرر {item.frequency} مرات في النص
                              </span>
                            )}

                            {item.hasCustomLinePoints && (
                              <span className="text-[10px] px-2 py-0.5 bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 rounded-full font-bold">
                                ⚡ صفات خاصة: +{item.customPoints}
                              </span>
                            )}


                            {/* Status Badges */}
                            {item.status === 'MATCHED' && !item.isAlreadyAttended && (
                              <span className="text-[11px] px-2.5 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-full font-bold flex items-center gap-1">
                                <CheckCircle size={12} /> مطابقة مؤكدة
                              </span>
                            )}

                            {item.isAlreadyAttended && (
                              <span className="text-[11px] px-2.5 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-full font-bold flex items-center gap-1">
                                <AlertTriangle size={12} /> مُسجّل حضوره بالفعل في هذا التاريخ
                              </span>
                            )}

                            {item.status === 'AMBIGUOUS' && (
                              <span className="text-[11px] px-2.5 py-0.5 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20 rounded-full font-bold flex items-center gap-1">
                                <AlertCircle size={12} /> اسم متشابه / مكرر - يرجى التحديد
                              </span>
                            )}

                            {item.status === 'UNRECOGNIZED' && (
                              <span className="text-[11px] px-2.5 py-0.5 bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 rounded-full font-bold flex items-center gap-1">
                                <XCircle size={12} /> لم يتم التعرف عليه
                              </span>
                            )}
                          </div>

                          {/* Student Candidate Selector */}
                          <div className="pt-1">
                            {item.candidates.length > 0 ? (
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs text-slate-500 font-medium">المخدوم المطابق:</span>
                                <select
                                  value={item.selectedStudentId || ''}
                                  onChange={(e) => handleSelectStudent(item.id, e.target.value)}
                                  className="text-xs font-bold p-1.5 bg-white dark:bg-[#1e293b] border border-slate-300 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                  <option value="">-- اختار المخدوم المقصود --</option>
                                  {item.candidates.map(cand => (
                                    <option key={cand.id} value={cand.id}>
                                      {cand.name} ({cand.assignedClass || cand.stage || 'بدون فصل'})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-red-500 font-medium">
                                  ابحث يدوياً في الكشوف:
                                </span>
                                <select
                                  value={item.selectedStudentId || ''}
                                  onChange={(e) => handleSelectStudent(item.id, e.target.value)}
                                  className="text-xs font-bold p-1.5 bg-white dark:bg-[#1e293b] border border-red-300 dark:border-red-700 rounded-lg outline-none focus:ring-2 focus:ring-red-500 max-w-xs"
                                >
                                  <option value="">-- اختر مخدوم من القائمة --</option>
                                  {candidateStudentsPool.map(cand => (
                                    <option key={cand.id} value={cand.id}>
                                      {cand.name} ({cand.assignedClass || 'بدون فصل'})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Right: Actions & Custom Traits */}
                        {item.selectedStudentId && (
                          <div className="flex items-center gap-3 self-end sm:self-center">
                            
                            {/* Individual Custom Points Input */}
                            <div className="flex items-center gap-1.5 bg-white dark:bg-[#1e293b] p-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                              <span className="text-[11px] font-bold text-slate-500">صفات:</span>
                              <input
                                type="number"
                                min={0}
                                value={item.customPoints}
                                onChange={(e) => handleCustomPointsChange(item.id, e.target.value)}
                                className="w-12 p-1 text-center font-bold text-xs bg-slate-50 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700"
                              />
                            </div>

                            {/* Action selector (mark, skip, traits_only) */}
                            <select
                              value={item.action}
                              onChange={(e) => handleItemActionChange(item.id, e.target.value)}
                              className="text-xs font-bold p-2 bg-white dark:bg-[#1e293b] border border-slate-300 dark:border-slate-700 rounded-lg"
                            >
                              <option value="mark">تسجيل حضور + إضافة صفات ✅</option>
                              <option value="traits_only">إضافة صفات فقط (بدون حضور) 🌟</option>
                              <option value="skip">تجاوز واستبعاد ❌</option>
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

        </div>

        {/* Modal Footer */}
        <div className="p-5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0f172a] flex flex-col sm:flex-row items-center justify-between gap-3">
          {submitProgress && (
            <div className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              {submitProgress}
            </div>
          )}

          <div className="flex items-center gap-3 mr-auto w-full sm:w-auto justify-end">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="py-2.5 px-5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-sm transition-colors cursor-pointer"
            >
              إلغاء
            </button>

            {!analysisStep ? (
              <button
                onClick={handleAnalyzeNames}
                disabled={!rawInputText.trim()}
                className="py-2.5 px-6 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition-all shadow-md shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
              >
                <Search size={16} />
                تحليل القائمة والمطابقة 🔍
              </button>
            ) : (
              <button
                onClick={handleSubmitBatch}
                disabled={isSubmitting || matchedItems.filter(i => i.selectedStudentId && i.action !== 'skip').length === 0}
                className="py-2.5 px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm transition-all shadow-md shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
              >
                <CheckCircle size={16} />
                تأكيد وتنفيد تسجيل الحضور الجماعي ({matchedItems.filter(i => i.selectedStudentId && i.action !== 'skip').length}) 🚀
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
