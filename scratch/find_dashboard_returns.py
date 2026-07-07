with open("src/pages/AdminDashboard.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "return (" in line:
        # print first few return statements
        if i > 5000: # Usually the main render is at the end of the component
            print(f"AdminDashboard:{i+1}: {line.strip()}")

with open("src/pages/ServantDashboard.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "return (" in line:
        if i > 5500:
            print(f"ServantDashboard:{i+1}: {line.strip()}")
