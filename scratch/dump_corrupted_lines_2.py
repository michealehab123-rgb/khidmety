with open('src/pages/ServantDashboard.jsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

with open('scratch/inspect_corrupted_lines_part2.txt', 'w', encoding='utf-8') as f_out:
    for idx in range(1840, min(1950, len(lines))):
        f_out.write(f"{idx+1}: {lines[idx]}")

print("Dumped lines 1841 to 1950")
