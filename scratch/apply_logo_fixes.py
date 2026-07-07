import os

files = ['src/pages/AdminDashboard.jsx', 'src/pages/ServantDashboard.jsx']

target_block = """                            {/* Header Section */}
                            <div className="text-center z-10 border-b border-white/10 pb-[2.5%] mb-[1%]">
                                <h2 className="text-[3.2cqw] font-black tracking-wide bg-gradient-to-l from-amber-400 to-yellow-300 bg-clip-text text-transparent">
                                    كنيسة السيدة العذراء مريم
                                </h2>
                                <p className="text-[2cqw] font-bold text-slate-400 uppercase tracking-widest mt-[0.5%]">
                                    خدمة مدارس الأحد
                                </p>
                            </div>"""

replacement_block = """                            {/* Header Section */}
                            <div className="text-center z-10 border-b border-white/10 pb-[2.5%] mb-[1%] relative">
                                <img 
                                    src="/m.png" 
                                    alt="logo" 
                                    className="absolute right-[2cqw] top-1/2 -translate-y-1/2 w-[8cqw] h-[8cqw] object-contain pointer-events-none"
                                />
                                <h2 className="text-[3.2cqw] font-black tracking-wide bg-gradient-to-l from-amber-400 to-yellow-300 bg-clip-text text-transparent">
                                    كنيسة السيدة العذراء مريم
                                </h2>
                                <p className="text-[2cqw] font-bold text-slate-400 uppercase tracking-widest mt-[0.5%]">
                                    خدمة مدارس الأحد
                                </p>
                            </div>"""

for path in files:
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Normalize CRLF to LF in memory for replacement
    content_lf = content.replace('\r\n', '\n')
    target_block_lf = target_block.replace('\r\n', '\n')
    replacement_block_lf = replacement_block.replace('\r\n', '\n')
    
    if target_block_lf in content_lf:
        new_content_lf = content_lf.replace(target_block_lf, replacement_block_lf)
        new_content = new_content_lf.replace('\n', '\r\n')
        with open(path, 'w', encoding='utf-8', newline='\r\n') as f:
            f.write(new_content)
        print(f"Successfully added top-right logo to printed cards in {path}")
    else:
        print(f"Error: Could not find target header block in {path}")
