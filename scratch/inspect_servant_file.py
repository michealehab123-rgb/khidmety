with open('src/pages/ServantDashboard.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.splitlines()

# Search for component/function declarations
print("=== DECLARATIONS IN ServantDashboard.jsx ===")
for idx, line in enumerate(lines):
    if line.startswith('export default') or line.startswith('function ') or line.startswith('const ') and ' = ' in line and ('=>' in line or 'function' in line):
        if len(line.strip()) < 100:
            print(f"Line {idx+1}: {line.strip()}")
