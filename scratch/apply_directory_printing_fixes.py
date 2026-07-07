import os

file_path = 'src/pages/ServantDashboard.jsx'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Let's locate the corrupted section
# Starts around the `{studentsLoading ? (` in the bonus tab
# Let's find: `activeTab === 'bonus'` and then the `{studentsLoading ? (` following it.
bonus_idx = content.find("activeTab === 'bonus'")
if bonus_idx == -1:
    print("Error: Could not find activeTab === 'bonus'")
    exit(1)

loading_idx = content.find("studentsLoading ? (", bonus_idx)
if loading_idx == -1:
    print("Error: Could not find studentsLoading ? (")
    exit(1)

# Find the end of the corrupted block, which is right before `{showAddForm && (`
showadd_idx = content.find("{showAddForm && (", loading_idx)
if showadd_idx == -1:
    print("Error: Could not find {showAddForm && (")
    exit(1)

# Let's verify the text we are replacing
replace_start = content.rfind("{", 0, loading_idx) # find the bracket opening the block: {studentsLoading ? (
# Wait, we can just replace from loading_idx (or rather, the line starting with `{studentsLoading ? (`) 
# to the line before `{showAddForm && (`.
# Let's split by lines to be safer and more precise.
lines = content.splitlines()

start_line_idx = -1
end_line_idx = -1

for idx, line in enumerate(lines):
    if idx > 1750 and "studentsLoading ? (" in line:
        start_line_idx = idx
        break

for idx, line in enumerate(lines):
    if idx > start_line_idx and "{showAddForm && (" in line:
        end_line_idx = idx
        break

if start_line_idx == -1 or end_line_idx == -1:
    print(f"Error: line boundaries not found. Start: {start_line_idx}, End: {end_line_idx}")
    exit(1)

print(f"Replacing lines {start_line_idx+1} to {end_line_idx}")
print("First line to replace:", repr(lines[start_line_idx]))
print("Last line before showAddForm:", repr(lines[end_line_idx-1]))

# The clean replacement:
replacement = """                    {studentsLoading ? (
                        <div className="py-20 text-center space-y-4">
                            <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mx-auto"></div>
                            <p className="text-xl font-bold text-slate-400 dark:text-slate-500">جاري تحميل قائمة المخدومين...</p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {filteredStudentsTab1.map(student => {
                                const safeClassId = getSafeClassId(student.assignedClass);
                                const consecutiveGiftEnabled = !!attendanceConfigs[safeClassId]?.consecutiveGiftEnabled;
                                return (
                                    <StudentRow 
                                        key={student.id} 
                                        student={student} 
                                        addPoints={addPoints} 
                                        markAttendance={markAttendance} 
                                        deleteStudent={handleDeleteStudent}
                                        openAttendanceModal={setAttendanceModalStudentId}
                                        resetPassword={resetPassword}
                                        shortcuts={getShortcutsForClass(student.assignedClass)}
                                        addShortcut={(val) => addShortcutForClass(student.assignedClass, val)}
                                        removeShortcut={(val) => removeShortcutForClass(student.assignedClass, val)}
                                        consecutiveGiftEnabled={consecutiveGiftEnabled}
                                        claimGift={claimGift}
                                        isBonus={true}
                                        storeVisible={isStoreVisibleForStudent(student, storeConfigs)}
                                    />
                                );
                            })}
                            {filteredStudentsTab1.length === 0 && (
                                <div className="py-20 text-center bg-white dark:bg-[#1e293b] rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-800 transition-colors duration-300">
                                    <Search size={64} className="mx-auto text-slate-200 dark:text-slate-700 mb-4" />
                                    <p className="text-xl font-bold text-slate-400 dark:text-slate-500">لا يوجد مخدومين بهذا الاسم أو الكود في نطاقك</p>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}

            {activeTab === 'directory' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="flex flex-col lg:flex-row gap-4 items-center justify-between print:hidden">
                        <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto flex-grow max-w-5xl">
                            <div className="relative w-full max-w-md">
                                <input
                                    type="text"
                                    placeholder="ابحث عن مخدوم بالاسم أو الكود..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full p-3 bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold transition-colors duration-300"
                                />
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-555" />
                            </div>

                            <select
                                value={selectedStageTab2}
                                onChange={e => { setSelectedStageTab2(e.target.value); setSelectedClassTab2('الكل'); }}
                                className="w-full sm:w-44 p-3 bg-white dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-colors duration-300 disabled:opacity-75 disabled:cursor-not-allowed"
                                disabled={(isStageServant || isClassServant) && !!myStage}
                            >
                                <option value="الكل">كل المراحل</option>
                                {Object.keys(STAGE_CLASS_MAP).map(stage => (
                                    <option key={stage} value={stage}>{stage}</option>
                                ))}
                            </select>

                            <select
                                value={selectedClassTab2}
                                onChange={e => setSelectedClassTab2(e.target.value)}
                                className="w-full sm:w-48 p-3 bg-white dark:bg-[#0f172a] text-slate-850 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-300"
                                disabled={selectedStageTab2 === 'الكل' || ((isClassServant || isStageServant) && myClasses.length <= 1)}
                            >
                                {myClasses.length > 1 && <option value="الكل">كل الفصول</option>}
                                {myClasses.map(cls => (
                                    <option key={cls} value={cls}>{cls}</option>
                                ))}
                            </select>

                            <button 
                                onClick={() => setShowAddForm(!showAddForm)} 
                                className={`px-5 py-3 font-bold rounded-xl shadow-lg transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${showAddForm ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-lg' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg'}`}
                            >
                                <UserPlus size={20} />
                                <span>{showAddForm ? 'إلغاء الإضافة' : 'إضافة مخدوم جديد'}</span>
                            </button>
                        </div>
                        <div className="flex items-center gap-3 whitespace-nowrap">
                            <button 
                                type="button"
                                onClick={() => window.print()}
                                className="px-4 py-2.5 bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 text-white font-bold rounded-xl shadow transition-all flex items-center gap-2 cursor-pointer border-none"
                            >
                                <Printer size={18} />
                                <span>طباعة الكشف</span>
                            </button>
                            <span className="text-sm font-bold text-slate-500 dark:text-slate-400">
                                إجمالي: {filteredStudentsTab2.length} مخدوم
                            </span>
                        </div>
                    </div>

                    {/* Print Header */}
                    <div className="hidden print:flex mb-6 border-b-2 border-slate-800 dark:border-slate-700 pb-3 justify-between items-center w-full">
                        <div>
                            <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 leading-normal">
                                كشف المخدومين - مدرسة الأحد
                            </h2>
                            <p className="text-sm font-bold text-slate-655 dark:text-slate-400">
                                {selectedStageTab2 !== 'الكل' && `المرحلة: ${selectedStageTab2}`} 
                                {selectedClassTab2 !== 'الكل' && ` - الفصل: ${selectedClassTab2}`}
                            </p>
                        </div>
                        <div className="text-left">
                            <div className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">العدد الإجمالي</div>
                            <div className="text-xl font-black text-slate-800 dark:text-slate-200">{filteredStudentsTab2.length} مخدوم</div>
                        </div>
                    </div>"""

# Replace in lines
new_lines = lines[:start_line_idx] + [replacement] + lines[end_line_idx:]

# Let's convert back to text to apply further fixes
new_content = "\n".join(new_lines)

# Now, let's fix the table wrapper class in directory tab
# Find: `<div className="overflow-x-auto bg-white dark:bg-[#1e293b] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors duration-300">`
# following the activeTab === 'directory' block.
# Let's search and replace it.
target_div = '<div className="overflow-x-auto bg-white dark:bg-[#1e293b] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors duration-300">'
replacement_div = '<div className="overflow-x-auto bg-white dark:bg-[#1e293b] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors duration-300 print:border-none print:shadow-none print:bg-transparent print:overflow-visible">'

# Since there might be multiple occurrences of target_div, we want to replace the one that follows directory tab.
# Let's find activeTab === 'directory'
dir_tab_idx = new_content.find("activeTab === 'directory'")
div_idx = new_content.find(target_div, dir_tab_idx)
if div_idx == -1:
    print("Warning: Could not find target table wrapper div near directory tab")
else:
    # Replace only that specific occurrence
    new_content = new_content[:div_idx] + replacement_div + new_content[div_idx + len(target_div):]
    print("Successfully replaced table wrapper div class names.")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Finished applying directory printing fixes.")
