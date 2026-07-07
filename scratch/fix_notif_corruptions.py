# -*- coding: utf-8 -*-
import sys

filepath = 'src/components/NotificationSettings.jsx'

# Read file as UTF-8
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Define the target function content to search for
target_func = """  const handleDeleteSentNotification = async (id) => {
    if (!window.confirm('               .')) return;
    try {
      await deleteDoc(doc(db, 'notifications', id));
      showToast('   !');
    } catch (error) {
      console.error("Error deleting notification:", error);
      showToast('    ѡ   ', 'error');
    }
  };"""

replacement_func = """  const handleDeleteSentNotification = async (id) => {
    if (!window.confirm('هل أنت متأكد من مسح هذا الإشعار تماماً؟ سيتم حذفه أيضاً من صناديق الوارد لدى المستلمين.')) return;
    try {
      await deleteDoc(doc(db, 'notifications', id));
      showToast('تم مسح الإشعار بنجاح!');
    } catch (error) {
      console.error("Error deleting notification:", error);
      showToast('حدث خطأ أثناء مسح الإشعار، يرجى المحاولة لاحقاً', 'error');
    }
  };"""

if target_func in content:
    content = content.replace(target_func, replacement_func)
    print("Function replaced successfully!")
else:
    # Try with LF endings
    target_func_lf = target_func.replace("\r\n", "\n")
    replacement_func_lf = replacement_func.replace("\r\n", "\n")
    if target_func_lf in content:
        content = content.replace(target_func_lf, replacement_func_lf)
        print("Function replaced successfully (LF)!")
    else:
        print("Function target not found. Doing manual search...")
        # Find start index
        start_idx = content.find("const handleDeleteSentNotification = async (id) => {")
        if start_idx != -1:
            end_idx = content.find("};", start_idx) + len("};")
            content = content[:start_idx] + replacement_func + content[end_idx:]
            print("Function replaced via index search!")
        else:
            print("Could not find function start index.")

# Now replace the corrupted title
target_title = 'title=" "'
replacement_title = 'title="مسح الإشعار"'

if target_title in content:
    content = content.replace(target_title, replacement_title)
    print("Title replaced successfully!")
else:
    # Try finding title with placeholder chars
    title_start = content.find('title="')
    # Loop over all occurrences and replace the corrupted one
    found = False
    idx = 0
    while True:
        idx = content.find('title="', idx)
        if idx == -1:
            break
        end_idx = content.find('"', idx + 7)
        title_val = content[idx:end_idx+1]
        if '\ufffd' in title_val:
            content = content[:idx] + replacement_title + content[end_idx+1:]
            found = True
            print("Corrupted title replaced dynamically!")
            break
        idx += 1
    if not found:
        print("Corrupted title not found.")

# Write back in UTF-8
with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print("File saved successfully in UTF-8!")
