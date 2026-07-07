import re

def search_file(path, keywords, output_path):
    out_lines = []
    out_lines.append(f"=== SEARCHING {path} ===")
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    lines = content.splitlines()
    for i, line in enumerate(lines):
        for kw in keywords:
            if kw in line:
                out_lines.append(f"Line {i+1}: {line.strip()[:100]}")
                # print 10 lines before and after to get full context
                start = max(0, i - 15)
                end = min(len(lines), i + 15)
                for j in range(start, end):
                    prefix = "--> " if j == i else "    "
                    out_lines.append(f"{prefix}{j+1}: {lines[j]}")
                out_lines.append("-" * 40)
                break
                
    with open(output_path, 'w', encoding='utf-8') as f_out:
        f_out.write("\n".join(out_lines))

search_file('src/pages/AdminDashboard.jsx', ['window.print', 'print_cards', 'print:', 'print-card', 'card-to-print'], 'scratch/admin_print_search_results.txt')
print("Done searching.")
