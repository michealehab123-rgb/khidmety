with open('src/pages/ServantDashboard.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

content_lf = content.replace('\r\r\n', '\n').replace('\r\n', '\n').replace('\r', '\n')
content_crlf = content_lf.replace('\n', '\r\n')

with open('src/pages/ServantDashboard.jsx', 'w', encoding='utf-8') as f:
    f.write(content_crlf)

print("Line endings cleaned up.")
