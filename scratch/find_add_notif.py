import os

target_dir = "src"
for root, dirs, files in os.walk(target_dir):
    for file in files:
        if file.endswith((".jsx", ".js")):
            filepath = os.path.join(root, file)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
            except Exception:
                try:
                    with open(filepath, "r", encoding="cp1256") as f:
                        content = f.read()
                except Exception:
                    continue
            
            if "notifications" in content and "addDoc" in content:
                print(f"File: {filepath}")
                lines = content.splitlines()
                for idx, line in enumerate(lines):
                    if "addDoc" in line and "notifications" in line:
                        print(f"  Line {idx+1}: {line.strip()}")
