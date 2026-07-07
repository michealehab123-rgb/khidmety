with open('src/pages/ServantDashboard.jsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

with open('scratch/inspect_corrupted_lines.txt', 'w', encoding='utf-8') as f_out:
    for idx in range(1740, min(1860, len(lines))):
        f_out.write(f"{idx+1}: {lines[idx]}")

print("Dumped lines 1741 to 1860")
