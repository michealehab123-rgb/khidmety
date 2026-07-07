def extract_print_area(path, output_path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # We want to search for the directory printing table and header
    # Let's find "Print Header"
    start_idx = content.find('{/* Print Header */}')
    if start_idx == -1:
        start_idx = content.find('كشف المخدومين - مدرسة الأحد')
        
    if start_idx != -1:
        lines = content[start_idx-100:].splitlines()[:150]
        with open(output_path, 'w', encoding='utf-8') as f_out:
            f_out.write("\n".join(lines))
    else:
        print(f"Not found print header in {path}")

extract_print_area('src/pages/AdminDashboard.jsx', 'scratch/admin_directory_print_area.txt')
extract_print_area('src/pages/ServantDashboard.jsx', 'scratch/servant_directory_print_area.txt')
print("Extracted directory print areas.")
