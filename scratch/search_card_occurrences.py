def search_occurrences(path, term):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    lines = content.splitlines()
    found = []
    for idx, line in enumerate(lines):
        if term in line:
            found.append(idx + 1)
    print(f"File {path}: found {term} on lines {found}")

search_occurrences('src/pages/ServantDashboard.jsx', 'print-card-container')
search_occurrences('src/pages/AdminDashboard.jsx', 'print-card-container')
