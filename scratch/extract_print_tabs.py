def extract_function(path, start_pattern, end_pattern, output_path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    start_idx = content.find(start_pattern)
    if start_idx == -1:
        print(f"Could not find start pattern in {path}")
        return
    
    # Simple brace or parent-level tracking
    # Let's just find the end of the block by matching the next closing bracket or let's extract 180 lines
    lines = content[start_idx:].splitlines()[:280]
    
    with open(output_path, 'w', encoding='utf-8') as f_out:
        f_out.write("\n".join(lines))

extract_function('src/pages/AdminDashboard.jsx', 'const renderPrintCardsTab = () =>', 'xxx', 'scratch/admin_render_print_cards.txt')
extract_function('src/pages/ServantDashboard.jsx', 'const renderPrintCardsTab = () =>', 'xxx', 'scratch/servant_render_print_cards.txt')
print("Extracted renderPrintCardsTab functions.")
