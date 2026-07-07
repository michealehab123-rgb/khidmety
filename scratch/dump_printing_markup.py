def extract_bulk_print_container(path, output_path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    start_idx = content.find('{/* Bulk Print Container */}')
    if start_idx == -1:
        start_idx = content.find('bulk-print-container')
    
    # find activeTab === 'print_cards' or similar
    # Let's extract around line 2045 to 2290 for Admin, and line 2106 to 2288 for Servant
    lines = content.splitlines()
    if 'AdminDashboard' in path:
        chunk = lines[2040:2180]
    else:
        chunk = lines[2100:2220]
        
    with open(output_path, 'w', encoding='utf-8') as f_out:
        f_out.write("\n".join(chunk))

extract_bulk_print_container('src/pages/AdminDashboard.jsx', 'scratch/admin_bulk_print_chunk.txt')
extract_bulk_print_container('src/pages/ServantDashboard.jsx', 'scratch/servant_bulk_print_chunk.txt')
print("Done extracting bulk print chunks.")
