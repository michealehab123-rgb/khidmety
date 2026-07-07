with open("src/components/NotificationSettings.jsx", "r", encoding="cp1256") as f:
    content = f.read()

import re

# Remove comments to avoid false matches
content_clean = re.sub(r'\{\/\*.*?\*\/\s*\}', '', content, flags=re.DOTALL)
content_clean = re.sub(r'\/\/.*?\n', '\n', content_clean)

tags = []
pos = 0
n = len(content_clean)

while pos < n:
    if content_clean[pos] == '<':
        end_pos = pos + 1
        in_double_quote = False
        in_single_quote = False
        in_brace = 0
        
        while end_pos < n:
            c = content_clean[end_pos]
            if c == '"' and not in_single_quote:
                in_double_quote = not in_double_quote
            elif c == "'" and not in_double_quote:
                in_single_quote = not in_single_quote
            elif c == '{' and not in_double_quote and not in_single_quote:
                in_brace += 1
            elif c == '}' and not in_double_quote and not in_single_quote:
                in_brace -= 1
            elif c == '>' and not in_double_quote and not in_single_quote and in_brace == 0:
                break
            end_pos += 1
            
        if end_pos < n:
            tag_text = content_clean[pos:end_pos+1]
            line_no = content_clean[:pos].count('\n') + 1
            tags.append((tag_text, line_no))
            pos = end_pos + 1
        else:
            pos += 1
    else:
        pos += 1

print("--- Tags around line 1050-1060 ---")
for tag, line in tags:
    if 1050 <= line <= 1062:
        print(f"Line {line}: {repr(tag)}")

print("--- Tags around line 1670-1680 ---")
for tag, line in tags:
    if 1670 <= line <= 1682:
        print(f"Line {line}: {repr(tag)}")
