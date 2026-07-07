# Remove notifications button from AdminDashboard.jsx
with open("src/pages/AdminDashboard.jsx", "r", encoding="cp1256") as f:
    content_admin = f.read()

target_admin = "onClick={() => setSearchParams({ tab: 'notifications' })}"
idx_admin = content_admin.find(target_admin)
if idx_admin != -1:
    start_btn = content_admin.rfind("<button", 0, idx_admin)
    end_btn = content_admin.find("</button>", idx_admin) + len("</button>")
    
    print("Admin button text to remove (safe representation):")
    print(repr(content_admin[start_btn:end_btn].encode('utf-8')))
    
    content_admin_new = content_admin[:start_btn] + content_admin[end_btn:]
    with open("src/pages/AdminDashboard.jsx", "w", encoding="cp1256") as f:
        f.write(content_admin_new)
    print("Removed from AdminDashboard.jsx successfully!")
else:
    print("Admin trigger not found.")

# Remove notifications button from ServantDashboard.jsx
with open("src/pages/ServantDashboard.jsx", "r", encoding="cp1256") as f:
    content_servant = f.read()

target_servant = "onClick={() => setActiveTab('notifications')}"
idx_servant = content_servant.find(target_servant)
if idx_servant != -1:
    start_btn = content_servant.rfind("<button", 0, idx_servant)
    end_btn = content_servant.find("</button>", idx_servant) + len("</button>")
    
    print("Servant button text to remove (safe representation):")
    print(repr(content_servant[start_btn:end_btn].encode('utf-8')))
    
    content_servant_new = content_servant[:start_btn] + content_servant[end_btn:]
    with open("src/pages/ServantDashboard.jsx", "w", encoding="cp1256") as f:
        f.write(content_servant_new)
    print("Removed from ServantDashboard.jsx successfully!")
else:
    print("Servant trigger not found.")
