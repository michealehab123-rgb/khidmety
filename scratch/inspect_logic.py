with open("src/components/NotificationSettings.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "const handleSendNotification" in line or "const handleCreateNewPeriodicAlert" in line or "const handleSaveAlert" in line or "const handleSaveSettings" in line:
        print(f"Line {i+1}: {line.strip()}")
