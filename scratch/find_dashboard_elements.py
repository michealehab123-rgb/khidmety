import os

target_files = ["src/pages/AdminDashboard.jsx", "src/pages/ServantDashboard.jsx"]
for filepath in target_files:
    if os.path.exists(filepath):
        try:
            with open(filepath, "r", encoding="cp1256") as f:
                content = f.read()
        except Exception:
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()
        
        print(f"File: {filepath}")
        lines = content.splitlines()
        for idx, line in enumerate(lines):
            if "إدارة مخدومين مدرسة الأحد" in line or "تسجيل الحضور" in line or "بونص" in line or "كشوف المخدومين" in line or "طباعة الكارنيهات" in line or "متصل" in line:
                print(f"  Line {idx+1}: {line.strip()}")
