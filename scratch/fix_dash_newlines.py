with open('src/pages/ServantDashboard.jsx', 'rb') as f:
    data = f.read()

# Replace CRCRLF (\r\r\n) with LF (\n)
# Replace CRLF (\r\n) with LF (\n)
# Replace CR (\r) with LF (\n)
normalized = data.replace(b'\r\r\n', b'\n').replace(b'\r\n', b'\n').replace(b'\r', b'\n')

# Convert all LFs to CRLF (\r\n) for Windows compatibility
crlf_data = normalized.replace(b'\n', b'\r\n')

with open('src/pages/ServantDashboard.jsx', 'wb') as f:
    f.write(crlf_data)

print("Binary cleanup finished.")
