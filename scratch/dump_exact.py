with open("src/components/NotificationSettings.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()

for idx in range(1210, min(1222, len(lines))):
    print(f"Line {idx+1}: {repr(lines[idx].encode('utf-8'))}")
