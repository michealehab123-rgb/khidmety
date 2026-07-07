import os

filepath = "src/components/NotificationModal.jsx"
for enc in ['utf-8', 'cp1256', 'windows-1252']:
    try:
        with open(filepath, "r", encoding=enc) as f:
            content = f.read()
            print(f"Read {filepath} with {enc} successfully. Length: {len(content)}")
            # print the first 20 lines
            lines = content.splitlines()
            for i in range(min(20, len(lines))):
                print(f"{i+1}: {lines[i]}")
            break
    except Exception as e:
        print(f"Failed with {enc}: {e}")
