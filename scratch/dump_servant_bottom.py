with open('src/pages/ServantDashboard.jsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

with open('scratch/servant_bottom.txt', 'w', encoding='utf-8') as f_out:
    for idx in range(2095, len(lines)):
        f_out.write(f"{idx+1}: {lines[idx]}")

print("Dumped ServantDashboard bottom.")
