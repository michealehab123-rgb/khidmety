with open("src/components/NotificationSettings.jsx", "r", encoding="cp1256") as f:
    content = f.read()

import re
# find log.senderName in the file, and print 10 lines before and after it
idx = content.find("log.senderName")
if idx != -1:
    start_pos = max(0, idx - 400)
    end_pos = min(len(content), idx + 400)
    snippet = content[start_pos:end_pos]
    print("Found senderName snippet:")
    print(repr(snippet.encode('utf-8')))
else:
    print("log.senderName not found.")
