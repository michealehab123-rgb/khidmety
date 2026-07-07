with open("src/components/NotificationSettings.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()

for idx in range(1720, 1735):
    if idx < len(lines):
        print(f"{idx+1}: {repr(lines[idx].encode('utf-8'))}")
