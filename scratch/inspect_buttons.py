import sys

with open("src/pages/AdminDashboard.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()
print("--- AdminDashboard Buttons ---")
for idx in range(5700, 5770):
    if idx < len(lines):
        line = lines[idx].strip()
        if "button" in line or "onClick" in line or "activeTab ===" in line or "الكارنيهات" in line or "الإشعارات" in line or "الطلاب" in line or "المخدومين" in line:
            sys.stdout.buffer.write(f"{idx+1}: ".encode('utf-8') + lines[idx].encode('utf-8', errors='replace'))

with open("src/pages/ServantDashboard.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()
print("--- ServantDashboard Buttons ---")
for idx in range(6090, 6160):
    if idx < len(lines):
        line = lines[idx].strip()
        if "button" in line or "onClick" in line or "activeTab ===" in line or "الكارنيهات" in line or "الإشعارات" in line or "الطلاب" in line or "المخدومين" in line:
            sys.stdout.buffer.write(f"{idx+1}: ".encode('utf-8') + lines[idx].encode('utf-8', errors='replace'))
