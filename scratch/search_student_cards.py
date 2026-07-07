def search_file(path, terms):
    print(f"=== SEARCHING {path} ===")
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    lines = content.splitlines()
    for i, line in enumerate(lines):
        for term in terms:
            if term in line:
                print(f"Line {i+1}: {line.strip()[:120]}")
                break

search_file('src/pages/StudentDashboard.jsx', ['card', 'QRCode', 'aspect-', 'photo', 'm.png'])
