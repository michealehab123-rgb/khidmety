import os
import re

search_dir = "."
pattern = re.compile(r"(fcm|token)", re.IGNORECASE)

for root, dirs, files in os.walk(search_dir):
    # skip node_modules and .git
    if "node_modules" in dirs:
        dirs.remove("node_modules")
    if ".git" in dirs:
        dirs.remove(".git")
    if ".firebase" in dirs:
        dirs.remove(".firebase")
    for file in files:
        if file.endswith((".js", ".jsx", ".html", ".json")):
            path = os.path.join(root, file)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    for i, line in enumerate(f, 1):
                        if pattern.search(line):
                            print(f"{path}:{i}: {line.strip()}")
            except Exception as e:
                pass
