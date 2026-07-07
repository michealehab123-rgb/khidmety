with open('src/pages/ServantDashboard.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

start_idx = content.find('const renderPrintCardsTab = () =>')
if start_idx != -1:
    lines = content[start_idx:].splitlines()[:200]
    with open('scratch/servant_render_print_cards_full.txt', 'w', encoding='utf-8') as f_out:
        f_out.write("\n".join(lines))
else:
    print("Not found")
