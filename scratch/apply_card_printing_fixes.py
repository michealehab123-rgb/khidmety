import os

with open('src/pages/AdminDashboard.jsx', 'r', encoding='utf-8') as f:
    admin_content = f.read()

with open('src/pages/ServantDashboard.jsx', 'r', encoding='utf-8') as f:
    servant_content = f.read()

# Normalize CRLF to LF in memory
admin_lf = admin_content.replace('\r\n', '\n')
servant_lf = servant_content.replace('\r\n', '\n')

admin_start_idx = admin_lf.find('{/* Bulk Print Container */}')
if admin_start_idx == -1:
    print("Error: Could not find bulk print container in AdminDashboard")
    exit(1)

# Find the end of AdminDashboard component. Since the component is the main export default,
# the last character before export or at the very end of the file is '}'
admin_end_idx = admin_lf.rfind('}')
if admin_end_idx == -1:
    print("Error: Could not find end bracket in AdminDashboard")
    exit(1)

admin_block = admin_lf[admin_start_idx : admin_end_idx]

servant_start_idx = servant_lf.find('{/* Bulk Print Container */}')
if servant_start_idx == -1:
    print("Error: Could not find bulk print container in ServantDashboard")
    exit(1)

servant_end_idx = servant_lf.rfind('}')
if servant_end_idx == -1:
    print("Error: Could not find end bracket in ServantDashboard")
    exit(1)

# Construct new servant content
new_servant_lf = servant_lf[:servant_start_idx] + admin_block + servant_lf[servant_end_idx:]

# Convert back to CRLF
new_servant_content = new_servant_lf.replace('\n', '\r\n')

with open('src/pages/ServantDashboard.jsx', 'w', encoding='utf-8') as f:
    f.write(new_servant_content)

print("Parity fix successfully applied!")
