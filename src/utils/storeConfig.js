export const getSafeClassId = (className) => {
    if (!className) return '';
    return className.replace(/\//g, '-');
};

export const getStudentStage = (studentData) => {
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

export const isStoreVisibleForStudent = (student, storeConfigs) => {
    if (!student) return true;
    
    // 1. Class override
    const classId = getSafeClassId(student.assignedClass || student.schoolGrade);
    const classConfig = storeConfigs.find(c => c.id === classId);
    if (classConfig && classConfig.storeVisible !== undefined) {
        return classConfig.storeVisible;
    }
    
    // 2. Stage override
    const studentStage = getStudentStage(student);
    const stageConfig = storeConfigs.find(c => c.id === `stage-${studentStage}`);
    if (stageConfig && stageConfig.storeVisible !== undefined) {
        return stageConfig.storeVisible;
    }
    
    // 3. Global config
    const globalConfig = storeConfigs.find(c => c.id === 'global');
    if (globalConfig && globalConfig.storeVisible !== undefined) {
        return globalConfig.storeVisible;
    }
    
    return true;
};
