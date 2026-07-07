import sys

with open("src/components/NotificationSettings.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()

for idx in range(0, 35):
    if idx < len(lines):
        sys.stdout.buffer.write(f"{idx+1}: ".encode('utf-8') + lines[idx].encode('utf-8', errors='replace'))
