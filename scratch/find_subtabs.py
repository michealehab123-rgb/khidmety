with open("src/components/NotificationSettings.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "activeSubTab ===" in line or "activeSubTab === 'send'" in line:
        print(f"Line {i+1}: {line.strip()}")
