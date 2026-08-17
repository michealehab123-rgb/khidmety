import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  db, collection, query, where, getDocs, doc,
  getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp, increment,
  deleteField, writeBatch
} from '../firebase';
import {
  BookOpen, ChevronDown, ChevronUp, CheckCircle2, Clock, User,
  AlertTriangle, RefreshCw, Search, Check, Edit3, Info, X,
  BookMarked, Church, Scroll, BookHeart, RotateCcw, Trash2
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const STAGE_CLASS_MAP = {
  'ابتدائي': [
    'حضانة/ملائكة',
    'أولى ابتدائى',
    'ثانية ابتدائى',
    'ثالثة ابتدائى',
    'رابعة ابتدائى',
    'خامسة ابتدائى',
    'سادسة ابتدائي',
  ],
  'اعدادي': ['اولي اعدادي', 'تانيه اعدادي', 'تالته اعدادي'],
  'ثانوي':  ['اولي ثانوي', 'تانيه ثانوي', 'تالته ثانوي'],
};

const READINGS = [
  { key: 'boulos',    label: 'البولس',       icon: BookMarked,  color: 'blue'   },
  { key: 'kathoikon', label: 'الكاثيوليكون', icon: Scroll,      color: 'purple' },
  { key: 'abraxes',   label: 'الإبركسيس',   icon: BookHeart,   color: 'emerald' },
  { key: 'gospel',    label: 'الإنجيل',     icon: Church,      color: 'amber'  },
];

const COLOR_MAP = {
  blue:    { bg: 'bg-blue-50 dark:bg-blue-950/30',    border: 'border-blue-200 dark:border-blue-800',    badge: 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300',   icon: 'text-blue-600 dark:text-blue-400',   btn: 'bg-blue-600 hover:bg-blue-700' },
  purple:  { bg: 'bg-purple-50 dark:bg-purple-950/30', border: 'border-purple-200 dark:border-purple-800', badge: 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300', icon: 'text-purple-600 dark:text-purple-400', btn: 'bg-purple-600 hover:bg-purple-700' },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800', badge: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300', icon: 'text-emerald-600 dark:text-emerald-400', btn: 'bg-emerald-600 hover:bg-emerald-700' },
  amber:   { bg: 'bg-amber-50 dark:bg-amber-950/30',   border: 'border-amber-200 dark:border-amber-800',   badge: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300',  icon: 'text-amber-600 dark:text-amber-400',  btn: 'bg-amber-600 hover:bg-amber-700' },
};

// Helper — normalize student stage
function getStudentStage(student) {
  if (!student) return '';
  const raw = (student.stage || student.assignedStage || student.schoolGrade || student.assignedClass || '').toString();
  const norm = normalizeArabic(raw);
  if (norm.includes('ابتداي') || norm.includes('حضانه') || norm.includes('ملائكه')) return 'ابتدائي';
  if (norm.includes('اعدادي') || norm.includes('اعدادى')) return 'اعدادي';
  if (norm.includes('ثانوي') || norm.includes('ثانوى')) return 'ثانوي';
  return raw;
}

// ─────────────────────────────────────────────────────────────
// Helper — Friday logic
// ─────────────────────────────────────────────────────────────

/** Get all Fridays of a given month */
function getFridaysOfMonth(year, month) {
  const fridays = [];
  const d = new Date(year, month, 1);
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  while (d.getMonth() === month) {
    fridays.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return fridays;
}

/** Determine stage for a given Friday date */
function getStageForFriday(friday) {
  const year  = friday.getFullYear();
  const month = friday.getMonth();
  const fridays = getFridaysOfMonth(year, month);
  const total   = fridays.length;

  const idx = fridays.findIndex(f => f.toDateString() === friday.toDateString());
  if (idx === -1) return 'ثانوي';

  // First Friday → ثانوي
  if (idx === 0) return 'ثانوي';
  // Last Friday → اعدادي
  if (idx === total - 1) return 'اعدادي';
  // The one just before last, if total === 5 → ابتدائي
  if (total === 5 && idx === 3) return 'ابتدائي';
  // All others in middle → ابتدائي
  return 'ابتدائي';
}

/** Return next upcoming Friday (could be today if today is Friday) */
function getNextFriday(now = new Date()) {
  const d = new Date(now);
  const day = d.getDay();
  const daysToFriday = day <= 5 ? 5 - day : 5 + (7 - day);
  d.setDate(d.getDate() + daysToFriday);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Previous Friday before or on a given date */
function getPrevFriday(now = new Date()) {
  const d = new Date(now);
  const day = d.getDay();
  // if today is friday (5), go back 7 days to get the PREVIOUS one
  const daysBack = day === 5 ? 7 : day < 5 ? day + 2 : day - 5;
  d.setDate(d.getDate() - daysBack);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Format date as YYYY-MM-DD */
function toDateId(date) {
  return date.toISOString().slice(0, 10);
}

/** Format date in Arabic */
function formatArabicDate(date) {
  if (!date) return '';
  let d = date;
  if (typeof date === 'string') {
    const parts = date.split('-');
    if (parts.length === 3) {
      d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    } else {
      d = new Date(date);
    }
  }
  return d.toLocaleDateString('ar-EG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

/** Arabic ordinal for friday index */
function fridayOrdinal(idx) {
  return ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة'][idx] || `رقم ${idx + 1}`;
}

function getFridayIndexInMonth(friday) {
  const fridays = getFridaysOfMonth(friday.getFullYear(), friday.getMonth());
  return fridays.findIndex(f => f.toDateString() === friday.toDateString());
}

// ─────────────────────────────────────────────────────────────
// Servant stage helper
// ─────────────────────────────────────────────────────────────
const normalizeArabic = (str) => {
  if (!str) return '';
  return str.replace(/[أإآا]/g, 'ا').replace(/[ىي]/g, 'ي').replace(/[ةه]/g, 'ه').trim();
};

function getServantStage(servant) {
  if (!servant) return null;
  const roleNorm = normalizeArabic(servant.role || '');
  // Stage servants have their stage in managedStage or we derive from myClasses
  if (servant.managedStage) return servant.managedStage;
  const classes = servant.myClasses || (servant.assignedClass ? [servant.assignedClass] : []);
  for (const cls of classes) {
    const clsNorm = normalizeArabic(cls);
    if (clsNorm.includes('ابتدائي') || clsNorm.includes('ابتدائى') || clsNorm.includes('حضانه') || clsNorm.includes('ملائكه')) return 'ابتدائي';
    if (clsNorm.includes('اعدادي') || clsNorm.includes('اعدادى')) return 'اعدادي';
    if (clsNorm.includes('ثانوي') || clsNorm.includes('ثانوى')) return 'ثانوي';
  }
  // Check from role description
  if (roleNorm.includes('ابتدائي') || roleNorm.includes('ابتدائى')) return 'ابتدائي';
  if (roleNorm.includes('اعدادي') || roleNorm.includes('اعدادى')) return 'اعدادي';
  if (roleNorm.includes('ثانوي') || roleNorm.includes('ثانوى')) return 'ثانوي';
  return null; // can't determine
}

// ─────────────────────────────────────────────────────────────
// Searchable Select Component
// ─────────────────────────────────────────────────────────────
function SearchableSelect({ options, value, onChange, placeholder = 'اختر...', disabled = false }) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return options;
    const s = normalizeArabic(search.toLowerCase());
    return options.filter(o => normalizeArabic(o.label.toLowerCase()).includes(s));
  }, [options, search]);

  const selected = options.find(o => o.value === value);

  return (
    <div className="relative" dir="rtl">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(p => !p)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all
          ${disabled
            ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 cursor-not-allowed'
            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-blue-400 dark:hover:border-blue-500 cursor-pointer shadow-sm'
          }`}
      >
        {selected && selected.student ? (
          <div className="flex items-center gap-2.5 min-w-0">
            {selected.student.avatarUrl || selected.student.photoUrl || selected.student.photo ? (
              <img
                src={selected.student.avatarUrl || selected.student.photoUrl || selected.student.photo}
                alt={selected.label}
                className="w-6 h-6 rounded-full object-cover flex-shrink-0 border border-slate-200 dark:border-slate-700"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-black text-[10px] flex items-center justify-center flex-shrink-0">
                {(selected.label || '?')[0]}
              </div>
            )}
            <span className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate">{selected.label}</span>
          </div>
        ) : (
          <span className={selected ? 'font-bold text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}>
            {selected ? selected.label : placeholder}
          </span>
        )}
        <ChevronDown size={16} className={`transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 right-0 left-0 z-40 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden max-h-64">
            <div className="p-2 border-b border-slate-100 dark:border-slate-700">
              <div className="flex items-center gap-2 px-2 py-1 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                <Search size={14} className="text-slate-400" />
                <input
                  autoFocus
                  className="flex-1 bg-transparent text-sm outline-none text-slate-700 dark:text-slate-200 placeholder-slate-400"
                  placeholder="بحث باسم المخدوم..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="overflow-y-auto max-h-52 divide-y divide-slate-100 dark:divide-slate-700/40">
              {filtered.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-3">لا توجد نتائج</p>
              ) : filtered.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false); setSearch(''); }}
                  className={`w-full text-right px-3 py-2.5 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors flex items-center justify-between gap-2
                    ${o.value === value ? 'text-blue-600 dark:text-blue-400 font-bold bg-blue-50/60 dark:bg-blue-900/20' : 'text-slate-700 dark:text-slate-200'}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Student Image or Initial Avatar (Only if option is a student) */}
                    {o.student && (
                      o.student.avatarUrl || o.student.photoUrl || o.student.photo ? (
                        <img
                          src={o.student.avatarUrl || o.student.photoUrl || o.student.photo}
                          alt={o.label}
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0 border border-slate-200 dark:border-slate-700 shadow-sm"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-black text-xs flex items-center justify-center flex-shrink-0 shadow-sm">
                          {(o.label || '?')[0]}
                        </div>
                      )
                    )}

                    {/* Name & Class / Readings Breakdown */}
                    <div className="min-w-0 text-right">
                      <p className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate leading-tight">{o.label}</p>
                      {o.student && (
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {(() => {
                            const stats = o.student.massReadingCounts || {};
                            const total = (stats.boulos || 0) + (stats.kathoikon || 0) + (stats.abraxes || 0) + (stats.gospel || 0);
                            if (total === 0) {
                              return <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.2 rounded">لم يقرأ بعد ✨</span>;
                            }
                            return (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50 dark:bg-indigo-950/50 px-1.5 py-0.2 rounded">
                                  قرأ {total} {total === 1 ? 'مرة' : 'مرات'}
                                </span>
                                <div className="flex gap-1 text-[9px]">
                                  {stats.boulos > 0 && <span title="بولس" className="text-blue-600 dark:text-blue-400 font-black">ب:{stats.boulos}</span>}
                                  {stats.kathoikon > 0 && <span title="كاثيوليكون" className="text-purple-600 dark:text-purple-400 font-black">ك:{stats.kathoikon}</span>}
                                  {stats.abraxes > 0 && <span title="إبركسيس" className="text-emerald-600 dark:text-emerald-400 font-black">إب:{stats.abraxes}</span>}
                                  {stats.gospel > 0 && <span title="إنجيل" className="text-amber-600 dark:text-amber-400 font-black">إن:{stats.gospel}</span>}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  </div>

                  {o.value === value && <Check size={16} className="flex-shrink-0 text-blue-600 dark:text-blue-400 mr-1" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Reading Card Component
// ─────────────────────────────────────────────────────────────
function ReadingCard({ reading, fridayData, stage, canEdit, onAssign, onUnassign, onConfirm, allStudents, monthReaderIds }) {
  const { key, label, icon: Icon, color } = reading;
  const c = COLOR_MAP[color];

  const currentReading = fridayData?.readings?.[key] || {};
  const { readerId, readerName, readerClass, confirmed, confirmedAt } = currentReading;

  const [editMode, setEditMode]         = useState(false);
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedStudent, setSelectedStudent] = useState('');
  const [saving, setSaving]             = useState(false);

  const classOptions = (STAGE_CLASS_MAP[stage] || []).map(c => ({ value: c, label: c }));

  const studentOptions = useMemo(() => {
    if (!selectedClass) return [];
    return allStudents
      .filter(s => normalizeArabic(s.assignedClass || '') === normalizeArabic(selectedClass))
      .filter(s => {
        // Allow currently assigned reader for this slot so they can be re-selected/kept
        if (s.id === readerId) return true;
        // Block students who have already read/been assigned in the current month
        return !monthReaderIds?.has(s.id);
      })
      .map(s => ({ value: s.id, label: s.name, student: s }));
  }, [allStudents, selectedClass, monthReaderIds, readerId]);

  // Reset student when class changes
  useEffect(() => { setSelectedStudent(''); }, [selectedClass]);

  const handleSave = async () => {
    if (!selectedStudent) return;
    const student = allStudents.find(s => s.id === selectedStudent);
    if (!student) return;
    setSaving(true);
    try {
      await onAssign(key, { readerId: student.id, readerName: student.name, readerClass: student.assignedClass || selectedClass });
      setEditMode(false);
      setSelectedClass('');
      setSelectedStudent('');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    setSaving(true);
    try { await onConfirm(key); } finally { setSaving(false); }
  };

  return (
    <div className={`rounded-2xl border p-5 transition-all duration-300 ${c.bg} ${c.border}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${c.badge}`}>
            <Icon size={20} className={c.icon} />
          </div>
          <h3 className="font-black text-slate-800 dark:text-slate-100 text-base">{label}</h3>
        </div>
        {confirmed && (
          <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/40 px-3 py-1 rounded-full">
            <CheckCircle2 size={13} />
            تم التأكيد
          </span>
        )}
      </div>

      {/* Current Reader */}
      {!editMode && readerId && (
        <div className="mb-4 p-3 bg-white/70 dark:bg-slate-800/50 rounded-xl border border-white/50 dark:border-slate-700/50">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">القارئ المحدد</p>
          <p className="font-bold text-slate-800 dark:text-slate-100">{readerName}</p>
          {readerClass && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{readerClass}</p>}
        </div>
      )}

      {!readerId && !editMode && (
        <div className="mb-4 p-3 bg-white/40 dark:bg-slate-800/30 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-center">
          <p className="text-sm text-slate-400 dark:text-slate-500">لم يُحدد قارئ بعد</p>
        </div>
      )}

      {/* Edit Form */}
      {editMode && canEdit && (
        <div className="space-y-3 mb-4">
          <div>
            <label className="text-xs font-bold text-slate-600 dark:text-slate-400 mb-1 block">اختر الفصل</label>
            <SearchableSelect
              options={classOptions}
              value={selectedClass}
              onChange={setSelectedClass}
              placeholder="اختر الفصل..."
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 dark:text-slate-400 mb-1 block">اختر المخدوم</label>
            <SearchableSelect
              options={studentOptions}
              value={selectedStudent}
              onChange={setSelectedStudent}
              placeholder={!selectedClass ? 'اختر الفصل أولاً...' : 'اختر المخدوم...'}
              disabled={!selectedClass}
            />
            {selectedClass && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1 font-medium">
                <Info size={12} className="flex-shrink-0" />
                المخدومون الذين قرأوا هذا الشهر مادتهم حُجبت تلقائياً
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!selectedStudent || saving}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 ${c.btn} text-white text-sm font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
              حفظ
            </button>
            <button
              onClick={() => { setEditMode(false); setSelectedClass(''); setSelectedStudent(''); }}
              className="px-4 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-all"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!editMode && canEdit && (
        <div className="flex gap-2">
          <button
            onClick={() => setEditMode(true)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-bold rounded-xl transition-all
              ${readerId
                ? 'bg-white/70 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600'
                : `${c.btn} text-white`}`}
          >
            <Edit3 size={14} />
            {readerId ? 'تغيير القارئ' : 'تحديد قارئ'}
          </button>
          {readerId && !confirmed && (
            <button
              onClick={handleConfirm}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-xl transition-all disabled:opacity-50"
            >
              {saving ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              قرأ
            </button>
          )}
          {readerId && (
            <button
              onClick={async () => {
                setSaving(true);
                try { await onUnassign(key); setEditMode(false); } finally { setSaving(false); }
              }}
              disabled={saving}
              title="إلغاء وحذف القارئ من هذا اليوم"
              className="flex items-center gap-1 px-3 py-2 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/60 text-sm font-bold rounded-xl transition-all disabled:opacity-50"
            >
              {saving ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
              إلغاء
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Student Stats Card
// ─────────────────────────────────────────────────────────────
function StudentStatsRow({ student, canEdit, onResetSingle }) {
  const stats = student.massReadingCounts || {};
  const total = (stats.boulos || 0) + (stats.kathoikon || 0) + (stats.abraxes || 0) + (stats.gospel || 0);

  return (
    <div className="flex items-center gap-3 p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 hover:shadow-md transition-all">
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-black text-sm flex-shrink-0">
        {(student.name || '?')[0]}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate">{student.name}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500">{student.assignedClass || '—'}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="flex gap-2 sm:gap-3">
          {READINGS.map(r => (
            <div key={r.key} className="text-center min-w-[44px] sm:min-w-[52px]">
              <div className={`text-xs font-black ${COLOR_MAP[r.color].icon}`}>{stats[r.key] || 0}</div>
              <div className={`text-[10px] font-bold ${COLOR_MAP[r.color].icon} opacity-70`}>{r.label}</div>
            </div>
          ))}
          <div className="text-center border-r border-slate-200 dark:border-slate-600 pr-2 sm:pr-3 mr-1 min-w-[32px] sm:min-w-[36px]">
            <div className="text-xs font-black text-slate-700 dark:text-slate-200">{total}</div>
            <div className="text-[10px] text-slate-400 dark:text-slate-500">الكل</div>
          </div>
        </div>
        {canEdit && total > 0 && (
          <button
            onClick={() => onResetSingle(student)}
            title="مسح سجل هذا المخدوم"
            className="p-1.5 text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-all border border-transparent hover:border-red-200 dark:hover:border-red-800/50"
          >
            <RotateCcw size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────
export default function MassReadings() {
  const { servant, isGeneralAdmin, isServant, loading: authLoading } = useAuth();

  // ── Compute target Friday ──────────────────────────────────
  const now = new Date();
  const isToday = now.getDay() === 5; // is today Friday?
  const targetFriday = getNextFriday(now);
  const fridayId     = toDateId(targetFriday);
  const fridayStage  = getStageForFriday(targetFriday);
  const fridayIdx    = getFridayIndexInMonth(targetFriday);
  const fridayOrd    = fridayOrdinal(fridayIdx);

  // ── Servant access control ─────────────────────────────────
  const roleNorm     = normalizeArabic(servant?.role || '');
  const isStageServantRole = roleNorm.includes('مرحله');
  const isClassServantRole = isServant && !isStageServantRole && !isGeneralAdmin;

  const servantStage = getServantStage(servant);
  const canEdit = isGeneralAdmin || servantStage === fridayStage || servantStage === null;
  // If servant's stage doesn't match this friday's stage, view-only
  const stageMismatch = !isGeneralAdmin && servantStage !== null && servantStage !== fridayStage;

  // ── Data state ─────────────────────────────────────────────
  const [fridayData, setFridayData]   = useState(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [rawStudents, setRawStudents] = useState([]);
  const [allStudents, setAllStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [monthReaderIds, setMonthReaderIds] = useState(new Set());
  const [activeTab, setActiveTab]     = useState('readings');
  const [saving, setSaving]           = useState(false);
  const [toast, setToast]             = useState(null);

  // Search & Reset & Filter state for Stats tab
  const [statsStageFilter, setStatsStageFilter] = useState('ALL');
  const [statsClassFilter, setStatsClassFilter] = useState('ALL');
  const [searchQuery, setSearchQuery]           = useState('');
  const [studentToReset, setStudentToReset]     = useState(null);
  const [showResetAllModal, setShowResetAllModal] = useState(false);

  // Student detailed history state for modal
  const [studentHistory, setStudentHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Available classes for stats tab based on selected stage
  const statsClassOptions = useMemo(() => {
    if (statsStageFilter === 'ALL') {
      return Array.from(new Set(Object.values(STAGE_CLASS_MAP).flat()));
    }
    return STAGE_CLASS_MAP[statsStageFilter] || [];
  }, [statsStageFilter]);

  // Reset class filter when stage filter changes
  useEffect(() => {
    setStatsClassFilter('ALL');
  }, [statsStageFilter]);

  // ── Fetch date history entries for selected student ─────────
  useEffect(() => {
    if (!studentToReset) {
      setStudentHistory([]);
      return;
    }

    setHistoryLoading(true);
    getDocs(collection(db, 'mass_readings')).then(snap => {
      const historyEntries = [];
      snap.docs.forEach(docSnap => {
        const data = docSnap.data();
        const fridayDate = data.fridayDate || docSnap.id;

        READINGS.forEach(r => {
          const rd = data.readings?.[r.key];
          if (rd?.readerId === studentToReset.id) {
            historyEntries.push({
              docId: docSnap.id,
              fridayDate,
              readingKey: r.key,
              readingLabel: r.label,
              readingColor: r.color,
              readingIcon: r.icon,
              confirmed: !!rd.confirmed,
              confirmedAt: rd.confirmedAt
            });
          }
        });
      });

      // Sort by fridayDate descending (newest first)
      historyEntries.sort((a, b) => b.fridayDate.localeCompare(a.fridayDate));
      setStudentHistory(historyEntries);
      setHistoryLoading(false);
    }).catch(err => {
      console.error("Error fetching student reading history:", err);
      setHistoryLoading(false);
    });
  }, [studentToReset]);

  // ── Remove specific reading date entry for a student ───────
  const handleRemoveStudentDateReading = async (entry) => {
    try {
      setSaving(true);
      const { docId, fridayDate, readingKey, readingLabel } = entry;
      const studentId = studentToReset.id;

      // Update mass_readings doc in Firestore
      const docRef = doc(db, 'mass_readings', docId);
      const payload = {
        [`readings.${readingKey}.readerId`]:    null,
        [`readings.${readingKey}.readerName`]:  null,
        [`readings.${readingKey}.readerClass`]: null,
        [`readings.${readingKey}.confirmed`]:   false,
        [`readings.${readingKey}.confirmedAt`]: null,
      };

      await updateDoc(docRef, payload);

      // Decrement student counter if counter exists
      const studentRef = doc(db, 'students', studentId);
      const currentCount = studentToReset.massReadingCounts?.[readingKey] || 0;

      if (currentCount > 0) {
        if (currentCount <= 1) {
          await updateDoc(studentRef, {
            [`massReadingCounts.${readingKey}`]: deleteField()
          }).catch(() => {});
        } else {
          await updateDoc(studentRef, {
            [`massReadingCounts.${readingKey}`]: increment(-1)
          }).catch(() => {});
        }
      }

      // Update local state for rawStudents & allStudents
      const updateStudentCountsInState = (prevList) => prevList.map(s => {
        if (s.id === studentId) {
          const updatedCounts = { ...(s.massReadingCounts || {}) };
          if ((updatedCounts[readingKey] || 0) > 1) {
            updatedCounts[readingKey] -= 1;
          } else {
            delete updatedCounts[readingKey];
          }
          return { ...s, massReadingCounts: updatedCounts };
        }
        return s;
      });

      setRawStudents(updateStudentCountsInState);
      setAllStudents(updateStudentCountsInState);

      // Update studentToReset in modal state
      setStudentToReset(prev => {
        if (!prev) return prev;
        const updatedCounts = { ...(prev.massReadingCounts || {}) };
        if ((updatedCounts[readingKey] || 0) > 1) {
          updatedCounts[readingKey] -= 1;
        } else {
          delete updatedCounts[readingKey];
        }
        return { ...prev, massReadingCounts: updatedCounts };
      });

      // Remove entry from studentHistory list in modal
      setStudentHistory(prev => prev.filter(e => !(e.docId === docId && e.readingKey === readingKey)));

      const formattedDate = formatArabicDate(fridayDate);
      showToast(`تم حذف قراءة (${readingLabel}) للمخدوم بتاريخ ${formattedDate} 🗑️`);
    } catch (err) {
      console.error("Error removing student date reading:", err);
      showToast('حدث خطأ أثناء حذف القراءة', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Toast helper ───────────────────────────────────────────
  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Reset single student stats (or single reading for student) ──
  const handleResetSingleStudentReading = async (studentId, studentName, readingKey = null) => {
    try {
      setSaving(true);
      const studentRef = doc(db, 'students', studentId);
      if (readingKey) {
        await updateDoc(studentRef, {
          [`massReadingCounts.${readingKey}`]: deleteField()
        });
        setRawStudents(prev => prev.map(s => {
          if (s.id === studentId) {
            const updatedCounts = { ...(s.massReadingCounts || {}) };
            delete updatedCounts[readingKey];
            return { ...s, massReadingCounts: updatedCounts };
          }
          return s;
        }));
        setAllStudents(prev => prev.map(s => {
          if (s.id === studentId) {
            const updatedCounts = { ...(s.massReadingCounts || {}) };
            delete updatedCounts[readingKey];
            return { ...s, massReadingCounts: updatedCounts };
          }
          return s;
        }));
        setStudentToReset(prev => {
          if (!prev || prev.id !== studentId) return prev;
          const updatedCounts = { ...(prev.massReadingCounts || {}) };
          delete updatedCounts[readingKey];
          return { ...prev, massReadingCounts: updatedCounts };
        });
        const readingLabel = READINGS.find(r => r.key === readingKey)?.label || readingKey;
        showToast(`تم تصفير قراءة (${readingLabel}) للمخدوم ${studentName}`);
      } else {
        await updateDoc(studentRef, {
          massReadingCounts: deleteField()
        });
        setRawStudents(prev => prev.map(s => {
          if (s.id === studentId) {
            const { massReadingCounts, ...rest } = s;
            return rest;
          }
          return s;
        }));
        setAllStudents(prev => prev.map(s => {
          if (s.id === studentId) {
            const { massReadingCounts, ...rest } = s;
            return rest;
          }
          return s;
        }));
        setStudentToReset(prev => {
          if (!prev || prev.id !== studentId) return prev;
          const { massReadingCounts, ...rest } = prev;
          return rest;
        });
        showToast(`تم مسح كافة قراءات المخدوم ${studentName}`);
      }

      // Also unassign student from any current month mass_readings docs so they are unblocked in selection
      try {
        const monthFridays = getFridaysOfMonth(targetFriday.getFullYear(), targetFriday.getMonth());
        const monthDateIds = monthFridays.map(f => toDateId(f));

        for (const fId of monthDateIds) {
          const fRef = doc(db, 'mass_readings', fId);
          const fSnap = await getDoc(fRef).catch(() => null);
          if (fSnap && fSnap.exists()) {
            const fData = fSnap.data();
            const updates = {};
            let needsUnassign = false;
            READINGS.forEach(r => {
              if (readingKey === null || readingKey === r.key) {
                if (fData.readings?.[r.key]?.readerId === studentId) {
                  updates[`readings.${r.key}.readerId`] = null;
                  updates[`readings.${r.key}.readerName`] = null;
                  updates[`readings.${r.key}.readerClass`] = null;
                  updates[`readings.${r.key}.confirmed`] = false;
                  updates[`readings.${r.key}.confirmedAt`] = null;
                  needsUnassign = true;
                }
              }
            });
            if (needsUnassign) {
              await updateDoc(fRef, updates).catch(() => {});
            }
          }
        }
      } catch (e) {
        console.warn("Error unassigning student from month readings:", e);
      }
    } catch (err) {
      console.error("Error resetting student reading stats:", err);
      showToast('حدث خطأ أثناء تعديل السجل', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Reset all students stats (for filtered list) ──────────
  const handleResetAllStats = async () => {
    try {
      setSaving(true);
      const batch = writeBatch(db);
      let count = 0;
      filteredStatsStudents.forEach(student => {
        if (student.massReadingCounts) {
          const studentRef = doc(db, 'students', student.id);
          batch.update(studentRef, { massReadingCounts: deleteField() });
          count++;
        }
      });
      if (count > 0) {
        await batch.commit();
      }
      const resetIds = new Set(filteredStatsStudents.map(s => s.id));
      setRawStudents(prev => prev.map(s => {
        if (resetIds.has(s.id)) {
          const { massReadingCounts, ...rest } = s;
          return rest;
        }
        return s;
      }));
      setAllStudents(prev => prev.map(s => {
        if (resetIds.has(s.id)) {
          const { massReadingCounts, ...rest } = s;
          return rest;
        }
        return s;
      }));
      showToast('تم مسح سجل القراءات للمخدومين المعروضين بنجاح ✅');
    } catch (err) {
      console.error("Error resetting all stats:", err);
      showToast('حدث خطأ أثناء مسح السجلات', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Filtered students for Stats tab ────────────────────────
  const filteredStatsStudents = useMemo(() => {
    let list = [...rawStudents];

    // Filter by Stage
    if (statsStageFilter !== 'ALL') {
      const targetStageNorm = normalizeArabic(statsStageFilter);
      list = list.filter(s => {
        const sStage = getStudentStage(s);
        return normalizeArabic(sStage) === targetStageNorm;
      });
    }

    // Filter by Class
    if (statsClassFilter !== 'ALL') {
      const targetClassNorm = normalizeArabic(statsClassFilter);
      list = list.filter(s => {
        const sClass = normalizeArabic(s.assignedClass || s.schoolGrade || '');
        return sClass === targetClassNorm;
      });
    }

    // Filter by Name Search
    if (searchQuery.trim()) {
      const q = normalizeArabic(searchQuery.trim().toLowerCase());
      list = list.filter(s => normalizeArabic((s.name || '').toLowerCase()).includes(q));
    }

    // Sort by total reading count descending
    return list.sort((a, b) => {
      const totalA = Object.values(a.massReadingCounts || {}).reduce((s, v) => s + v, 0);
      const totalB = Object.values(b.massReadingCounts || {}).reduce((s, v) => s + v, 0);
      return totalB - totalA;
    });
  }, [rawStudents, statsStageFilter, statsClassFilter, searchQuery]);

  // ── Listen to friday doc in Firestore ─────────────────────
  useEffect(() => {
    setDataLoading(true);
    const docRef = doc(db, 'mass_readings', fridayId);
    const unsub = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        setFridayData(snap.data());
      } else {
        setFridayData(null);
      }
      setDataLoading(false);
    }, () => setDataLoading(false));
    return () => unsub();
  }, [fridayId]);

  // ── Fetch readers assigned/read in current month ─────────────
  useEffect(() => {
    const fetchMonthReaders = async () => {
      try {
        const monthFridays = getFridaysOfMonth(targetFriday.getFullYear(), targetFriday.getMonth());
        const monthDateIds = monthFridays.map(f => toDateId(f));

        const docsSnaps = await Promise.all(
          monthDateIds.map(id => getDoc(doc(db, 'mass_readings', id)))
        );

        const readerIds = new Set();
        docsSnaps.forEach(snap => {
          if (snap.exists()) {
            const data = snap.data();
            READINGS.forEach(r => {
              const rd = data.readings?.[r.key];
              if (rd?.readerId) {
                readerIds.add(rd.readerId);
              }
            });
          }
        });
        setMonthReaderIds(readerIds);
      } catch (err) {
        console.error("Error fetching month readers:", err);
      }
    };

    fetchMonthReaders();
  }, [fridayId, fridayData]);

  // ── Fetch students for this friday's stage ─────────────────
  useEffect(() => {
    setStudentsLoading(true);

    // جيب كل الطلاب وافلتر locally عشان نتعامل مع كل اختلافات حقل stage
    getDocs(collection(db, 'students')).then(snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setRawStudents(all);

      const stageNorm = normalizeArabic(fridayStage);
      const filtered = all.filter(s => normalizeArabic(getStudentStage(s)) === stageNorm);

      setAllStudents(filtered);
      setStudentsLoading(false);
    }).catch(() => setStudentsLoading(false));
  }, [fridayStage]);

  // ── Auto-mark previous Friday ──────────────────────────────
  useEffect(() => {
    const autoMark = async () => {
      // only run after Friday (Saturday onwards)
      const todayDay = now.getDay();
      if (todayDay === 5) return; // today is Friday, skip

      const prevFri = getPrevFriday(now);
      const prevId  = toDateId(prevFri);

      const prevRef = doc(db, 'mass_readings', prevId);
      const prevSnap = await getDoc(prevRef).catch(() => null);
      if (!prevSnap || !prevSnap.exists()) return;

      const data = prevSnap.data();
      if (data.autoMarkedAfterFriday) return; // already done

      // Build batch updates to mark all assigned readers as confirmed + increment counters
      const updates = {};
      let needsUpdate = false;

      for (const rk of READINGS.map(r => r.key)) {
        const rd = data.readings?.[rk] || {};
        if (rd.readerId && !rd.confirmed) {
          updates[`readings.${rk}.confirmed`]    = true;
          updates[`readings.${rk}.confirmedAt`]  = serverTimestamp();
          needsUpdate = true;

          // Increment counter on student doc
          const studentRef = doc(db, 'students', rd.readerId);
          updateDoc(studentRef, {
            [`massReadingCounts.${rk}`]: increment(1),
          }).catch(() => {});
        }
      }

      if (needsUpdate) {
        updates.autoMarkedAfterFriday = true;
        await updateDoc(prevRef, updates).catch(() => {});
      } else if (!data.autoMarkedAfterFriday) {
        await updateDoc(prevRef, { autoMarkedAfterFriday: true }).catch(() => {});
      }
    };

    autoMark();
  }, []);

  // ── Assign reader to a reading ─────────────────────────────
  const handleAssign = async (readingKey, { readerId, readerName, readerClass }) => {
    const docRef = doc(db, 'mass_readings', fridayId);
    const payload = {
      stage: fridayStage,
      fridayDate: fridayId,
      [`readings.${readingKey}.readerId`]:    readerId,
      [`readings.${readingKey}.readerName`]:  readerName,
      [`readings.${readingKey}.readerClass`]: readerClass,
      [`readings.${readingKey}.confirmed`]:   false,
      [`readings.${readingKey}.confirmedAt`]: null,
    };

    if (!fridayData) {
      // Create doc first
      const initData = {
        stage: fridayStage,
        fridayDate: fridayId,
        autoMarkedAfterFriday: false,
        readings: {
          boulos:    { readerId: null, readerName: null, readerClass: null, confirmed: false, confirmedAt: null },
          kathoikon: { readerId: null, readerName: null, readerClass: null, confirmed: false, confirmedAt: null },
          abraxes:   { readerId: null, readerName: null, readerClass: null, confirmed: false, confirmedAt: null },
          gospel:    { readerId: null, readerName: null, readerClass: null, confirmed: false, confirmedAt: null },
        },
      };
      initData.readings[readingKey] = { readerId, readerName, readerClass, confirmed: false, confirmedAt: null };
      await setDoc(docRef, initData);
    } else {
      await updateDoc(docRef, payload);
    }
    showToast(`تم تحديد ${readerName} لقراءة ${READINGS.find(r => r.key === readingKey)?.label}`);
  };

  // ── Unassign/Remove reader from a reading card ──────────────
  const handleUnassign = async (readingKey) => {
    const rd = fridayData?.readings?.[readingKey];
    if (!rd?.readerId) return;

    const docRef = doc(db, 'mass_readings', fridayId);
    const payload = {
      [`readings.${readingKey}.readerId`]:    null,
      [`readings.${readingKey}.readerName`]:  null,
      [`readings.${readingKey}.readerClass`]: null,
      [`readings.${readingKey}.confirmed`]:   false,
      [`readings.${readingKey}.confirmedAt`]: null,
    };

    await updateDoc(docRef, payload);

    // If it was confirmed, decrement the student's count
    if (rd.confirmed && rd.readerId) {
      const stuRef = doc(db, 'students', rd.readerId);
      await updateDoc(stuRef, {
        [`massReadingCounts.${readingKey}`]: increment(-1)
      }).catch(() => {});

      setAllStudents(prev => prev.map(s => {
        if (s.id === rd.readerId) {
          const currentCount = s.massReadingCounts?.[readingKey] || 0;
          const updatedCounts = { ...(s.massReadingCounts || {}) };
          if (currentCount <= 1) {
            delete updatedCounts[readingKey];
          } else {
            updatedCounts[readingKey] = currentCount - 1;
          }
          return { ...s, massReadingCounts: updatedCounts };
        }
        return s;
      }));
    }

    showToast(`تم إلغاء تحديد القارئ لقراءة ${READINGS.find(r => r.key === readingKey)?.label}`);
  };

  // ── Confirm a reading (manual mark) ───────────────────────
  const handleConfirm = async (readingKey) => {
    const rd = fridayData?.readings?.[readingKey];
    if (!rd?.readerId) return;

    const docRef    = doc(db, 'mass_readings', fridayId);
    const stuRef    = doc(db, 'students', rd.readerId);

    await updateDoc(docRef, {
      [`readings.${readingKey}.confirmed`]:   true,
      [`readings.${readingKey}.confirmedAt`]: serverTimestamp(),
    });

    await updateDoc(stuRef, {
      [`massReadingCounts.${readingKey}`]: increment(1),
    }).catch(() => {});

    showToast(`تم تأكيد قراءة ${rd.readerName} ✅`);
  };

  // ── Loading state ──────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <RefreshCw className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  if (!isServant && !isGeneralAdmin) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center p-8">
        <AlertTriangle className="mx-auto mb-4 text-amber-500" size={48} />
        <p className="text-xl font-black text-slate-700 dark:text-slate-200">غير مصرح لك</p>
        <p className="text-slate-500 dark:text-slate-400 mt-2">هذه الصفحة مخصصة للخدام فقط.</p>
      </div>
    );
  }

  // ── Stats tab students list ────────────────────────────────
  const sortedStudents = [...allStudents].sort((a, b) => {
    const totalA = Object.values(a.massReadingCounts || {}).reduce((s, v) => s + v, 0);
    const totalB = Object.values(b.massReadingCounts || {}).reduce((s, v) => s + v, 0);
    return totalB - totalA;
  });

  const allConfirmed = READINGS.every(r => fridayData?.readings?.[r.key]?.confirmed);
  const allAssigned  = READINGS.every(r => fridayData?.readings?.[r.key]?.readerId);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6" dir="rtl">

      {/* ── Toast ──────────────────────────────────────────── */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-2xl text-white font-bold text-sm flex items-center gap-2 animate-in slide-in-from-bottom-4 duration-300
          ${toast.type === 'error' ? 'bg-red-500' : 'bg-emerald-500'}`}>
          {toast.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          {toast.msg}
        </div>
      )}

      {/* ── Page Header ────────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
            <Church size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800 dark:text-slate-100">قراءات القداس</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">توزيع قراءات قداس الجمعة</p>
          </div>
        </div>

        {/* Friday Info Card */}
        <div className="mt-4 p-4 bg-gradient-to-l from-indigo-500 to-purple-600 rounded-2xl text-white shadow-lg">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-indigo-100 text-xs font-medium mb-0.5">الجمعة القادمة</p>
              <p className="font-black text-lg">{formatArabicDate(targetFriday)}</p>
              <p className="text-indigo-200 text-sm mt-0.5">
                الجمعة {fridayOrd} من الشهر
              </p>
            </div>
            <div className="text-center bg-white/20 rounded-xl px-4 py-2">
              <p className="text-xs text-indigo-100 mb-0.5">المرحلة</p>
              <p className="font-black text-xl">{fridayStage}</p>
            </div>
          </div>

          {/* Status badges */}
          <div className="flex gap-2 mt-3 flex-wrap">
            {allAssigned && (
              <span className="flex items-center gap-1.5 text-xs font-bold bg-white/20 px-3 py-1 rounded-full">
                <User size={12} /> جميع القراءات محددة
              </span>
            )}
            {allConfirmed && (
              <span className="flex items-center gap-1.5 text-xs font-bold bg-emerald-400/30 px-3 py-1 rounded-full">
                <CheckCircle2 size={12} /> تم تأكيد الجميع ✅
              </span>
            )}
            {!allAssigned && (
              <span className="flex items-center gap-1.5 text-xs font-bold bg-amber-400/30 px-3 py-1 rounded-full">
                <Clock size={12} /> في انتظار تحديد القراء
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Stage Mismatch Banner ─────────────────────────── */}
      {stageMismatch && (
        <div className="mb-5 flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl">
          <Info size={20} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-amber-800 dark:text-amber-200 text-sm">
              قراءات الجمعة القادمة مخصصة لمرحلة <strong>{fridayStage}</strong>
            </p>
            <p className="text-amber-600 dark:text-amber-400 text-xs mt-0.5">
              هذه الجمعة ليست خاصة بمرحلتك — يمكنك المشاهدة فقط.
            </p>
          </div>
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────── */}
      <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl mb-5">
        {[
          { key: 'readings', label: 'قراءات الجمعة' },
          { key: 'stats',    label: 'سجل المخدومين'  },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all duration-200
              ${activeTab === tab.key
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Readings Tab ─────────────────────────────────── */}
      {activeTab === 'readings' && (
        <>
          {dataLoading || studentsLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <RefreshCw className="animate-spin text-indigo-500" size={28} />
              <p className="text-slate-500 dark:text-slate-400 text-sm">جاري تحميل البيانات...</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {READINGS.map(reading => (
                <ReadingCard
                  key={reading.key}
                  reading={reading}
                  fridayData={fridayData}
                  stage={fridayStage}
                  canEdit={canEdit && !stageMismatch}
                  onAssign={handleAssign}
                  onUnassign={handleUnassign}
                  onConfirm={handleConfirm}
                  allStudents={allStudents}
                  monthReaderIds={monthReaderIds}
                />
              ))}
            </div>
          )}

          {/* Confirm All Button */}
          {canEdit && !stageMismatch && allAssigned && !allConfirmed && (
            <div className="mt-5">
              <button
                onClick={async () => {
                  setSaving(true);
                  try {
                    for (const rk of READINGS.map(r => r.key)) {
                      const rd = fridayData?.readings?.[rk];
                      if (rd?.readerId && !rd?.confirmed) {
                        await handleConfirm(rk);
                      }
                    }
                    showToast('تم تأكيد جميع القراءات ✅');
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-l from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-black text-base rounded-2xl shadow-lg transition-all disabled:opacity-50"
              >
                {saving ? <RefreshCw size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                تأكيد قراءة الجميع
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Stats Tab ────────────────────────────────────── */}
      {activeTab === 'stats' && (
        <div>
          <div className="mb-4 p-3 bg-indigo-50 dark:bg-indigo-950/30 rounded-xl border border-indigo-100 dark:border-indigo-800 flex items-center gap-2">
            <Info size={15} className="text-indigo-500 flex-shrink-0" />
            <p className="text-xs text-indigo-600 dark:text-indigo-400">
              سجل قراءات جميع المخدومين — يمكنك التصفية حسب المرحلة والفصل والبحث بالاسم.
            </p>
          </div>

          {/* Filters Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            {/* Stage Filter */}
            <div>
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1 block">المرحلة</label>
              <select
                value={statsStageFilter}
                onChange={e => setStatsStageFilter(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500 transition-all shadow-sm"
              >
                <option value="ALL">كل المراحل</option>
                <option value="ابتدائي">مرحلة ابتدائي</option>
                <option value="اعدادي">مرحلة إعدادي</option>
                <option value="ثانوي">مرحلة ثانوي</option>
              </select>
            </div>

            {/* Class Filter */}
            <div>
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1 block">الفصل</label>
              <select
                value={statsClassFilter}
                onChange={e => setStatsClassFilter(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500 transition-all shadow-sm"
              >
                <option value="ALL">كل الفصول</option>
                {statsClassOptions.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Search Box */}
            <div>
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1 block">البحث بالاسم</label>
              <div className="relative w-full">
                <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="بحث باسم المخدوم..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pr-9 pl-8 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-indigo-500 transition-all shadow-sm"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Action and Count Bar */}
          <div className="flex items-center justify-between gap-3 mb-4 px-1">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
              عدد المخدومين المعروضين: <strong className="text-indigo-600 dark:text-indigo-400">{filteredStatsStudents.length}</strong>
            </span>

            {canEdit && !stageMismatch && filteredStatsStudents.length > 0 && (
              <button
                onClick={() => setShowResetAllModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/80 rounded-xl text-xs font-bold transition-all whitespace-nowrap shadow-sm"
              >
                <Trash2 size={13} />
                مسح سجل المخدومين المعروضين
              </button>
            )}
          </div>

          {/* Headers */}
          <div className="flex items-center gap-3 px-3 mb-2">
            <div className="w-9 flex-shrink-0" />
            <div className="flex-1" />
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="flex gap-2 sm:gap-3">
                {READINGS.map(r => (
                  <div key={r.key} className={`text-center text-[10px] font-black min-w-[44px] sm:min-w-[52px] ${COLOR_MAP[r.color].icon}`}>
                    {r.label}
                  </div>
                ))}
                <div className="text-center text-[10px] font-black min-w-[32px] sm:min-w-[36px] text-slate-500 dark:text-slate-400 border-r border-slate-200 dark:border-slate-600 pr-2">الكل</div>
              </div>
              {canEdit && !stageMismatch && <div className="w-7 flex-shrink-0" />}
            </div>
          </div>

          {studentsLoading ? (
            <div className="flex justify-center py-10">
              <RefreshCw className="animate-spin text-indigo-500" size={24} />
            </div>
          ) : filteredStatsStudents.length === 0 ? (
            <div className="text-center py-10 text-slate-400 dark:text-slate-500 text-sm">
              {searchQuery ? 'لا يوجد مخدوم مطابق للبحث' : 'لا يوجد مخدومين مسجلين لهذه المرحلة'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredStatsStudents.map(s => (
                <StudentStatsRow
                  key={s.id}
                  student={s}
                  canEdit={canEdit && !stageMismatch}
                  onResetSingle={setStudentToReset}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Detailed Student History & Date Reset Modal ────────────────────── */}
      {studentToReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl border border-slate-100 dark:border-slate-700 text-right max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black">
                  <BookOpen size={20} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-800 dark:text-slate-100">سجل قراءات المخدوم بالتواريخ</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">لالمخدوم: <strong className="text-indigo-600 dark:text-indigo-400">{studentToReset.name}</strong> ({studentToReset.assignedClass || 'بدون فصل'})</p>
                </div>
              </div>
              <button
                onClick={() => setStudentToReset(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content: List of Dates grouped by Reading */}
            <div className="overflow-y-auto flex-1 pr-1 space-y-3 mb-4">
              {historyLoading ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <RefreshCw className="animate-spin text-indigo-500" size={24} />
                  <p className="text-xs text-slate-400">جاري تحميل تواريخ القراءات...</p>
                </div>
              ) : studentHistory.length === 0 ? (
                <div className="text-center py-8 bg-slate-50 dark:bg-slate-700/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                  <Clock size={28} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-bold">لا يوجد تواريخ قراءات مسجلة لهذا المخدوم</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">لم يتم تخصيص أية قراءات له في القداسات السابقة</p>
                </div>
              ) : (
                READINGS.map(r => {
                  const rEntries = studentHistory.filter(e => e.readingKey === r.key);
                  const c = COLOR_MAP[r.color];
                  const Icon = r.icon;
                  return (
                    <div key={r.key} className="p-3.5 bg-slate-50 dark:bg-slate-700/40 rounded-xl border border-slate-100 dark:border-slate-700/60">
                      <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-200/50 dark:border-slate-600/50">
                        <div className="flex items-center gap-2">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${c.badge}`}>
                            <Icon size={15} className={c.icon} />
                          </div>
                          <span className="font-bold text-slate-800 dark:text-slate-100 text-sm">{r.label}</span>
                        </div>
                        <span className={`text-xs font-black ${c.icon}`}>
                          إجمالي: {rEntries.length}
                        </span>
                      </div>

                      {rEntries.length === 0 ? (
                        <p className="text-xs text-slate-400 dark:text-slate-500 italic py-1 text-center">لا توجد قراءات مسجلة لهذه المادة</p>
                      ) : (
                        <div className="space-y-2 mt-2">
                          {rEntries.map(e => (
                            <div key={e.docId + e.readingKey} className="flex items-center justify-between p-2.5 bg-white dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700 shadow-sm">
                              <div className="flex items-center gap-2">
                                <Clock size={14} className="text-slate-400" />
                                <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                                  {formatArabicDate(e.fridayDate)}
                                </span>
                                {e.confirmed && (
                                  <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded font-bold">
                                    مؤكدة ✅
                                  </span>
                                )}
                              </div>

                              <button
                                disabled={saving}
                                onClick={() => handleRemoveStudentDateReading(e)}
                                className="px-2.5 py-1 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/60 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/60 rounded-lg text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-1"
                              >
                                <Trash2 size={12} />
                                مسح هذا اليوم
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom Actions */}
            <div className="flex flex-col sm:flex-row items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-700 flex-shrink-0">
              <button
                disabled={!studentToReset.massReadingCounts || Object.values(studentToReset.massReadingCounts).every(v => !v) || saving}
                onClick={() => {
                  const s = studentToReset;
                  handleResetSingleStudentReading(s.id, s.name, null);
                }}
                className="w-full sm:flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm flex items-center justify-center gap-1.5"
              >
                <Trash2 size={14} />
                تصفير جميع القراءات للمخدوم بالكامل
              </button>
              <button
                onClick={() => setStudentToReset(null)}
                className="w-full sm:w-auto px-5 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-all"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reset All Stats Modal ────────────────────────────────── */}
      {showResetAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-100 dark:border-slate-700 text-right">
            <div className="w-12 h-12 rounded-2xl bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 flex items-center justify-center mb-4">
              <Trash2 size={24} />
            </div>
            <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 mb-2">مسح جميع سجلات القراءات نهائياً</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-6 leading-relaxed">
              ⚠️ تنبيه هام: هل أنت متأكد من مسح عداد السجلات لجميع مخدومي مرحلة <strong className="text-red-500">{fridayStage}</strong> بالكامل؟ لا يمكن التراجع عن هذه الخطوة.
            </p>
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  setShowResetAllModal(false);
                  await handleResetAllStats();
                }}
                disabled={saving}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold text-sm rounded-xl transition-all shadow-md disabled:opacity-50"
              >
                تأكيد المسح النهائي
              </button>
              <button
                onClick={() => setShowResetAllModal(false)}
                className="px-5 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-sm rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-all"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
