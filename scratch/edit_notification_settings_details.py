with open("src/components/NotificationSettings.jsx", "r", encoding="cp1256") as f:
    content = f.read()

trigger = "{log.senderName} ({log.senderRole})"
idx = content.find(trigger)

if idx != -1:
    # Find the start of the outer div
    start_str = '<div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-start gap-2 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800/50 shrink-0">'
    start_idx = content.rfind(start_str, 0, idx)
    
    # Find the end of the outer div
    idx_sent_count = content.find("log.sentCount", idx)
    first_close = content.find("</div>", idx_sent_count)
    second_close = content.find("</div>", first_close + len("</div>"))
    end_idx = second_close + len("</div>")
    
    print("Found exact block slice:")
    # Extract labels
    p_start = content.find('<p className="text-[10px] text-slate-400">', start_idx, idx) + len('<p className="text-[10px] text-slate-400">')
    p_end = content.find('</p>', p_start, idx)
    arabic_sender_label = content[p_start:p_end]
    
    div_start = content.find('bg-teal-500/10 text-teal-600 dark:text-teal-400 rounded-lg text-xs font-bold mt-1">', idx) + len('bg-teal-500/10 text-teal-600 dark:text-teal-400 rounded-lg text-xs font-bold mt-1">')
    div_end = content.find(': {log.sentCount}', div_start)
    arabic_recipients_label = content[div_start:div_end]
    
    replacement = '<div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-start gap-2 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800/50 shrink-0">\n'
    replacement += '                        <div className="text-right">\n'
    replacement += '                          <p className="text-[10px] text-slate-400">' + arabic_sender_label + '</p>\n'
    replacement += '                          <p className="text-xs font-bold text-slate-700 dark:text-slate-300">\n'
    replacement += '                            {log.senderName} ({log.senderRole})\n'
    replacement += '                          </p>\n'
    replacement += '                        </div>\n'
    replacement += '                        <div className="flex items-center gap-2 mt-1">\n'
    replacement += '                          <div className="px-3 py-1 bg-teal-500/10 text-teal-600 dark:text-teal-400 rounded-lg text-xs font-bold">\n'
    replacement += '                            ' + arabic_recipients_label + ': {log.sentCount}\n'
    replacement += '                          </div>\n'
    replacement += '                          <button\n'
    replacement += '                            onClick={() => handleDeleteSentNotification(log.id)}\n'
    replacement += '                            className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-500 rounded-lg transition-colors cursor-pointer border-none bg-transparent flex items-center justify-center"\n'
    replacement += '                            title="مسح الإشعار"\n'
    replacement += '                          >\n'
    replacement += '                            <Trash2 size={16} />\n'
    replacement += '                          </button>\n'
    replacement += '                        </div>\n'
    replacement += '                      </div>'
                      
    content_new = content[:start_idx] + replacement + content[end_idx:]
    with open("src/components/NotificationSettings.jsx", "w", encoding="cp1256") as f:
        f.write(content_new)
    print("Details block updated and saved successfully!")
else:
    print("log.senderName not found in file.")
