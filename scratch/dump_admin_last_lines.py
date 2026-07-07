with open('src/pages/AdminDashboard.jsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

with open('scratch/admin_last_lines.txt', 'w', encoding='utf-8') as f_out:
    for idx in range(len(lines) - 20, len(lines)):
        f_out.write(f"{idx+1}: {lines[idx]}")

print("Dumped AdminDashboard very bottom.")
