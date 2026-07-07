import os

search_dir = "."
patterns = ["send-notification", "vercel.app"]

for root, dirs, files in os.walk(search_dir):
    if "node_modules" in dirs:
        dirs.remove("node_modules")
    if ".git" in dirs:
        dirs.remove(".git")
    for file in files:
        path = os.path.join(root, file)
        try:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
                for p in patterns:
                    if p.lower() in content.lower():
                        print(f"Found '{p}' in {path}")
        except Exception:
            pass
