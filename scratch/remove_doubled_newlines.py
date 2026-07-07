with open('src/pages/ServantDashboard.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.splitlines()
new_lines = []
empty_count = 0
for idx in range(1, len(lines), 2):
    if lines[idx].strip() == '':
        empty_count += 1

is_doubled = empty_count > (len(lines) // 4)
print("Alternate empty lines count:", empty_count, "Is doubled:", is_doubled)

if is_doubled:
    for idx in range(len(lines)):
        if idx % 2 == 0:
            new_lines.append(lines[idx])
        else:
            if lines[idx].strip() != '':
                new_lines.append(lines[idx])
    
    with open('src/pages/ServantDashboard.jsx', 'w', encoding='utf-8', newline='\r\n') as f:
        f.write('\n'.join(new_lines))
    print("Cleaned up alternate empty lines. Total lines now:", len(new_lines))
else:
    print("File doesn't seem to be alternate-doubled.")
