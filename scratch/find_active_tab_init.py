with open("src/pages/ServantDashboard.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "const [activeTab" in line or "activeTab" in line and "useState" in line:
        print(f"ServantDashboard:{i+1}: {line.strip()}")

with open("src/pages/AdminDashboard.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "const [activeTab" in line or "activeTab" in line and "useState" in line:
        print(f"AdminDashboard:{i+1}: {line.strip()}")
