with open('src/pages/ServantDashboard.jsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

with open('scratch/inspect_servant_table.txt', 'w', encoding='utf-8') as f_out:
    for idx in range(1930, min(2065, len(lines))):
        f_out.write(f"{idx+1}: {lines[idx]}")

print("Dumped lines 1931 to 2065 of ServantDashboard.jsx")
