# Read NotificationSettings.jsx as cp1256
with open("src/components/NotificationSettings.jsx", "r", encoding="cp1256") as f:
    content = f.read()

target = """                </div>
              </div>
            )
          )}"""

replacement = """                </div>
              </div>
            </div>
            )
          )}"""

if target in content:
    print("Target block found. Applying replacement...")
    content_fixed = content.replace(target, replacement)
    
    with open("src/components/NotificationSettings.jsx", "w", encoding="cp1256") as f:
        f.write(content_fixed)
    print("Replacement applied and saved successfully in cp1256!")
else:
    print("Target block not found. No changes made.")
