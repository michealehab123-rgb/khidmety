import os

target_dir = "src"
for root, dirs, files in os.walk(target_dir):
    for file in files:
        if file.endswith((".jsx", ".js")) and "AuthContext" in file:
            print(f"File: {os.path.join(root, file)}")
