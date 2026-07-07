import os

def update_logo_size_in_dashboards():
    files = ['src/pages/AdminDashboard.jsx', 'src/pages/ServantDashboard.jsx']
    target = 'w-[8cqw] h-[8cqw]'
    replacement = 'w-[11cqw] h-[11cqw]'
    
    for path in files:
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        if target in content:
            new_content = content.replace(target, replacement)
            with open(path, 'w', encoding='utf-8', newline='\r\n') as f:
                f.write(new_content)
            print(f"Updated logo size in {path}")
        else:
            print(f"Warning: '{target}' not found in {path}")

def update_student_card_component():
    path = 'src/components/StudentCard.jsx'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    content_lf = content.replace('\r\n', '\n')
    
    target_header = """        {/* Header Section */}
        <div className="text-center z-10 border-b border-white/10 pb-[2.5%] mb-[1%]">
          <h2 className="text-[3.2cqw] font-black tracking-wide bg-gradient-to-l from-amber-400 to-yellow-300 bg-clip-text text-transparent">
            كنيسة السيدة العذراء مريم
          </h2>
          <p className="text-[2cqw] font-bold text-slate-400 uppercase tracking-widest mt-[0.5%]">
            خدمة مدارس الأحد
          </p>
        </div>"""
        
    replacement_header = """        {/* Header Section */}
        <div className="text-center z-10 border-b border-white/10 pb-[2.5%] mb-[1%] relative">
          <img 
            src="/m.png" 
            alt="logo" 
            className="absolute right-[2cqw] top-1/2 -translate-y-1/2 w-[11cqw] h-[11cqw] object-contain pointer-events-none"
          />
          <h2 className="text-[3.2cqw] font-black tracking-wide bg-gradient-to-l from-amber-400 to-yellow-300 bg-clip-text text-transparent">
            كنيسة السيدة العذراء مريم
          </h2>
          <p className="text-[2cqw] font-bold text-slate-400 uppercase tracking-widest mt-[0.5%]">
            خدمة مدارس الأحد
          </p>
        </div>"""
        
    target_header_lf = target_header.replace('\r\n', '\n')
    replacement_header_lf = replacement_header.replace('\r\n', '\n')
    
    if target_header_lf in content_lf:
        new_content_lf = content_lf.replace(target_header_lf, replacement_header_lf)
        new_content = new_content_lf.replace('\n', '\r\n')
        with open(path, 'w', encoding='utf-8', newline='\r\n') as f:
            f.write(new_content)
        print(f"Successfully added logo to {path}")
    else:
        print(f"Error: Target header not found in {path}")

update_logo_size_in_dashboards()
update_student_card_component()
