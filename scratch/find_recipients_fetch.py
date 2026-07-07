with open("src/components/NotificationSettings.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "setRecipientsList" in line or "recipientsList" in line and "map" in line or "fetch" in line and "recipients" in line:
        print(f"Line {i+1}: {line.strip()}")
