with open('src/pages/AdminDashboard.jsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

with open('scratch/admin_bottom.txt', 'w', encoding='utf-8') as f_out:
    # Let's inspect the last 150 lines
    for idx in range(len(lines) - 150, len(lines)):
        f_out.write(f"{idx+1}: {lines[idx]}")

print("Dumped AdminDashboard bottom.")
