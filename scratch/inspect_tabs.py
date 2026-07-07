import sys

with open("src/pages/ServantDashboard.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()

for idx in range(2010, 2030):
    if idx < len(lines):
        sys.stdout.buffer.write(f"{idx+1}: ".encode('utf-8') + lines[idx].encode('utf-8', errors='replace'))
