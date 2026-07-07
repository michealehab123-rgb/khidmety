import * as XLSX from 'xlsx';

/**
 * Generic Excel export helper configured for RTL Arabic sheets.
 * @param {string[]} headers Array of header labels
 * @param {any[][]} rows Array of row arrays containing cell values
 * @param {string} sheetName Name of the sheet tab
 * @param {string} fileName Name of the downloaded file (without extension)
 */
export const exportToExcelGeneric = (headers, rows, sheetName = 'الكشف', fileName = 'export') => {
    // Convert array of arrays to sheet
    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set sheet view to Right-To-Left (RTL) for Arabic language
    if (!ws['!views']) ws['!views'] = [];
    ws['!views'].push({ RTL: true });

    // Auto-fit column widths based on longest value in each column
    const colWidths = headers.map((header, colIdx) => {
        let maxLen = header ? header.toString().length : 8;
        rows.forEach(row => {
            const cellVal = row[colIdx];
            if (cellVal !== undefined && cellVal !== null) {
                const len = cellVal.toString().length;
                if (len > maxLen) maxLen = len;
            }
        });
        // Limit width between 8 and 50 characters, add a padding of 4
        return { wch: Math.min(Math.max(maxLen + 4, 8), 50) };
    });
    ws['!cols'] = colWidths;

    // Create workbook and append the worksheet
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    // Download the file
    XLSX.writeFile(wb, `${fileName}.xlsx`);
};

/**
 * Exports children list (directory) to Excel.
 */
export const exportStudentsToExcel = (students, className = 'الكل') => {
    const headers = [
        'م',
        'كود المخدوم',
        'اسم المخدوم',
        'المرحلة',
        'الفصل',
        'أرقام التليفون',
        'العناوين',
        'عدد الصفات',
        'اعتراف هذا الشهر',
        'حضور القداس',
        'حضور الخدمة'
    ];

    const rows = students.map((s, idx) => {
        const today = new Date();
        const monthKey = `${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
        const hasConfessed = s.confessions?.[monthKey]?.status === true;

        return [
            idx + 1,
            s.code || '',
            s.name || '',
            s.schoolGrade || s.assignedStage || '',
            s.assignedClass || '',
            s.phones && s.phones.filter(Boolean).length > 0 ? s.phones.filter(Boolean).join('، ') : (s.phone || ''),
            s.addresses && s.addresses.filter(Boolean).length > 0 ? s.addresses.filter(Boolean).join('، ') : (s.address || ''),
            s.points || 0,
            hasConfessed ? 'اعترف ✅' : 'لم يعترف ❌',
            s.liturgyAttendance ? s.liturgyAttendance.length : 0,
            s.attendance ? s.attendance.length : 0
        ];
    });

    const filePrefix = className === 'الكل' ? 'كشف_المخدومين_الكل' : `كشف_مخدومين_فصل_${className}`;
    exportToExcelGeneric(headers, rows, 'قائمة المخدومين', `${filePrefix}_${new Date().toISOString().split('T')[0]}`);
};

/**
 * Exports attendance records to Excel.
 */
export const exportAttendanceToExcel = (students, className = 'الكل', dateStr = '') => {
    const headers = [
        'م',
        'كود التعريف',
        'اسم المخدوم',
        'المرحلة',
        'الفصل',
        'حضور الخدمة',
        'حضور القداس',
        'رقم التليفون'
    ];

    const rows = students.map((s, idx) => {
        // Check if student attended today based on date string
        const attendedToday = s.attendance?.some(d => d.startsWith(dateStr)) || false;
        const attendedLiturgyToday = s.liturgyAttendance?.some(d => d.startsWith(dateStr)) || false;

        return [
            idx + 1,
            s.code || '',
            s.name || '',
            s.schoolGrade || s.assignedStage || '',
            s.assignedClass || '',
            attendedToday ? 'حاضر ✅' : 'غائب ❌',
            attendedLiturgyToday ? 'حاضر ✅' : 'غائب ❌',
            s.phone || ''
        ];
    });

    const filePrefix = className === 'الكل' ? 'كشف_حضور_الكل' : `كشف_حضور_فصل_${className}`;
    exportToExcelGeneric(headers, rows, 'كشف حضور وغياب', `${filePrefix}_${dateStr}`);
};

/**
 * Exports class servants list to Excel.
 */
export const exportServantsToExcel = (servants, className = 'الكل') => {
    const headers = [
        'م',
        'الاسم',
        'المسؤولية / الدور',
        'رقم الموبايل',
        'المرحلة',
        'الفصول المسؤول عنها',
        'حالة الحساب'
    ];

    const rows = servants.map((s, idx) => [
        idx + 1,
        s.name || '',
        s.role || 'خادم',
        s.phone || '',
        s.assignedStage || '',
        s.myClasses ? s.myClasses.join('، ') : (s.assignedClass || ''),
        s.isActive !== false ? 'نشط' : 'غير نشط'
    ]);

    const filePrefix = className === 'الكل' ? 'كشف_خدام_الكل' : `كشف_خدام_فصل_${className}`;
    exportToExcelGeneric(headers, rows, 'قائمة خدام مدارس الأحد', `${filePrefix}_${new Date().toISOString().split('T')[0]}`);
};

/**
 * Downloads the Excel import template for bulk students addition.
 */
export const downloadExcelTemplate = () => {
    const headers = ['الاسم', 'السن', 'المنطقة', 'العنوان بالتفصيل', 'رقم الهاتف', 'تاريخ الميلاد'];
    const sampleRows = [
        ['ميشيل إيهاب', '15', 'شبرا', '12 ش شبرا، الدور الرابع، شقة 8', '01234567890 / 01122334455', '2011/05/14']
    ];
    exportToExcelGeneric(headers, sampleRows, 'نموذج الاستيراد', 'نموذج_استيراد_المخدومين');
};
