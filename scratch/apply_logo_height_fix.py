import os

files = [
    'src/pages/AdminDashboard.jsx',
    'src/pages/ServantDashboard.jsx',
    'src/components/StudentCard.jsx'
]

target = 'top-1/2 -translate-y-1/2 w-[11cqw] h-[11cqw]'
replacement = 'top-[42%] -translate-y-1/2 w-[11cqw] h-[11cqw]'

for path in files:
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    if target in content:
        new_content = content.replace(target, replacement)
        with open(path, 'w', encoding='utf-8', newline='\r\n') as f:
            f.write(new_content)
        print(f"Successfully adjusted logo vertical height in {path}")
    else:
        # Check if CRLF/LF issues caused mismatch
        content_lf = content.replace('\r\n', '\n')
        target_lf = target.replace('\r\n', '\n')
        replacement_lf = replacement.replace('\r\n', '\n')
        if target_lf in content_lf:
            new_content_lf = content_lf.replace(target_lf, replacement_lf)
            new_content = new_content_lf.replace('\n', '\r\n')
            with open(path, 'w', encoding='utf-8', newline='\r\n') as f:
                f.write(new_content)
            print(f"Successfully adjusted logo vertical height in {path} (LF fallback)")
        else:
            print(f"Error: Target '{target}' not found in {path}")
