const fs = require('fs');
const path = require('path');

const servantDashboardPath = path.join(__dirname, '../src/pages/ServantDashboard.jsx');
const adminDashboardPath = path.join(__dirname, '../src/pages/AdminDashboard.jsx');

// Helper to replace once with exact match or warn
function replaceInFile(filePath, replacements) {
    let content = fs.readFileSync(filePath, 'utf8');
    let updated = content;
    for (const rep of replacements) {
        if (!updated.includes(rep.target)) {
            console.error(`ERROR: Target not found in ${path.basename(filePath)}:\n${rep.target}`);
            process.exit(1);
        }
        updated = updated.replace(rep.target, rep.replacement);
    }
    fs.writeFileSync(filePath, updated, 'utf8');
    console.log(`Successfully updated ${path.basename(filePath)}`);
}

// 1. Update ServantDashboard.jsx table row body
const servantTarget = `<td className="p-4 text-center font-bold text-emerald-600 dark:text-emerald-400">{student.attendance ? student.attendance.length : 0} جمعة</td>`;
const servantReplacement = `<td className="p-4 text-center font-bold text-purple-600 dark:text-purple-400">{student.liturgyAttendance ? student.liturgyAttendance.length : 0} قداس</td>
                                        <td className="p-4 text-center font-bold text-emerald-600 dark:text-emerald-400">{student.attendance ? student.attendance.length : 0} جمعة</td>`;

replaceInFile(servantDashboardPath, [
    { target: servantTarget, replacement: servantReplacement }
]);

// 2. Update AdminDashboard.jsx table header & row body
const adminHeaderTarget = `<th className="p-3 text-center">حضور المخدوم</th>`;
const adminHeaderReplacement = `<th className="p-3 text-center">حضور القداس</th>
                                    <th className="p-3 text-center">حضور المخدوم</th>`;

const adminRowTarget = `<td className="p-4 text-center font-bold text-emerald-600 dark:text-emerald-400">{student.attendance ? student.attendance.length : 0} جمعة</td>`;
const adminRowReplacement = `<td className="p-4 text-center font-bold text-purple-600 dark:text-purple-400">{student.liturgyAttendance ? student.liturgyAttendance.length : 0} قداس</td>
                                        <td className="p-4 text-center font-bold text-emerald-600 dark:text-emerald-400">{student.attendance ? student.attendance.length : 0} جمعة</td>`;

replaceInFile(adminDashboardPath, [
    { target: adminHeaderTarget, replacement: adminHeaderReplacement },
    { target: adminRowTarget, replacement: adminRowReplacement }
]);
