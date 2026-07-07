# Edit AdminDashboard.jsx
with open("src/pages/AdminDashboard.jsx", "r", encoding="cp1256") as f:
    content_admin = f.read()

target_admin = "if (!user) return <Navigate to=\"/admin/login\" replace />;"
idx_admin = content_admin.find(target_admin)
if idx_admin != -1:
    insertion = """
    if (activeTab === 'notifications') {
        return (
            <div className="max-w-6xl mx-auto px-4 py-8 min-h-[75vh]" dir="rtl">
                <NotificationSettings />
            </div>
        );
    }
"""
    content_admin_new = content_admin[:idx_admin + len(target_admin)] + insertion + content_admin[idx_admin + len(target_admin):]
    with open("src/pages/AdminDashboard.jsx", "w", encoding="cp1256") as f:
        f.write(content_admin_new)
    print("Successfully added early return in AdminDashboard.jsx!")
else:
    print("Admin dashboard target NOT found.")

# Edit ServantDashboard.jsx
with open("src/pages/ServantDashboard.jsx", "r", encoding="cp1256") as f:
    content_servant = f.read()

# We look for the main return statement:
#     return (
# 
# 
# 
#          <div className="max-w-6xl mx-auto px-4 py-8 min-h-[75vh]" dir="rtl">
target_servant = "return (\n\n\n\n          <div className=\"max-w-6xl mx-auto px-4 py-8 min-h-[75vh]\" dir=\"rtl\">"
# Let's search with flexible spacing to be 100% sure:
import re
pattern_servant = r'return\s*\(\s*\n\s*<div\s*className="max-w-6xl\s*mx-auto\s*px-4\s*py-8\s*min-h-\[75vh\]"\s*dir="rtl">'
match_servant = re.search(pattern_servant, content_servant)

if match_servant:
    idx_servant = match_servant.start()
    insertion = """if (activeTab === 'notifications') {
        return (
            <div className="max-w-6xl mx-auto px-4 py-8 min-h-[75vh]" dir="rtl">
                <NotificationSettings />
            </div>
        );
    }

    """
    content_servant_new = content_servant[:idx_servant] + insertion + content_servant[idx_servant:]
    with open("src/pages/ServantDashboard.jsx", "w", encoding="cp1256") as f:
        f.write(content_servant_new)
    print("Successfully added early return in ServantDashboard.jsx!")
else:
    print("Servant dashboard target NOT found via regex pattern.")
