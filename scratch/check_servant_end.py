with open('src/pages/ServantDashboard.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Let's print the last 10 lines of ServantDashboard.jsx
lines = content.splitlines()
print("Total lines:", len(lines))
for idx in range(max(0, len(lines) - 15), len(lines)):
    print(f"{idx+1}: {repr(lines[idx])}")
