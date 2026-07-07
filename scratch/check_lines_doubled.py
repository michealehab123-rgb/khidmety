with open('src/pages/ServantDashboard.jsx', 'r', encoding='utf-8', newline='') as f:
    content = f.read()

lines = content.split('\r\n')
print("Total lines with CRLF:", len(lines))
for idx in range(10, min(30, len(lines))):
    print(f"{idx+1}: {repr(lines[idx])}")
