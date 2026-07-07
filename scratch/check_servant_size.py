with open('src/pages/ServantDashboard.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

print("File size (chars):", len(content))
lines = content.splitlines()
print("Total lines in ServantDashboard.jsx:", len(lines))
