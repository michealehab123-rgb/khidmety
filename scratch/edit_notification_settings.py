import sys

# Read NotificationSettings.jsx as cp1256
with open("src/components/NotificationSettings.jsx", "r", encoding="cp1256") as f:
    content = f.read()

# 1. Replace imports to include deleteDoc
target_import = """import { 
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
  serverTimestamp 
} from '../firebase';"""

replacement_import = """import { 
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
} from '../firebase';"""

if target_import in content:
    content = content.replace(target_import, replacement_import)
    print("Imports updated successfully!")
else:
    # Try with LF endings
    target_import_lf = target_import.replace("\r\n", "\n")
    replacement_import_lf = replacement_import.replace("\r\n", "\n")
    if target_import_lf in content:
        content = content.replace(target_import_lf, replacement_import_lf)
        print("Imports updated successfully (LF)!")
    else:
        print("Import target NOT found.")

# 2. Add visibleHistoryList state
target_history_state = "const [historyList, setHistoryList] = useState([]);"
replacement_history_state = """const [historyList, setHistoryList] = useState([]);

  const visibleHistoryList = useMemo(() => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return historyList.filter(log => !log.createdAt || log.createdAt > oneDayAgo);
  }, [historyList]);"""

if target_history_state in content:
    content = content.replace(target_history_state, replacement_history_state)
    print("visibleHistoryList state added!")
else:
    print("History state target NOT found.")

# 3. Add handleDeleteSentNotification helper
target_selectAll = "  // Select all / Deselect all recipients"
replacement_delete_helper = """  const handleDeleteSentNotification = async (id) => {
    if (!window.confirm('هل أنت متأكد من مسح هذا الإشعار تماماً؟ سيتم حذفه أيضاً من صناديق الوارد لدى المستلمين.')) return;
    try {
      await deleteDoc(doc(db, 'notifications', id));
      showToast('تم مسح الإشعار بنجاح!');
    } catch (error) {
      console.error("Error deleting notification:", error);
      showToast('حدث خطأ أثناء مسح الإشعار، يرجى المحاولة لاحقاً', 'error');
    }
  };

  // Select all / Deselect all recipients"""

if target_selectAll in content:
    content = content.replace(target_selectAll, replacement_delete_helper)
    print("handleDeleteSentNotification helper added!")
else:
    print("SelectAll target NOT found.")

# 4. Update render logic to use visibleHistoryList and include Trash2 button
# Let's inspect the render block target:
target_render_check = "historyList.length === 0 ? ("
replacement_render_check = "visibleHistoryList.length === 0 ? ("

target_render_map = "historyList.map((log) => ("
replacement_render_map = "visibleHistoryList.map((log) => ("

content = content.replace(target_render_check, replacement_render_check)
content = content.replace(target_render_map, replacement_render_map)
print("Render targets (check & map) replaced!")

# Now replace the details block to include the Trash button
target_details = """                      <div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-start gap-2 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800/50 shrink-0">
                        <div className="text-right">
                          <p className="text-[10px] text-slate-400">المرسل:</p>
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                            {log.senderName} ({log.senderRole})
                          </p>
                        </div>
                        <div className="px-3 py-1 bg-teal-500/10 text-teal-600 dark:text-teal-400 rounded-lg text-xs font-bold mt-1">
                          عدد المستلمين: {log.sentCount}
                        </div>
                      </div>"""

replacement_details = """                      <div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-start gap-2 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800/50 shrink-0">
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
                      </div>"""

if target_details in content:
    content = content.replace(target_details, replacement_details)
    print("Details block updated with Trash button!")
else:
    target_details_lf = target_details.replace("\r\n", "\n")
    replacement_details_lf = replacement_details.replace("\r\n", "\n")
    if target_details_lf in content:
        content = content.replace(target_details_lf, replacement_details_lf)
        print("Details block updated with Trash button (LF)!")
    else:
        print("Details block target NOT found.")

# Save back in cp1256
with open("src/components/NotificationSettings.jsx", "w", encoding="cp1256") as f:
    f.write(content)
print("All edits successfully saved!")
