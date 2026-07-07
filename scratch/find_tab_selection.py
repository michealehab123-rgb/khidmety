with open("src/pages/AdminDashboard.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "'notifications'" in line or '"notifications"' in line:
        # print if it contains tab or button or state change
        if "setActiveTab" in line or "activeTab" in line or "label" in line or "title" in line:
            print(f"AdminDashboard:{i+1}: {line.strip()}")

with open("src/pages/ServantDashboard.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "'notifications'" in line or '"notifications"' in line:
        if "setActiveTab" in line or "activeTab" in line or "label" in line or "title" in line:
            print(f"ServantDashboard:{i+1}: {line.strip()}")
