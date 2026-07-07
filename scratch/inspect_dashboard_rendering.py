with open("src/pages/AdminDashboard.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()
print("--- AdminDashboard ---")
for idx in range(5760, min(5790, len(lines))):
    print(f"{idx+1}: {lines[idx].strip()}")

with open("src/pages/ServantDashboard.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()
print("--- ServantDashboard ---")
for idx in range(6150, min(6180, len(lines))):
    print(f"{idx+1}: {lines[idx].strip()}")
