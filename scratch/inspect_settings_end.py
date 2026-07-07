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

stack = []
for tag, line in tags:
    if tag.endswith('/>') and not tag.startswith('</'):
        continue
        
    # Get tag name
    if tag.startswith('</'):
        is_closing = True
        name = tag[2:-1].strip().split()[0] if len(tag) > 3 else ''
    else:
        is_closing = False
        name = tag[1:-1].strip().split()[0] if len(tag) > 2 else ''
        
    # Standardize names
    if name == '':
        name = 'fragment'
    elif name == 'div':
        name = 'div'
    else:
        continue # Ignore all other component tags
        
    should_print = 1190 <= line <= 1220
    
    if should_print:
        print(f"Line {line}: {'CLOSE' if is_closing else 'OPEN'} {name} ({tag})")
        print(f"  Stack before: {[x[0] for x in stack]}")
        
    if is_closing:
        if not stack:
            if should_print:
                print("  ERROR: Empty stack on close")
            continue
        top_name, top_line, top_tag = stack[-1]
        if name == top_name:
            stack.pop()
        else:
            if should_print:
                print(f"  MISMATCH: closing {name} doesn't match {top_name} from line {top_line}")
            stack.pop()
    else:
        stack.append((name, line, tag))
        
    if should_print:
        print(f"  Stack after: {[x[0] for x in stack]}")
