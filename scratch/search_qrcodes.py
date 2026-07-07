import os

def search_dir(dir_path, term):
    print(f"=== SEARCHING '{term}' in {dir_path} ===")
    for root, dirs, files in os.walk(dir_path):
        for file in files:
            if file.endswith('.jsx') or file.endswith('.js'):
                path = os.path.join(root, file)
                with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                if term in content:
                    lines = content.splitlines()
                    matches = [i+1 for i, line in enumerate(lines) if term in line]
                    print(f"File {path}: found at lines {matches}")

search_dir('src', 'QRCodeSVG')
search_dir('src', 'QRCode')
