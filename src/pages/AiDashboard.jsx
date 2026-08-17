import { useState, useEffect, useMemo } from 'react';
import { db, collection, query, where, onSnapshot, deleteDoc, addDoc, limit, doc, updateDoc, getDocs } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { 
    Sparkles, Clock, Check, List, Trash2, MessageSquare, Info, AlertCircle, Plus, Send, X, Ban, Search, ShieldAlert, PhoneOff, Edit3, CheckCircle, History, FileText, CheckCircle2, Link as LinkIcon, AlertTriangle, Wrench, Building2, Laptop, RotateCcw 
} from 'lucide-react';

export default function AiDashboard() {
    const { servant } = useAuth();

    // Active Sub-Tab: 'review' | 'kb' | 'history' | 'blocked'
    const [subTab, setSubTab] = useState('review');

    // Review Sub-Section: 'unanswered' | 'answered' | 'service_issues' | 'tech_issues'
    const [reviewSection, setReviewSection] = useState('unanswered');

    // History Sub-Section: 'all' | 'unanswered' | 'answered' | 'service_issues' | 'tech_issues'
    const [historySection, setHistorySection] = useState('all');

    // AI Page states
    const [kbItems, setKbItems] = useState([]);
    const [loadingKB, setLoadingKB] = useState(true);
    const [aiQueryLogs, setAiQueryLogs] = useState([]);
    const [aiQueryLogsLoading, setAiQueryLogsLoading] = useState(true);
    const [aiAnswers, setAiAnswers] = useState({}); // { logId: answerText }

    // KB Link Selector State
    const [selectedKbForLog, setSelectedKbForLog] = useState({}); // { logId: kbId }
    const [showKbLinkDropdown, setShowKbLinkDropdown] = useState({}); // { logId: boolean }

    // Direct Add & Edit KB State
    const [showAddKbModal, setShowAddKbModal] = useState(false);
    const [newQuestion, setNewQuestion] = useState('');
    const [newAnswer, setNewAnswer] = useState('');
    const [editingKbItem, setEditingKbItem] = useState(null); // { id, question, answer }

    // Blocked Numbers States
    const [blockedNumbers, setBlockedNumbers] = useState([]);
    const [loadingBlocked, setLoadingBlocked] = useState(true);
    const [blockPhoneInput, setBlockPhoneInput] = useState('');
    const [blockReasonInput, setBlockReasonInput] = useState('');
    const [blockedSearchQuery, setBlockedSearchQuery] = useState('');

    // History Tab State
    const [historySearchQuery, setHistorySearchQuery] = useState('');

    // Toast Notification
    const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
    const showToast = (message, type = 'success') => {
        setToast({ show: true, message, type });
        setTimeout(() => {
            setToast(prev => ({ ...prev, show: false }));
        }, 4500);
    };

    // 1. Sync Knowledge Base
    useEffect(() => {
        setLoadingKB(true);
        const unsubKB = onSnapshot(collection(db, 'botKnowledgeBase'), async (snap) => {
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            
            // Auto-add safety & moderation item if not already present in the list
            const hasSafetyItem = list.some(item => 
                (item.question && (item.question.includes('غير اللائقة') || item.question.includes('الشتائم') || item.question.includes('الإساءة')))
            );

            if (!hasSafetyItem) {
                try {
                    await addDoc(collection(db, 'botKnowledgeBase'), {
                        question: "التعامل مع الرسائل غير اللائقة أو الشتائم والإساءة للخدمة والكنيسة",
                        answer: "سلام ونعمة يا فندم. نرجو الالتزام باللياقة والذوق العام في التعامل. هذه القناة مخصصة لخدمة مدارس الأحد وشؤون الكنيسة بكل احترام ومحبة. تم تسجيل الرسالة وتوجيهها للإدارة. ⛪",
                        addedBy: "النظام (قواعد اللياقة والوقاية)",
                        timestamp: new Date().toISOString()
                    });
                } catch (seedErr) {
                    console.error("Error auto-seeding safety item:", seedErr);
                }
            }

            const sortedList = list.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
            setKbItems(sortedList);
            setLoadingKB(false);
        }, (err) => {
            console.error("Error loading knowledge base:", err);
            setLoadingKB(false);
        });

        return () => unsubKB();
    }, []);

    // 2. Sync All AI & Webhook Query Logs
    useEffect(() => {
        setAiQueryLogsLoading(true);
        const q = query(
            collection(db, 'webhookQueryLogs'),
            limit(300)
        );
        
        const unsub = onSnapshot(q, (snap) => {
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            const sortedList = list.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
            setAiQueryLogs(sortedList);
            setAiQueryLogsLoading(false);
        }, (error) => {
            console.error("Error loading AI query logs:", error);
            setAiQueryLogsLoading(false);
        });
        
        return () => unsub();
    }, []);

    // 3. Sync Blocked Numbers List
    useEffect(() => {
        setLoadingBlocked(true);
        const unsub = onSnapshot(collection(db, 'blockedNumbers'), (snap) => {
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            const sortedList = list.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
            setBlockedNumbers(sortedList);
            setLoadingBlocked(false);
        }, (err) => {
            console.error("Error loading blocked numbers:", err);
            setLoadingBlocked(false);
        });
        return () => unsub();
    }, []);

    // Filter Active Logs (Decoupled: Reply Review vs Issues Resolution)
    const isServiceIssue = (log) => {
        if (log.issueType === 'service_issue') return true;
        const fullContent = `${log.questionText || ''} ${log.replyText || ''} ${log.reason || ''}`.toLowerCase();
        return /حر|حرارة|تكييف|مكيف|كراسي|كرسي|قاعة|قاعه|حوش|أتوبيس|اتوبيس|باص|نظافة|نظافه|مية|مياه|أكل|اكل|وجبة|وجبه|دوشة|دوشه|مبنى|مبني|حمامات|مرافق/i.test(fullContent);
    };

    const isTechIssue = (log) => {
        if (log.issueType === 'tech_issue') return true;
        const fullContent = `${log.questionText || ''} ${log.replyText || ''} ${log.reason || ''}`.toLowerCase();
        return log.status === 'failed' ||
               log.studentCode === 'AI_FALLBACK' ||
               log.studentCode === 'AI_UNKNOWN_STUDENT' ||
               /خطأ|خطا|فشل|exception|api|timeout|عطل تقني|سيرفر|تعليق تقني|بطيء|بطيئ|بطي|تأخير في الرد/i.test(fullContent);
    };

    // Unanswered Logs: Active where reply status is NOT reviewed yet
    const unansweredReviewLogs = useMemo(() => {
        return aiQueryLogs.filter(log =>
            !log.replyReviewed &&
            !log.reviewed &&
            (log.studentCode === 'AI_UNANSWERED' || log.intent === 'unknown_question' || (log.reason && log.reason.includes('معلق')))
        );
    }, [aiQueryLogs]);

    // Answered Logs: Active where reply status is NOT reviewed yet
    const answeredReviewLogs = useMemo(() => {
        return aiQueryLogs.filter(log =>
            !log.replyReviewed &&
            !log.reviewed &&
            !(log.studentCode === 'AI_UNANSWERED' || log.intent === 'unknown_question' || (log.reason && log.reason.includes('معلق'))) &&
            !isServiceIssue(log) &&
            !isTechIssue(log)
        );
    }, [aiQueryLogs]);

    // Service Issues Logs: Active where service issue is NOT resolved yet (Decoupled from reply review!)
    const serviceIssuesReviewLogs = useMemo(() => {
        return aiQueryLogs.filter(log =>
            !log.serviceIssueResolved &&
            !log.reviewed &&
            isServiceIssue(log)
        );
    }, [aiQueryLogs]);

    // Technical Issues Logs: Active where tech issue is NOT resolved yet (Decoupled from reply review!)
    const techIssuesReviewLogs = useMemo(() => {
        return aiQueryLogs.filter(log =>
            !log.techIssueResolved &&
            !log.reviewed &&
            isTechIssue(log)
        );
    }, [aiQueryLogs]);

    const activeReviewLogsCount = useMemo(() => {
        return unansweredReviewLogs.length + answeredReviewLogs.length + serviceIssuesReviewLogs.length + techIssuesReviewLogs.length;
    }, [unansweredReviewLogs, answeredReviewLogs, serviceIssuesReviewLogs, techIssuesReviewLogs]);

    // History Archived Logs
    const historyLogs = useMemo(() => {
        return aiQueryLogs.filter(log =>
            log.reviewed === true ||
            (log.replyReviewed === true && !isServiceIssue(log) && !isTechIssue(log)) ||
            (log.serviceIssueResolved === true) ||
            (log.techIssueResolved === true)
        );
    }, [aiQueryLogs]);

    const historyUnansweredLogs = useMemo(() => {
        return historyLogs.filter(log =>
            log.replyReviewed === true &&
            (log.studentCode === 'AI_UNANSWERED' || log.intent === 'unknown_question' || (log.reason && log.reason.includes('معلق')))
        );
    }, [historyLogs]);

    const historyAnsweredLogs = useMemo(() => {
        return historyLogs.filter(log =>
            log.replyReviewed === true &&
            !(log.studentCode === 'AI_UNANSWERED' || log.intent === 'unknown_question' || (log.reason && log.reason.includes('معلق'))) &&
            !isServiceIssue(log) &&
            !isTechIssue(log)
        );
    }, [historyLogs]);

    const historyServiceIssuesLogs = useMemo(() => {
        return historyLogs.filter(log =>
            log.serviceIssueResolved === true || (log.reviewedStatus === 'resolved_service_issue' && isServiceIssue(log))
        );
    }, [historyLogs]);

    const historyTechIssuesLogs = useMemo(() => {
        return historyLogs.filter(log =>
            log.techIssueResolved === true || (log.reviewedStatus === 'resolved_tech_issue' && isTechIssue(log))
        );
    }, [historyLogs]);

    const currentHistoryList = useMemo(() => {
        let baseList = historyLogs;
        if (historySection === 'unanswered') baseList = historyUnansweredLogs;
        else if (historySection === 'answered') baseList = historyAnsweredLogs;
        else if (historySection === 'service_issues') baseList = historyServiceIssuesLogs;
        else if (historySection === 'tech_issues') baseList = historyTechIssuesLogs;

        if (!historySearchQuery.trim()) return baseList;
        const q = historySearchQuery.trim().toLowerCase();
        return baseList.filter(log =>
            (log.questionText && log.questionText.toLowerCase().includes(q)) ||
            (log.replyText && log.replyText.toLowerCase().includes(q)) ||
            (log.correction && log.correction.toLowerCase().includes(q)) ||
            (log.senderPhone && log.senderPhone.includes(q)) ||
            (log.senderInfo && log.senderInfo.toLowerCase().includes(q))
        );
    }, [historyLogs, historyUnansweredLogs, historyAnsweredLogs, historyServiceIssuesLogs, historyTechIssuesLogs, historySection, historySearchQuery]);

    // 1-Click Action Handlers
    const handleDirectApproveAnswer = async (log) => {
        try {
            await updateDoc(doc(db, 'webhookQueryLogs', log.id), {
                replyReviewed: true,
                replyReviewedStatus: 'approved',
                replyReviewedBy: servant?.name || 'خادم',
                replyReviewedAt: new Date().toISOString(),
                reviewed: (!isServiceIssue(log) && !isTechIssue(log))
            });

            showToast("تم اعتماد الإجابة وتدريب البوت بنجاح! 📜✅", "success");
        } catch (err) {
            console.error("Error approving answer:", err);
            showToast("حدث خطأ أثناء اعتماد الإجابة", "error");
        }
    };

    const handleResolveServiceIssue = async (logId) => {
        try {
            await updateDoc(doc(db, 'webhookQueryLogs', logId), {
                serviceIssueResolved: true,
                serviceResolvedBy: servant?.name || 'خادم',
                serviceResolvedAt: new Date().toISOString(),
                reviewedStatus: 'resolved_service_issue',
                reviewed: true
            });
            showToast("تم حسم مشكلة الخدمة كـ 'تم الحل بالخدمة بنجاح' ونقلها للأرشيف! ⛪✅", "success");
        } catch (err) {
            console.error("Error resolving service issue:", err);
            showToast("حدث خطأ أثناء تحديث حالة مشكلة الخدمة", "error");
        }
    };

    const handleResolveTechIssue = async (logId) => {
        try {
            await updateDoc(doc(db, 'webhookQueryLogs', logId), {
                techIssueResolved: true,
                techResolvedBy: servant?.name || 'خادم',
                techResolvedAt: new Date().toISOString(),
                reviewedStatus: 'resolved_tech_issue',
                reviewed: true
            });
            showToast("تم حسم المشكلة التقنية كـ 'تم الإصلاح التقني بنجاح' ونقلها للأرشيف! 💻✅", "success");
        } catch (err) {
            console.error("Error resolving tech issue:", err);
            showToast("حدث خطأ أثناء تحديث حالة المشكلة التقنية", "error");
        }
    };

    const handleRestoreLogToActive = async (logId) => {
        try {
            await updateDoc(doc(db, 'webhookQueryLogs', logId), {
                reviewed: false,
                replyReviewed: false,
                serviceIssueResolved: false,
                techIssueResolved: false,
                reviewedStatus: null
            });
            showToast("تم إرجاع الرسالة إلى قائمة المراجعة النشطة بنجاح! 🔄", "success");
        } catch (err) {
            console.error("Error restoring log to active review:", err);
            showToast("حدث خطأ أثناء إرجاع الرسالة للمراجعة", "error");
        }
    };

    const handleDirectCorrectAnswer = async (log) => {
        const correctedText = aiAnswers[log.id]?.trim();
        if (!correctedText) {
            showToast("برجاء كتابة التعديل أولاً في الخانة المخصصة! ⚠️", "error");
            return;
        }

        try {
            const questionText = formatQuestionText(log);
            await addDoc(collection(db, 'botKnowledgeBase'), {
                question: questionText,
                answer: correctedText,
                addedBy: servant?.name || 'خادم',
                timestamp: new Date().toISOString()
            });

            await updateDoc(doc(db, 'webhookQueryLogs', log.id), {
                replyReviewed: true,
                replyReviewedStatus: 'corrected',
                correction: correctedText,
                replyReviewedBy: servant?.name || 'خادم',
                replyReviewedAt: new Date().toISOString(),
                reviewed: (!isServiceIssue(log) && !isTechIssue(log))
            });

            setAiAnswers(prev => {
                const copy = { ...prev };
                delete copy[log.id];
                return copy;
            });

            showToast("تم حفظ التصحيح وتدريب البوت بنجاح! 🧠✨", "success");
        } catch (err) {
            console.error("Error updating AI answer:", err);
            showToast("حدث خطأ أثناء حفظ التصحيح", "error");
        }
    };

    const handleDirectFeedUnanswered = async (log) => {
        const typedAnswer = aiAnswers[log.id]?.trim();
        const answerText = typedAnswer || formatReplyText(log);

        if (!answerText || !answerText.trim()) {
            showToast("برجاء كتابة الإجابة المعتمدة لتغذية البوت! ⚠️", "error");
            return;
        }

        try {
            const questionText = formatQuestionText(log);
            await addDoc(collection(db, 'botKnowledgeBase'), {
                question: questionText,
                answer: answerText,
                addedBy: servant?.name || 'خادم',
                timestamp: new Date().toISOString()
            });

            await updateDoc(doc(db, 'webhookQueryLogs', log.id), {
                replyReviewed: true,
                replyReviewedStatus: 'corrected',
                correction: answerText,
                replyReviewedBy: servant?.name || 'خادم',
                replyReviewedAt: new Date().toISOString(),
                reviewed: (!isServiceIssue(log) && !isTechIssue(log))
            });

            setAiAnswers(prev => {
                const copy = { ...prev };
                delete copy[log.id];
                return copy;
            });

            showToast("تمت تغذية البوت بالرد وتدريبه بنجاح! (ستظل قائمة المشاكل معلقة لحين ضغط تم حل المشكلة) 🤖✨", "success");
        } catch (err) {
            console.error("Error feeding bot from review:", err);
            showToast("حدث خطأ أثناء حفظ الإجابة سحابياً", "error");
        }
    };

    // Link Question to Existing KB Answer
    const handleLinkToExistingKB = async (log) => {
        const selectedKbId = selectedKbForLog[log.id];
        const selectedKb = kbItems.find(item => item.id === selectedKbId);

        if (!selectedKb) {
            showToast("برجاء اختيار المعلومة المسجلة من القائمة أولاً! ⚠️", "error");
            return;
        }

        try {
            const questionText = formatQuestionText(log);
            await addDoc(collection(db, 'botKnowledgeBase'), {
                question: questionText,
                answer: selectedKb.answer,
                linkedToId: selectedKb.id,
                addedBy: servant?.name || 'خادم',
                timestamp: new Date().toISOString()
            });

            await updateDoc(doc(db, 'webhookQueryLogs', log.id), {
                replyReviewed: true,
                replyReviewedStatus: 'approved',
                correction: selectedKb.answer,
                replyReviewedBy: servant?.name || 'خادم',
                replyReviewedAt: new Date().toISOString(),
                reviewed: (!isServiceIssue(log) && !isTechIssue(log))
            });

            setShowKbLinkDropdown(prev => ({ ...prev, [log.id]: false }));
            showToast(`تم ربط السؤال بالمعلومة المسجلة (${selectedKb.question}) وتدريب البوت بنجاح! 🔗✨`, "success");
        } catch (err) {
            console.error("Error linking to existing KB:", err);
            showToast("حدث خطأ أثناء ربط السؤال بالإجابة المسجلة", "error");
        }
    };

    const handleDeleteKBItem = async (itemId) => {
        if (!window.confirm("هل أنت متأكد من حذف هذه المعلومة من قاعدة معرفة البوت؟")) return;
        try {
            await deleteDoc(doc(db, 'botKnowledgeBase', itemId));
            showToast("تم حذف المعلومة بنجاح من قاعدة المعرفة 🗑️", "success");
        } catch (err) {
            console.error("Error deleting KB item:", err);
            showToast("حدث خطأ أثناء حذف المعلومة", "error");
        }
    };

    const handleDeleteHistoryLog = async (logId) => {
        if (!window.confirm("هل أنت متأكد من حذف هذه الرسالة نهائياً لإخلاء المساحة؟")) return;
        try {
            await deleteDoc(doc(db, 'webhookQueryLogs', logId));
            showToast("تم مسح الرسالة بنجاح وإخلاء مساحتها! 🗑️", "success");
        } catch (err) {
            console.error("Error deleting log:", err);
            showToast("حدث خطأ أثناء مسح السجل", "error");
        }
    };

    const handleEditHistoryItem = async (logId, questionText, currentAnswer) => {
        const newAnswer = window.prompt("تعديل الإجابة أو التصحيح المعتمد في السجل:", currentAnswer);
        if (!newAnswer || !newAnswer.trim()) return;

        try {
            await updateDoc(doc(db, 'webhookQueryLogs', logId), {
                correction: newAnswer.trim(),
                reviewedStatus: 'corrected',
                reviewedBy: servant?.name || 'خادم',
                reviewedAt: new Date().toISOString()
            });

            await addDoc(collection(db, 'botKnowledgeBase'), {
                question: questionText,
                answer: newAnswer.trim(),
                addedBy: servant?.name || 'خادم',
                timestamp: new Date().toISOString()
            });

            showToast("تم تحديث الإجابة وتدريب البوت بها بنجاح! 🧠✨", "success");
        } catch (err) {
            console.error("Error editing history item:", err);
            showToast("حدث خطأ أثناء التعديل", "error");
        }
    };

    const handleAddDirectKB = async (e) => {
        e.preventDefault();
        if (!newQuestion.trim() || !newAnswer.trim()) {
            showToast("برجاء إدخال السؤال والإجابة كلاهما! ⚠️", "error");
            return;
        }

        try {
            await addDoc(collection(db, 'botKnowledgeBase'), {
                question: newQuestion.trim(),
                answer: newAnswer.trim(),
                addedBy: servant?.name || 'خادم',
                timestamp: new Date().toISOString()
            });

            setNewQuestion('');
            setNewAnswer('');
            setShowAddKbModal(false);
            showToast("تم إضافة المعلومة الجديدة لقاعدة معرفة البوت بنجاح! 🧠✨", "success");
        } catch (err) {
            console.error("Error adding direct KB item:", err);
            showToast("حدث خطأ أثناء إضافة المعلومة لقاعدة المعرفة", "error");
        }
    };

    const handleUpdateKBItem = async (e) => {
        e.preventDefault();
        if (!editingKbItem || !editingKbItem.question.trim() || !editingKbItem.answer.trim()) {
            showToast("برجاء إدخال السؤال والإجابة كلاهما! ⚠️", "error");
            return;
        }

        try {
            await updateDoc(doc(db, 'botKnowledgeBase', editingKbItem.id), {
                question: editingKbItem.question.trim(),
                answer: editingKbItem.answer.trim(),
                updatedBy: servant?.name || 'خادم',
                updatedAt: new Date().toISOString()
            });

            setEditingKbItem(null);
            showToast("تم تعديل المعلومة بنجاح في قاعدة معرفة البوت! 🧠✨", "success");
        } catch (err) {
            console.error("Error updating KB item:", err);
            showToast("حدث خطأ أثناء تعديل المعلومة", "error");
        }
    };

    const formatQuestionText = (log) => {
        if (log.questionText && log.questionText.trim()) {
            return log.questionText.trim();
        }
        if (log.studentCode === 'SERVANT_QUERY') {
            return 'طلب تقرير حضور ونقاط الفصل (خاص بالخدام)';
        }
        if (log.studentCode === 'AI_GENERAL') {
            return 'استفسار عام عن مواعيد أو خدمات الكنيسة';
        }
        if (log.studentCode === 'AI_UNANSWERED') {
            return 'سؤال معلق لم يجد البوت إجابة له';
        }
        if (log.studentCode && log.studentCode !== 'null') {
            return `استعلام عن المخدوم كود (${log.studentCode})`;
        }
        return 'استفسار غير معنون من المستخدم';
    };

    const formatReplyText = (log) => {
        let raw = log.replyText || log.reason || '';
        if (!raw || !raw.trim()) return 'تم معالجة واستلام التقرير بنجاح';
        
        if (raw.includes('"reply"')) {
            const match = raw.match(/"reply"\s*:\s*"([\s\S]*?)"/i);
            if (match && match[1]) {
                return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
            }
        }

        const sanitized = raw
            .replace(/\{\s*"intent"[\s\S]*?"reply"\s*:\s*"/gi, '')
            .replace(/"\s*\}\s*$/gi, '')
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();

        return sanitized || 'تم معالجة واستلام التقرير بنجاح';
    };

    const handleAddBlockedNumber = async (e) => {
        e.preventDefault();
        const phoneClean = blockPhoneInput.trim().replace(/\D/g, '');
        if (!phoneClean || phoneClean.length < 8) {
            showToast("برجاء كتابة رقم هاتف صحيح للحظر! ⚠️", "error");
            return;
        }

        try {
            await addDoc(collection(db, 'blockedNumbers'), {
                phone: blockPhoneInput.trim(),
                cleanPhone: phoneClean,
                reason: blockReasonInput.trim() || 'إزعاج / غير مرغوب فيه',
                blockedBy: servant?.name || 'خادم',
                timestamp: new Date().toISOString()
            });

            setBlockPhoneInput('');
            setBlockReasonInput('');
            showToast("تم حظر الرقم بنجاح وإضافته للقائمة السوداء! 🚫", "success");
        } catch (err) {
            console.error("Error blocking number:", err);
            showToast("حدث خطأ أثناء حظر الرقم", "error");
        }
    };

    const handleUnblockNumber = async (docId, phone) => {
        if (!window.confirm(`هل أنت متأكد من إلغاء حظر الرقم (${phone})؟`)) return;
        try {
            await deleteDoc(doc(db, 'blockedNumbers', docId));
            showToast("تم إلغاء حظر الرقم بنجاح! 🔓", "success");
        } catch (err) {
            console.error("Error unblocking number:", err);
            showToast("حدث خطأ أثناء إلغاء الحظر", "error");
        }
    };

    const filteredBlockedNumbers = useMemo(() => {
        if (!blockedSearchQuery.trim()) return blockedNumbers;
        const q = blockedSearchQuery.trim().toLowerCase();
        return blockedNumbers.filter(b => 
            (b.phone && b.phone.includes(q)) || 
            (b.reason && b.reason.toLowerCase().includes(q)) ||
            (b.blockedBy && b.blockedBy.toLowerCase().includes(q))
        );
    }, [blockedNumbers, blockedSearchQuery]);

    return (
        <div className="min-h-screen p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6" dir="rtl">
            {/* Toast Notification */}
            {toast.show && (
                <div className={`fixed bottom-5 left-5 z-50 px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 text-sm font-bold animate-in slide-in-from-bottom-5 duration-300 ${
                    toast.type === 'error'
                        ? 'bg-red-600 text-white'
                        : 'bg-emerald-600 text-white'
                }`}>
                    {toast.type === 'error' ? <AlertCircle size={18} /> : <Check size={18} />}
                    <span>{toast.message}</span>
                </div>
            )}

            {/* Header Banner */}
            <div className="bg-white dark:bg-[#1e293b] p-6 sm:p-8 rounded-3xl border border-slate-150 dark:border-slate-800/80 shadow-lg">
                <div className="flex items-center gap-3">
                    <div className="p-3.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-2xl">
                        <Sparkles className="animate-pulse" size={28} />
                    </div>
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-black text-slate-850 dark:text-slate-100 tracking-tight">
                            عقل الذكاء الاصطناعي وحلقة التعلم المستمر
                        </h1>
                        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 font-bold">
                            راجع استفسارات الـ AI، وإصلاح مشاكل الخدمة الميدانية والتقنية، وإمكانية إرجاع أو سحب الرسائل من السجل وإعادة حسمها بسهولة!
                        </p>
                    </div>
                </div>
            </div>

            {/* Sub-Tabs Navigation Header */}
            <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2 overflow-x-auto whitespace-nowrap scrollbar-none pb-1">
                <button
                    onClick={() => setSubTab('review')}
                    className={`py-3 px-5 font-extrabold text-sm border-b-2 transition-all cursor-pointer bg-transparent border-none flex items-center gap-2 flex-shrink-0 ${
                        subTab === 'review'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-black'
                        : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-350'
                    }`}
                >
                    <MessageSquare size={18} className="text-indigo-600" />
                    <span>مراجعة وتصحيح استفسارات الـ AI النشطة</span>
                    {activeReviewLogsCount > 0 && (
                        <span className="bg-indigo-600 text-white text-xs px-2.5 py-0.5 rounded-full font-black animate-pulse">
                            {activeReviewLogsCount}
                        </span>
                    )}
                </button>

                <button
                    onClick={() => setSubTab('kb')}
                    className={`py-3 px-5 font-extrabold text-sm border-b-2 transition-all cursor-pointer bg-transparent border-none flex items-center gap-2 flex-shrink-0 ${
                        subTab === 'kb'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-black'
                        : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-350'
                    }`}
                >
                    <List size={18} className="text-indigo-600" />
                    <span>قاعدة المعرفة الرسمية للبوت</span>
                    <span className="bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 text-xs px-2.5 py-0.5 rounded-full font-black border border-indigo-200 dark:border-indigo-800">
                        {kbItems.length}
                    </span>
                </button>

                <button
                    onClick={() => setSubTab('history')}
                    className={`py-3 px-5 font-extrabold text-sm border-b-2 transition-all cursor-pointer bg-transparent border-none flex items-center gap-2 flex-shrink-0 ${
                        subTab === 'history'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 font-black'
                        : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-350'
                    }`}
                >
                    <History size={18} className="text-emerald-600 dark:text-emerald-400" />
                    <span>📜 السجل المعتمد والأرشيف</span>
                    {historyLogs.length > 0 && (
                        <span className="bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 text-xs px-2.5 py-0.5 rounded-full font-black border border-emerald-200 dark:border-emerald-800">
                            {historyLogs.length}
                        </span>
                    )}
                </button>

                <button
                    onClick={() => setSubTab('blocked')}
                    className={`py-3 px-5 font-extrabold text-sm border-b-2 transition-all cursor-pointer bg-transparent border-none flex items-center gap-2 flex-shrink-0 ${
                        subTab === 'blocked'
                        ? 'border-rose-600 text-rose-600 dark:text-rose-400 font-black'
                        : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-350'
                    }`}
                >
                    <Ban size={18} className={subTab === 'blocked' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'} />
                    <span>🚫 حظر الأرقام</span>
                    {blockedNumbers.length > 0 && (
                        <span className="bg-rose-500 text-white text-xs px-2.5 py-0.5 rounded-full font-black">
                            {blockedNumbers.length}
                        </span>
                    )}
                </button>
            </div>

            {/* Tab 1: Active Answered, Unanswered, Service Issues, and Tech Issues AI Review */}
            {subTab === 'review' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="bg-white dark:bg-[#1e293b] p-6 sm:p-8 rounded-3xl border border-slate-150 dark:border-slate-800/80 shadow-md space-y-6">
                        <div>
                            <h3 className="text-lg font-black text-slate-850 dark:text-slate-100 flex items-center gap-2">
                                <MessageSquare className="text-indigo-600" size={22} /> مراجعة وتصحيح استفسارات الـ AI النشطة ({activeReviewLogsCount})
                            </h3>
                            <p className="text-xs text-slate-400 dark:text-slate-500 font-bold mt-1">
                                تم فصل حسم الإجابة وتدريب البوت عن حسم المشاكل الميدانية والتقنية، لكي تظل المشاكل قائمة وحية حتى يضغط المسؤول "تم حل المشكلة"!
                            </p>
                        </div>

                        {/* Four Sub-Sections Filter Pills */}
                        <div className="flex gap-3 border-b border-slate-100 dark:border-slate-800 pb-3 flex-wrap">
                            <button
                                onClick={() => setReviewSection('unanswered')}
                                className={`px-4 py-2.5 rounded-2xl text-xs font-black transition-all cursor-pointer border flex items-center gap-2 active:scale-95 ${
                                    reviewSection === 'unanswered'
                                        ? 'bg-orange-500 text-white border-orange-500 shadow-md shadow-orange-500/20'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
                                }`}
                            >
                                <Clock size={16} />
                                🔴 الأسئلة المعلقة
                                {unansweredReviewLogs.length > 0 && (
                                    <span className="bg-white text-orange-600 text-[11px] px-2 py-0.5 rounded-full font-black">
                                        {unansweredReviewLogs.length}
                                    </span>
                                )}
                            </button>

                            <button
                                onClick={() => setReviewSection('answered')}
                                className={`px-4 py-2.5 rounded-2xl text-xs font-black transition-all cursor-pointer border flex items-center gap-2 active:scale-95 ${
                                    reviewSection === 'answered'
                                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
                                }`}
                            >
                                <CheckCircle2 size={16} />
                                🟢 الاستفسارات المجابة
                                {answeredReviewLogs.length > 0 && (
                                    <span className="bg-white text-indigo-600 text-[11px] px-2 py-0.5 rounded-full font-black">
                                        {answeredReviewLogs.length}
                                    </span>
                                )}
                            </button>

                            <button
                                onClick={() => setReviewSection('service_issues')}
                                className={`px-4 py-2.5 rounded-2xl text-xs font-black transition-all cursor-pointer border flex items-center gap-2 active:scale-95 ${
                                    reviewSection === 'service_issues'
                                        ? 'bg-amber-600 text-white border-amber-600 shadow-md shadow-amber-600/20'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
                                }`}
                            >
                                <Building2 size={16} />
                                ⛪ مشاكل وشكاوى الخدمة
                                {serviceIssuesReviewLogs.length > 0 && (
                                    <span className="bg-white text-amber-700 text-[11px] px-2 py-0.5 rounded-full font-black animate-pulse">
                                        {serviceIssuesReviewLogs.length}
                                    </span>
                                )}
                            </button>

                            <button
                                onClick={() => setReviewSection('tech_issues')}
                                className={`px-4 py-2.5 rounded-2xl text-xs font-black transition-all cursor-pointer border flex items-center gap-2 active:scale-95 ${
                                    reviewSection === 'tech_issues'
                                        ? 'bg-rose-600 text-white border-rose-600 shadow-md shadow-rose-600/20'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
                                }`}
                            >
                                <Laptop size={16} />
                                💻 المشاكل والأخطاء التقنية
                                {techIssuesReviewLogs.length > 0 && (
                                    <span className="bg-white text-rose-600 text-[11px] px-2 py-0.5 rounded-full font-black animate-pulse">
                                        {techIssuesReviewLogs.length}
                                    </span>
                                )}
                            </button>
                        </div>

                        {/* SECTION 1: UNANSWERED LOGS */}
                        {reviewSection === 'unanswered' && (
                            <div className="space-y-4">
                                {aiQueryLogsLoading ? (
                                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                                        <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                                        <span className="text-sm text-slate-400 font-bold">جاري تحميل الأسئلة المعلقة...</span>
                                    </div>
                                ) : unansweredReviewLogs.length === 0 ? (
                                    <div className="text-center py-16 space-y-3">
                                        <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-950/30 rounded-full flex items-center justify-center mx-auto text-emerald-500">
                                            <Check size={32} />
                                        </div>
                                        <h4 className="text-base font-black text-slate-700 dark:text-slate-200">ممتاز! لا توجد أسئلة معلقة حالياً</h4>
                                        <p className="text-xs text-slate-400 dark:text-slate-500 font-bold max-w-md mx-auto">
                                            جميع استفسارات الأهالي سألها البوت ووجد إجابتها أو تمت تغذيتها بها بنجاح.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {unansweredReviewLogs.map((log) => (
                                            <div key={log.id} className="p-5 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-orange-200/80 dark:border-orange-950/50 space-y-3.5 shadow-sm flex flex-col justify-between transition-all hover:border-orange-400">
                                                <div className="space-y-2.5">
                                                    <div className="flex justify-between items-start gap-2">
                                                        <div>
                                                            <div className="text-xs font-black text-slate-800 dark:text-slate-200">
                                                                📞 {log.senderPhone}
                                                            </div>
                                                            <div className="text-[11px] text-blue-600 dark:text-blue-400 font-bold mt-0.5">
                                                                👤 {log.senderInfo || 'غير مسجل'}
                                                            </div>
                                                        </div>
                                                        <span className="text-[10px] text-slate-400 font-bold">
                                                            {log.timestamp ? new Date(log.timestamp).toLocaleString('ar-EG', { hour12: true }) : ''}
                                                        </span>
                                                    </div>

                                                    <div className="p-3.5 bg-white dark:bg-[#1e293b] rounded-xl border border-slate-200/70 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 font-bold whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed shadow-inner">
                                                        <span className="text-orange-500 font-black block mb-1">❓ السؤال المعلق:</span> "{formatQuestionText(log)}"
                                                    </div>

                                                    <div className="p-3.5 bg-orange-50/50 dark:bg-orange-950/20 rounded-xl border border-orange-100 dark:border-orange-900/30 text-xs text-slate-700 dark:text-orange-200 font-bold whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed italic">
                                                        <span className="text-orange-600 dark:text-orange-400 font-black block mb-1">🤖 رد الاعتذار المبدئي للبوت:</span> {formatReplyText(log)}
                                                    </div>
                                                </div>

                                                <div className="space-y-3 pt-2 border-t border-dashed border-slate-200 dark:border-slate-800">
                                                    <div className="space-y-2">
                                                        <label className="block text-[11px] font-black text-slate-600 dark:text-slate-400">الخيار 1: اكتب إجابة جديدة لتغذية عقل البوت:</label>
                                                        <textarea
                                                            placeholder="اكتب هنا الإجابة التفصيلية الرسمية لتغذية عقل البوت..."
                                                            value={aiAnswers[log.id] || ''}
                                                            onChange={(e) => setAiAnswers(prev => ({ ...prev, [log.id]: e.target.value }))}
                                                            rows={2}
                                                            className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-semibold text-xs text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-orange-500/40 resize-none"
                                                        />
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => handleDirectFeedUnanswered(log)}
                                                                className="flex-1 py-2.5 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-black rounded-xl border-none cursor-pointer text-xs transition-all flex items-center justify-center gap-2 shadow-md shadow-orange-500/10 active:scale-98"
                                                            >
                                                                <Sparkles size={15} />
                                                                تلقين واعتماد 🤖✨
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteHistoryLog(log.id)}
                                                                className="px-3.5 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-955/40 dark:hover:bg-rose-900/60 dark:text-rose-400 font-bold rounded-xl border border-rose-200 dark:border-rose-900/40 text-xs cursor-pointer transition-all flex items-center justify-center gap-1.5 active:scale-95"
                                                                title="تجاهل أو حذف هذا السؤال"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60">
                                                        <button
                                                            onClick={() => setShowKbLinkDropdown(prev => ({ ...prev, [log.id]: !prev[log.id] }))}
                                                            className="text-xs font-black text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer bg-transparent border-none flex items-center gap-1.5"
                                                        >
                                                            <LinkIcon size={14} />
                                                            {showKbLinkDropdown[log.id] ? 'إغلاق ربط المعلومة' : '🔗 الإجابة متسجلة قبل كده؟ اضغط لربطها لمعلومة قديمة'}
                                                        </button>

                                                        {showKbLinkDropdown[log.id] && (
                                                            <div className="mt-2.5 p-3 bg-indigo-50/50 dark:bg-indigo-950/30 rounded-xl border border-indigo-150 dark:border-indigo-900/40 space-y-2 animate-in fade-in duration-200">
                                                                <label className="block text-[11px] font-black text-indigo-900 dark:text-indigo-200">اختر المعلومة المسجلة مسبقاً لربطها بهذا السؤال:</label>
                                                                <select
                                                                    value={selectedKbForLog[log.id] || ''}
                                                                    onChange={(e) => setSelectedKbForLog(prev => ({ ...prev, [log.id]: e.target.value }))}
                                                                    className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500/40"
                                                                >
                                                                    <option value="">-- اختر الإجابة المسجلة من قاعدة المعرفة --</option>
                                                                    {kbItems.map(item => (
                                                                        <option key={item.id} value={item.id}>
                                                                            ❓ {item.question.slice(0, 40)}... (💡 {item.answer.slice(0, 40)}...)
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                                <button
                                                                    onClick={() => handleLinkToExistingKB(log)}
                                                                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-lg text-xs transition-all border-none cursor-pointer flex items-center justify-center gap-1.5 active:scale-98 shadow-sm"
                                                                >
                                                                    <LinkIcon size={14} />
                                                                    تأكيد ربط السؤال وتدريب البوت 🔗✨
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* SECTION 2: ANSWERED LOGS */}
                        {reviewSection === 'answered' && (
                            <div className="space-y-4">
                                {aiQueryLogsLoading ? (
                                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                                        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                                        <span className="text-sm text-slate-400 font-bold">جاري تحميل الاستفسارات المجابة...</span>
                                    </div>
                                ) : answeredReviewLogs.length === 0 ? (
                                    <div className="text-center py-16 space-y-3">
                                        <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-950/30 rounded-full flex items-center justify-center mx-auto text-emerald-500">
                                            <CheckCircle2 size={32} />
                                        </div>
                                        <h4 className="text-base font-black text-slate-700 dark:text-slate-200">ممتاز! تم مراجعة كافة الاستفسارات المجابة</h4>
                                        <p className="text-xs text-slate-400 dark:text-slate-500 font-bold max-w-md mx-auto">
                                            جميع الردود السابقة تم اعتمادها أو تصحيحها وهي محفوظة الآن في تبويب "📜 السجل المعتمد".
                                        </p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {answeredReviewLogs.map((log) => (
                                            <div key={log.id} className="p-5 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3.5 shadow-sm flex flex-col justify-between transition-all hover:border-indigo-300 dark:hover:border-indigo-800">
                                                <div className="space-y-2.5">
                                                    <div className="flex justify-between items-start gap-2">
                                                        <div>
                                                            <div className="text-xs font-black text-slate-800 dark:text-slate-200">
                                                                📞 {log.senderPhone}
                                                            </div>
                                                            <div className="text-[11px] text-blue-600 dark:text-blue-400 font-bold mt-0.5">
                                                                👤 {log.senderInfo || 'غير مسجل'}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] text-slate-400 font-bold">
                                                                {log.timestamp ? new Date(log.timestamp).toLocaleString('ar-EG', { hour12: true }) : ''}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div className="p-3.5 bg-white dark:bg-[#1e293b] rounded-xl border border-slate-200/70 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 font-bold whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed shadow-inner">
                                                        <span className="text-orange-500 font-black block mb-1">❓ السؤال:</span> "{formatQuestionText(log)}"
                                                    </div>

                                                    <div className="p-3.5 bg-indigo-50/40 dark:bg-indigo-950/20 rounded-xl border border-indigo-100/70 dark:border-indigo-900/40 text-xs text-slate-800 dark:text-indigo-200 font-bold whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed shadow-inner">
                                                        <span className="text-indigo-600 dark:text-indigo-400 font-black block mb-1">🤖 إجابة البوت:</span> {formatReplyText(log)}
                                                    </div>
                                                </div>

                                                <div className="space-y-2 pt-2 border-t border-dashed border-slate-200 dark:border-slate-800">
                                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                                        <label className="block text-[11px] font-black text-slate-600 dark:text-slate-400">هل الرد صحيح أم يحتاج لتعديل؟</label>
                                                        <div className="flex items-center gap-1.5">
                                                            <button
                                                                onClick={() => handleDirectApproveAnswer(log)}
                                                                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl border-none cursor-pointer text-xs transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
                                                                title="اعتماد الإجابة كصحيحة ونقل الرسالة لتبويب السجل"
                                                            >
                                                                <CheckCircle size={14} />
                                                                إجابة صحيحة ✅
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteHistoryLog(log.id)}
                                                                className="p-1.5 bg-slate-200 hover:bg-rose-100 text-slate-600 hover:text-rose-600 dark:bg-slate-800 dark:hover:bg-rose-955/40 dark:text-slate-300 dark:hover:text-rose-400 font-bold rounded-xl border-none cursor-pointer text-xs transition-all flex items-center gap-1 active:scale-95"
                                                                title="حذف أو تجاهل هذه الرسالة من المراجعة"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="flex gap-2">
                                                        <input
                                                            type="text"
                                                            placeholder="اكتب التعديل فقط إن كانت الإجابة غير دقيقة..."
                                                            value={aiAnswers[log.id] || ''}
                                                            onChange={(e) => setAiAnswers(prev => ({ ...prev, [log.id]: e.target.value }))}
                                                            className="w-full px-3.5 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-semibold text-xs text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500/40"
                                                        />
                                                        <button
                                                            onClick={() => handleDirectCorrectAnswer(log)}
                                                            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 dark:bg-indigo-600 dark:hover:bg-indigo-700 text-white font-black rounded-xl border-none cursor-pointer text-xs transition-all flex items-center gap-1.5 shrink-0 active:scale-95"
                                                        >
                                                            <Sparkles size={13} />
                                                            حفظ التصحيح ✍️
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* SECTION 3: SERVICE & FIELD ISSUES LOGS */}
                        {reviewSection === 'service_issues' && (
                            <div className="space-y-4">
                                {aiQueryLogsLoading ? (
                                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                                        <div className="w-10 h-10 border-4 border-amber-600 border-t-transparent rounded-full animate-spin"></div>
                                        <span className="text-sm text-slate-400 font-bold">جاري تحميل مشاكل وشكاوى الخدمة الميدانية...</span>
                                    </div>
                                ) : serviceIssuesReviewLogs.length === 0 ? (
                                    <div className="text-center py-16 space-y-3">
                                        <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-950/30 rounded-full flex items-center justify-center mx-auto text-emerald-500">
                                            <Building2 size={32} />
                                        </div>
                                        <h4 className="text-base font-black text-slate-700 dark:text-slate-200">الخدمة تسير بانتظام 100%! لا توجد شكاوى ميدانية معلقة</h4>
                                        <p className="text-xs text-slate-400 dark:text-slate-500 font-bold max-w-md mx-auto">
                                            لم يتم رصد أي ملاحظات أو شكاوى خاصة بالمبنى أو التكييفات أو القاعات أو المواصلات.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {serviceIssuesReviewLogs.map((log) => (
                                            <div key={log.id} className="p-5 bg-amber-50/40 dark:bg-amber-955/20 rounded-2xl border border-amber-200 dark:border-amber-900/40 space-y-3.5 shadow-sm flex flex-col justify-between transition-all hover:border-amber-400">
                                                <div className="space-y-2.5">
                                                    <div className="flex justify-between items-start gap-2">
                                                        <div>
                                                            <div className="text-xs font-black text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                                                                <Building2 size={15} /> 📞 {log.senderPhone}
                                                            </div>
                                                            <div className="text-[11px] text-blue-600 dark:text-blue-400 font-bold mt-0.5">
                                                                👤 {log.senderInfo || 'غير مسجل'}
                                                            </div>
                                                        </div>
                                                        <span className="text-[10px] text-slate-400 font-bold">
                                                            {log.timestamp ? new Date(log.timestamp).toLocaleString('ar-EG', { hour12: true }) : ''}
                                                        </span>
                                                    </div>

                                                    <div className="p-3.5 bg-white dark:bg-[#1e293b] rounded-xl border border-slate-200/70 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 font-bold whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed shadow-inner">
                                                        <span className="text-amber-600 dark:text-amber-400 font-black block mb-1">⛪ شكوى / ملاحظة الخدمة الميدانية:</span> "{formatQuestionText(log)}"
                                                    </div>

                                                    <div className="p-3.5 bg-amber-100/60 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-900/50 text-xs text-amber-900 dark:text-amber-200 font-bold whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed shadow-inner">
                                                        <span className="text-amber-700 dark:text-amber-400 font-black block mb-1">🤖 الرد المبدئي للبوت / السبب:</span> {log.replyText || log.reason || 'تم استلام الشكوى وتوجيهها لأمين الخدمة'}
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between gap-2 pt-2 border-t border-dashed border-amber-200 dark:border-amber-900/40">
                                                    <span className="text-[10px] text-slate-400 font-bold">حالة الملاحظة: قيد المتابعة الميدانية</span>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => handleResolveServiceIssue(log.id)}
                                                            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl border-none cursor-pointer text-xs transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
                                                            title="علم شكوى الخدمة كـ تم الحل بنجاح"
                                                        >
                                                            <Wrench size={14} />
                                                            تم حل المشكلة بالخدمة ✅
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteHistoryLog(log.id)}
                                                            className="p-1.5 bg-slate-200 hover:bg-rose-100 text-slate-600 hover:text-rose-600 dark:bg-slate-800 dark:hover:bg-rose-955/40 dark:text-slate-300 dark:hover:text-rose-400 font-bold rounded-xl border-none cursor-pointer text-xs transition-all flex items-center gap-1 active:scale-95"
                                                            title="حذف هذه الشكوى"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* SECTION 4: TECHNICAL & SYSTEM ISSUES LOGS */}
                        {reviewSection === 'tech_issues' && (
                            <div className="space-y-4">
                                {aiQueryLogsLoading ? (
                                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                                        <div className="w-10 h-10 border-4 border-rose-600 border-t-transparent rounded-full animate-spin"></div>
                                        <span className="text-sm text-slate-400 font-bold">جاري تحميل مشاكل النظام التقنية...</span>
                                    </div>
                                ) : techIssuesReviewLogs.length === 0 ? (
                                    <div className="text-center py-16 space-y-3">
                                        <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-950/30 rounded-full flex items-center justify-center mx-auto text-emerald-500">
                                            <Laptop size={32} />
                                        </div>
                                        <h4 className="text-base font-black text-slate-700 dark:text-slate-200">السيستم والسيرفر يعملان بكفاءة 100%!</h4>
                                        <p className="text-xs text-slate-400 dark:text-slate-500 font-bold max-w-md mx-auto">
                                            لم يتم رصد أي أخطاء برمجة أو استثناءات في الاستعلامات الأخيرة للبوت.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {techIssuesReviewLogs.map((log) => (
                                            <div key={log.id} className="p-5 bg-rose-50/40 dark:bg-rose-955/20 rounded-2xl border border-rose-200 dark:border-rose-900/40 space-y-3.5 shadow-sm flex flex-col justify-between transition-all hover:border-rose-400">
                                                <div className="space-y-2.5">
                                                    <div className="flex justify-between items-start gap-2">
                                                        <div>
                                                            <div className="text-xs font-black text-rose-800 dark:text-rose-300 flex items-center gap-1.5">
                                                                <Laptop size={15} /> 📞 {log.senderPhone}
                                                            </div>
                                                            <div className="text-[11px] text-blue-600 dark:text-blue-400 font-bold mt-0.5">
                                                                👤 {log.senderInfo || 'غير مسجل'}
                                                            </div>
                                                        </div>
                                                        <span className="text-[10px] text-slate-400 font-bold">
                                                            {log.timestamp ? new Date(log.timestamp).toLocaleString('ar-EG', { hour12: true }) : ''}
                                                        </span>
                                                    </div>

                                                    <div className="p-3.5 bg-white dark:bg-[#1e293b] rounded-xl border border-slate-200/70 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 font-bold whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed shadow-inner">
                                                        <span className="text-rose-500 font-black block mb-1">❓ الرسالة أو الاستعلام المتعلق بالخطأ التقني:</span> "{formatQuestionText(log)}"
                                                    </div>

                                                    <div className="p-3.5 bg-rose-100/60 dark:bg-rose-950/40 rounded-xl border border-rose-200 dark:border-rose-900/50 text-xs text-rose-900 dark:text-rose-200 font-bold whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed shadow-inner">
                                                        <span className="text-rose-700 dark:text-rose-400 font-black block mb-1">💻 سبب الخطأ التقني المكتشف:</span> {log.reason || log.replyText || 'خطأ غير معروف في المعالجة البرمجية'}
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between gap-2 pt-2 border-t border-dashed border-rose-200 dark:border-rose-900/40">
                                                    <span className="text-[10px] text-slate-400 font-bold">حالة الخطأ: معلق للمتابعة والتصحيح البرمجي</span>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => handleResolveTechIssue(log.id)}
                                                            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl border-none cursor-pointer text-xs transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
                                                            title="علم المشكلة التقنية كـ تم الإصلاح بنجاح"
                                                        >
                                                            <Wrench size={14} />
                                                            تم الإصلاح التقني ✅
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteHistoryLog(log.id)}
                                                            className="p-1.5 bg-slate-200 hover:bg-rose-100 text-slate-600 hover:text-rose-600 dark:bg-slate-800 dark:hover:bg-rose-955/40 dark:text-slate-300 dark:hover:text-rose-400 font-bold rounded-xl border-none cursor-pointer text-xs transition-all flex items-center gap-1 active:scale-95"
                                                            title="حذف هذا الخطأ التقني"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Tab 2: Knowledge Base Items */}
            {subTab === 'kb' && (
                <div className="space-y-4 animate-in fade-in duration-300">
                    <div className="bg-white dark:bg-[#1e293b] p-6 sm:p-8 rounded-3xl border border-slate-150 dark:border-slate-800/80 shadow-md">
                        <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
                            <div>
                                <h3 className="text-lg font-black text-slate-850 dark:text-slate-100 flex items-center gap-2">
                                    <List className="text-indigo-600" size={22} /> قاعدة المعرفة الرسمية للبوت ({kbItems.length})
                                </h3>
                                <p className="text-xs text-slate-400 dark:text-slate-500 font-bold mt-1">
                                    هذه هي الأسئلة والمعلومات التي يرجع إليها البوت سحابياً ليصيغ منها إجاباته الدقيقة للأهالي.
                                </p>
                            </div>
                            <button
                                onClick={() => setShowAddKbModal(!showAddKbModal)}
                                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl flex items-center gap-2 transition-all shadow-md shadow-indigo-600/10 cursor-pointer border-none active:scale-95"
                            >
                                {showAddKbModal ? <X size={16} /> : <Plus size={16} />}
                                {showAddKbModal ? 'إلغاء النافذة' : '➕ إضافة معلومة مباشرة'}
                            </button>
                        </div>

                        {/* Direct Add KB Form */}
                        {showAddKbModal && (
                            <form onSubmit={handleAddDirectKB} className="mb-6 p-5 bg-indigo-50/60 dark:bg-indigo-950/30 rounded-2xl border border-indigo-150 dark:border-indigo-900/40 space-y-4 animate-in fade-in duration-200">
                                <h4 className="text-sm font-black text-indigo-900 dark:text-indigo-300 flex items-center gap-2">
                                    <Sparkles size={16} /> إضافة سؤال وإجابة رسمية لقاعدة المعرفة
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-black text-slate-600 dark:text-slate-400 mb-1.5">السؤال أو المعنى المتوقع من الأهالي:</label>
                                        <input
                                            type="text"
                                            placeholder="مثال: ايه مواعيد مدارس الاحد والقداس؟"
                                            value={newQuestion}
                                            onChange={(e) => setNewQuestion(e.target.value)}
                                            className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500/40"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-black text-slate-600 dark:text-slate-400 mb-1.5">الإجابة المعتمدة التي سيرد بها البوت:</label>
                                        <textarea
                                            placeholder="اكتب الإجابة التفصيلية الرسمية هنا..."
                                            value={newAnswer}
                                            onChange={(e) => setNewAnswer(e.target.value)}
                                            rows={2}
                                            className="w-full p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500/40 resize-none"
                                        />
                                    </div>
                                </div>
                                <button
                                    type="submit"
                                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-xl text-xs transition-all flex items-center justify-center gap-2 border-none cursor-pointer shadow-md shadow-indigo-600/10 active:scale-98"
                                >
                                    <Send size={14} />
                                    حفظ وتغذية عقل البوت 🧠✨
                                </button>
                            </form>
                        )}

                        {/* Edit KB Modal */}
                        {editingKbItem && (
                            <form onSubmit={handleUpdateKBItem} className="mb-6 p-5 bg-amber-50/60 dark:bg-amber-950/30 rounded-2xl border border-amber-200 dark:border-amber-900/40 space-y-4 animate-in fade-in duration-200">
                                <div className="flex justify-between items-center">
                                    <h4 className="text-sm font-black text-amber-900 dark:text-amber-300 flex items-center gap-2">
                                        <Edit3 size={16} /> تعديل المعلومة في قاعدة معرفة البوت
                                    </h4>
                                    <button
                                        type="button"
                                        onClick={() => setEditingKbItem(null)}
                                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 border-none cursor-pointer bg-transparent"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-black text-slate-600 dark:text-slate-400 mb-1.5">السؤال / موضوع الاستفسار:</label>
                                        <input
                                            type="text"
                                            value={editingKbItem.question}
                                            onChange={(e) => setEditingKbItem(prev => ({ ...prev, question: e.target.value }))}
                                            className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-amber-500/40"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-black text-slate-600 dark:text-slate-400 mb-1.5">الإجابة المعتمدة الرسمية:</label>
                                        <textarea
                                            value={editingKbItem.answer}
                                            onChange={(e) => setEditingKbItem(prev => ({ ...prev, answer: e.target.value }))}
                                            rows={3}
                                            className="w-full p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-amber-500/40 resize-none"
                                        />
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        type="submit"
                                        className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-black rounded-xl text-xs transition-all flex items-center justify-center gap-2 border-none cursor-pointer shadow-md shadow-amber-600/10 active:scale-98"
                                    >
                                        <Check size={15} />
                                        حفظ التعديلات في عقل البوت 🧠✨
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setEditingKbItem(null)}
                                        className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs border-none cursor-pointer"
                                    >
                                        إلغاء
                                    </button>
                                </div>
                            </form>
                        )}

                        {loadingKB ? (
                            <div className="flex flex-col items-center justify-center py-16 gap-3">
                                <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                                <span className="text-sm text-slate-400 font-bold">جاري تحميل قاعدة المعرفة...</span>
                            </div>
                        ) : kbItems.length === 0 ? (
                            <div className="text-center py-16 text-slate-400 dark:text-slate-500 font-bold space-y-2">
                                <Info size={32} className="mx-auto text-slate-350" />
                                <p className="text-sm">قاعدة المعرفة فارغة حالياً</p>
                                <p className="text-xs">اضغط زر "إضافة معلومة مباشرة" بالخيار العلوي للبدء بتغذية عقل البوت.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {kbItems.map((item) => (
                                    <div key={item.id} className="p-4 bg-slate-50/70 dark:bg-slate-900/50 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3 relative group shadow-sm flex flex-col justify-between transition-all hover:border-indigo-300 dark:hover:border-indigo-800">
                                        <div className="absolute top-3 left-3 flex items-center gap-1">
                                            <button
                                                onClick={() => setEditingKbItem({ id: item.id, question: item.question, answer: item.answer })}
                                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-lg border-none cursor-pointer transition-all"
                                                title="تعديل المعلومة"
                                            >
                                                <Edit3 size={15} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteKBItem(item.id)}
                                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-955/30 rounded-lg border-none cursor-pointer transition-all"
                                                title="حذف من المعرفة"
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </div>
                                        
                                        <div className="pl-14 space-y-2 break-all [overflow-wrap:anywhere]">
                                            <div className="text-xs font-black text-slate-850 dark:text-slate-100 leading-snug">
                                                ❓ السؤال: <span className="font-semibold text-slate-700 dark:text-slate-300 break-all [overflow-wrap:anywhere]">{item.question}</span>
                                            </div>
                                            <div className="text-xs font-black text-indigo-600 dark:text-indigo-400 leading-snug">
                                                💡 الإجابة: <span className="font-semibold text-slate-700 dark:text-slate-300 break-all [overflow-wrap:anywhere]">{item.answer}</span>
                                            </div>
                                        </div>

                                        <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold pt-2 border-t border-dashed border-slate-200 dark:border-slate-800">
                                            <span>بواسطة: {item.addedBy || item.updatedBy || 'خادم'}</span>
                                            <span>{item.timestamp ? new Date(item.timestamp).toLocaleDateString('ar-EG') : ''}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Tab 3: History & Audit Log */}
            {subTab === 'history' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="bg-white dark:bg-[#1e293b] p-6 sm:p-8 rounded-3xl border border-slate-150 dark:border-slate-800/80 shadow-md space-y-6">
                        <div className="flex justify-between items-center flex-wrap gap-3">
                            <div>
                                <h3 className="text-lg font-black text-slate-850 dark:text-slate-100 flex items-center gap-2">
                                    <History className="text-emerald-600 dark:text-emerald-400" size={22} /> سجل الاستفسارات المعتمدة والأرشيف ({currentHistoryList.length})
                                </h3>
                                <p className="text-xs text-slate-400 dark:text-slate-500 font-bold mt-1">
                                    أرشيف منظم يتيح لك إعادة سحب أي رسالة لمراجعتها النشطة، أو مسحها نهائياً لتوفير المساحة سحابياً!
                                </p>
                            </div>

                            <div className="relative min-w-[260px]">
                                <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
                                <input
                                    type="text"
                                    placeholder="بحث في السجل بالرقم أو السؤال أو الإجابة..."
                                    value={historySearchQuery}
                                    onChange={(e) => setHistorySearchQuery(e.target.value)}
                                    className="w-full pr-9 pl-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500/40"
                                />
                            </div>
                        </div>

                        {/* Four Sub-Sections Filter Pills for History Tab */}
                        <div className="flex gap-2.5 border-b border-slate-100 dark:border-slate-800 pb-3 flex-wrap">
                            <button
                                onClick={() => setHistorySection('all')}
                                className={`px-3.5 py-2 rounded-2xl text-xs font-black transition-all cursor-pointer border flex items-center gap-1.5 active:scale-95 ${
                                    historySection === 'all'
                                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/20'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
                                }`}
                            >
                                📜 الكل ({historyLogs.length})
                            </button>

                            <button
                                onClick={() => setHistorySection('unanswered')}
                                className={`px-3.5 py-2 rounded-2xl text-xs font-black transition-all cursor-pointer border flex items-center gap-1.5 active:scale-95 ${
                                    historySection === 'unanswered'
                                        ? 'bg-orange-500 text-white border-orange-500 shadow-md shadow-orange-500/20'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
                                }`}
                            >
                                <Clock size={15} />
                                🔴 الأسئلة المعلقة المحسومة ({historyUnansweredLogs.length})
                            </button>

                            <button
                                onClick={() => setHistorySection('answered')}
                                className={`px-3.5 py-2 rounded-2xl text-xs font-black transition-all cursor-pointer border flex items-center gap-1.5 active:scale-95 ${
                                    historySection === 'answered'
                                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
                                }`}
                            >
                                <CheckCircle2 size={15} />
                                🟢 الاستفسارات المجابة المعتمدة ({historyAnsweredLogs.length})
                            </button>

                            <button
                                onClick={() => setHistorySection('service_issues')}
                                className={`px-3.5 py-2 rounded-2xl text-xs font-black transition-all cursor-pointer border flex items-center gap-1.5 active:scale-95 ${
                                    historySection === 'service_issues'
                                        ? 'bg-amber-600 text-white border-amber-600 shadow-md shadow-amber-600/20'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
                                }`}
                            >
                                <Building2 size={15} />
                                ⛪ شكاوى الخدمة المحسومة ({historyServiceIssuesLogs.length})
                            </button>

                            <button
                                onClick={() => setHistorySection('tech_issues')}
                                className={`px-3.5 py-2 rounded-2xl text-xs font-black transition-all cursor-pointer border flex items-center gap-1.5 active:scale-95 ${
                                    historySection === 'tech_issues'
                                        ? 'bg-rose-600 text-white border-rose-600 shadow-md shadow-rose-600/20'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
                                }`}
                            >
                                <Laptop size={15} />
                                💻 المشاكل التقنية المحسومة ({historyTechIssuesLogs.length})
                            </button>
                        </div>

                        {aiQueryLogsLoading ? (
                            <div className="flex flex-col items-center justify-center py-16 gap-3">
                                <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
                                <span className="text-sm text-slate-400 font-bold">جاري تحميل السجل...</span>
                            </div>
                        ) : currentHistoryList.length === 0 ? (
                            <div className="text-center py-16 text-slate-400 dark:text-slate-500 font-bold space-y-2">
                                <Info size={32} className="mx-auto text-slate-350" />
                                <p className="text-sm">لا توجد رسائل سابقة معتمدة مطابقة في هذا القسم.</p>
                                <p className="text-xs text-slate-400">عند حسم أو اعتماد الرسائل، ستنتقل تلقائياً لحفظها هنا.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {currentHistoryList.map((log) => (
                                    <div key={log.id} className="p-5 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3.5 shadow-sm flex flex-col justify-between transition-all hover:border-emerald-300 dark:hover:border-emerald-900/50">
                                        <div className="space-y-2.5">
                                            <div className="flex justify-between items-start gap-2">
                                                <div>
                                                    <div className="text-xs font-black text-slate-800 dark:text-slate-200">
                                                        📞 {log.senderPhone}
                                                    </div>
                                                    <div className="text-[11px] text-blue-600 dark:text-blue-400 font-bold mt-0.5">
                                                        👤 {log.senderInfo || 'غير مسجل'}
                                                    </div>
                                                </div>
                                                <div className="flex flex-col items-end gap-1">
                                                    {log.serviceIssueResolved ? (
                                                        <span className="px-2.5 py-0.5 bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 rounded-full text-[11px] font-black border border-amber-200 dark:border-amber-800">
                                                            شكوى خدمة تم حلها ⛪✅
                                                        </span>
                                                    ) : log.techIssueResolved ? (
                                                        <span className="px-2.5 py-0.5 bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 rounded-full text-[11px] font-black border border-rose-200 dark:border-rose-800">
                                                            مشكلة تقنية تم حلها 💻✅
                                                        </span>
                                                    ) : log.replyReviewedStatus === 'corrected' || log.reviewedStatus === 'corrected' ? (
                                                        <span className="px-2.5 py-0.5 bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 rounded-full text-[11px] font-black border border-purple-200 dark:border-purple-800">
                                                            إجابة تصحيحية ✍️
                                                        </span>
                                                    ) : (
                                                        <span className="px-2.5 py-0.5 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 rounded-full text-[11px] font-black border border-emerald-200 dark:border-emerald-800">
                                                            إجابة معتمدة ✅
                                                        </span>
                                                    )}
                                                    <span className="text-[10px] text-slate-400 font-bold">
                                                        {log.reviewedAt || log.replyReviewedAt || log.serviceResolvedAt || log.techResolvedAt ? new Date(log.reviewedAt || log.replyReviewedAt || log.serviceResolvedAt || log.techResolvedAt).toLocaleString('ar-EG', { hour12: true }) : ''}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="p-3.5 bg-white dark:bg-[#1e293b] rounded-xl border border-slate-200/70 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 font-bold whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed shadow-inner">
                                                <span className="text-orange-500 font-black block mb-1">❓ السؤال / الرسالة:</span> "{formatQuestionText(log)}"
                                            </div>

                                            <div className="p-3.5 bg-indigo-50/40 dark:bg-indigo-950/20 rounded-xl border border-indigo-100/70 dark:border-indigo-900/40 text-xs text-slate-800 dark:text-indigo-200 font-bold whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed shadow-inner">
                                                <span className="text-indigo-600 dark:text-indigo-400 font-black block mb-1">🤖 إجابة البوت الأصلية / التحديد:</span> {formatReplyText(log)}
                                            </div>

                                            {log.correction && (
                                                <div className="p-3.5 bg-emerald-50/60 dark:bg-emerald-950/30 rounded-xl border border-emerald-200/80 dark:border-emerald-900/40 text-xs text-slate-800 dark:text-emerald-200 font-bold whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed shadow-inner">
                                                    <span className="text-emerald-600 dark:text-emerald-400 font-black block mb-1">✍️ التعديل / القرار المعتمد:</span> {log.correction}
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-200 dark:border-slate-800 text-[10px] text-slate-400 font-bold flex-wrap gap-2">
                                            <span>بواسطة: {log.reviewedBy || log.replyReviewedBy || log.serviceResolvedBy || log.techResolvedBy || 'خادم'}</span>
                                            <div className="flex items-center gap-1.5">
                                                <button
                                                    onClick={() => handleRestoreLogToActive(log.id)}
                                                    className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/60 text-amber-700 dark:text-amber-300 font-black rounded-lg border border-amber-200 dark:border-amber-800/60 text-xs cursor-pointer transition-all flex items-center gap-1 active:scale-95"
                                                    title="إعادة الرسالة إلى قائمة المراجعة النشطة"
                                                >
                                                    <RotateCcw size={13} />
                                                    إرجاع للمراجعة 🔄
                                                </button>
                                                <button
                                                    onClick={() => handleEditHistoryItem(log.id, formatQuestionText(log), log.correction || formatReplyText(log))}
                                                    className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-300 font-black rounded-lg border border-indigo-200 dark:border-indigo-800/60 text-xs cursor-pointer transition-all flex items-center gap-1 active:scale-95"
                                                    title="تعديل الإجابة والتصحيح المعتمد"
                                                >
                                                    <Edit3 size={13} />
                                                    تعديل
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteHistoryLog(log.id)}
                                                    className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 font-bold rounded-lg border border-rose-200 dark:border-rose-900/40 text-xs cursor-pointer transition-all flex items-center gap-1 active:scale-95"
                                                    title="حذف هذه الرسالة نهائياً لإخلاء المساحة"
                                                >
                                                    <Trash2 size={13} />
                                                    مسح 🗑️
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Tab 4: Blocked Numbers Management */}
            {subTab === 'blocked' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="bg-white dark:bg-[#1e293b] p-6 sm:p-8 rounded-3xl border border-slate-150 dark:border-slate-800/80 shadow-md space-y-6">
                        <div>
                            <h3 className="text-lg font-black text-slate-850 dark:text-slate-100 flex items-center gap-2">
                                <Ban className="text-rose-600 dark:text-rose-400" size={22} /> إدارة حظر الأرقام (القائمة السوداء)
                            </h3>
                            <p className="text-xs text-slate-400 dark:text-slate-500 font-bold mt-1">
                                الأرقام المُدرجة في هذه القائمة سيتم حظرها وتجاهل أي رسائل واتساب واردة منها تماماً ولن يقوم البوت أو الذكاء الاصطناعي بالرد عليها.
                            </p>
                        </div>

                        {/* Add Blocked Number Form */}
                        <form onSubmit={handleAddBlockedNumber} className="p-5 bg-rose-50/40 dark:bg-rose-955/20 rounded-2xl border border-rose-150 dark:border-rose-900/30 space-y-4">
                            <h4 className="text-sm font-black text-rose-800 dark:text-rose-300 flex items-center gap-2">
                                <PhoneOff size={16} /> حظر رقم هاتف جديد
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-black text-slate-700 dark:text-slate-300 mb-1.5">رقم الهاتف المراد حظره:</label>
                                    <input
                                        type="text"
                                        placeholder="مثال: 01234567890 أو +201234567890"
                                        value={blockPhoneInput}
                                        onChange={(e) => setBlockPhoneInput(e.target.value)}
                                        className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-rose-500/40"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-black text-slate-700 dark:text-slate-300 mb-1.5">سبب الحظر (اختياري):</label>
                                    <input
                                        type="text"
                                        placeholder="مثال: إزعاج متكرر / رسائل عشوائية"
                                        value={blockReasonInput}
                                        onChange={(e) => setBlockReasonInput(e.target.value)}
                                        className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-rose-500/40"
                                    />
                                </div>
                            </div>
                            <button
                                type="submit"
                                className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-xl text-xs transition-all flex items-center justify-center gap-2 border-none cursor-pointer shadow-md shadow-rose-600/10 active:scale-98"
                            >
                                <Ban size={15} />
                                تأكيد حظر الرقم 🚫
                            </button>
                        </form>

                        {/* Search & List of Blocked Numbers */}
                        <div className="space-y-4 pt-2">
                            <div className="flex justify-between items-center flex-wrap gap-3">
                                <h4 className="text-base font-black text-slate-850 dark:text-slate-200 flex items-center gap-2">
                                    <ShieldAlert size={18} className="text-rose-50" /> الأرقام المحظورة حالياً ({filteredBlockedNumbers.length})
                                </h4>

                                <div className="relative min-w-[240px]">
                                    <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
                                    <input
                                        type="text"
                                        placeholder="بحث برقم الهاتف أو السبب..."
                                        value={blockedSearchQuery}
                                        onChange={(e) => setBlockedSearchQuery(e.target.value)}
                                        className="w-full pr-9 pl-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-rose-500/40"
                                    />
                                </div>
                            </div>

                            {loadingBlocked ? (
                                <div className="flex flex-col items-center justify-center py-16 gap-3">
                                    <div className="w-10 h-10 border-4 border-rose-600 border-t-transparent rounded-full animate-spin"></div>
                                    <span className="text-sm text-slate-400 font-bold">جاري تحميل الأرقام المحظورة...</span>
                                </div>
                            ) : filteredBlockedNumbers.length === 0 ? (
                                <div className="text-center py-16 text-slate-400 dark:text-slate-500 font-bold space-y-2">
                                    <Check size={32} className="mx-auto text-emerald-500" />
                                    <p className="text-sm">لا توجد أرقام محظورة مطابقة.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {filteredBlockedNumbers.map((b) => (
                                        <div key={b.id} className="p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3 shadow-sm flex flex-col justify-between transition-all hover:border-rose-300 dark:hover:border-rose-900/50">
                                            <div className="space-y-2">
                                                <div className="flex justify-between items-start">
                                                    <div className="text-sm font-black text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                                                        📞 {b.phone}
                                                    </div>
                                                    <span className="text-[10px] text-slate-400 font-bold">
                                                        {b.timestamp ? new Date(b.timestamp).toLocaleDateString('ar-EG') : ''}
                                                    </span>
                                                </div>

                                                <div className="p-2.5 bg-white dark:bg-[#1e293b] rounded-xl border border-slate-200/60 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                    📌 <span className="font-bold">السبب:</span> {b.reason || 'إزعاج'}
                                                </div>
                                            </div>

                                            <div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-200 dark:border-slate-800">
                                                <span className="text-[10px] text-slate-400 font-bold">بواسطة: {b.blockedBy || 'خادم'}</span>
                                                <button
                                                    onClick={() => handleUnblockNumber(b.id, b.phone)}
                                                    className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 dark:text-emerald-300 font-black rounded-xl border border-emerald-200 dark:border-emerald-800/60 text-xs cursor-pointer transition-all active:scale-95 flex items-center gap-1"
                                                >
                                                    🔓 إلغاء الحظر
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
