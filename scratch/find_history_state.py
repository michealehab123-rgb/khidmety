with open("src/components/NotificationSettings.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "const [historyList" in line or "historyList" in line and "useState" in line:
        print(f"Line {i+1}: {line.strip()}")
