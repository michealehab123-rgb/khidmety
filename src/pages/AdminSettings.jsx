import React from 'react';
import AdvancedSettingsTab from '../components/AdvancedSettingsTab';

export default function AdminSettings() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-8 min-h-[75vh]" dir="rtl">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-3xl font-black text-slate-900 dark:text-white transition-colors duration-300">
          الإعدادات والتحكم وإدارة البيانات ⚙️
        </h1>
      </div>
      <p className="text-slate-500 dark:text-slate-400 transition-colors duration-300 mb-8">
        لوحة ضبط المصنع والتحكم وإدارة عمليات التراجع والمسح الجزئي والكلي للمنصة.
      </p>
      <AdvancedSettingsTab />
    </div>
  );
}
