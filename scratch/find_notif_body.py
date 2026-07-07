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
            
            if ".body" in content or "body:" in content:
                # print any lines containing .body or body:
                lines = content.splitlines()
                for idx, line in enumerate(lines):
                    if ".body" in line or "body:" in line:
                        if "notif" in line or "notification" in line or "log" in line:
                            print(f"{filepath}:{idx+1}: {line.strip()}")
