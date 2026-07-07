with open("src/pages/AdminDashboard.jsx", "r", encoding="cp1256") as f:
    content = f.read()

# Find the button block
import re
pattern = r'\n\s*<button\s*\n\s*\n\s*\n\s*onClick=\(\)\s*=>\s*setSearchParams\(\{\s*tab:\s*\'notifications\'\s*\}\)\s*\n\s*\n\s*\n\s*className=\{`flex-1 py-3 px-2 rounded-xl[^`]+notifications[^`]+`\}\s*\n\s*\n\s*\n\s*>\s*\n\s*\n\s*\n\s*الإشعارات 🔔\s*\n\s*\n\s*\n\s*</button>'

match = re.search(pattern, content)
if match:
    print("Found notifications button in AdminDashboard.jsx! Removing it...")
    content_new = content[:match.start()] + content[match.end():]
    with open("src/pages/AdminDashboard.jsx", "w", encoding="cp1256") as f:
        f.write(content_new)
    print("Successfully removed from AdminDashboard.jsx!")
else:
    print("Notifications button NOT found in AdminDashboard.jsx via regex pattern.")
    # Fallback to direct substring search or print match helper
