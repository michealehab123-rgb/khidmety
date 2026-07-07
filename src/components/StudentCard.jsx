import { QRCodeSVG } from 'qrcode.react';

import { Printer, User, Award } from 'lucide-react';



export default function StudentCard({ student }) {

  if (!student) return null;



  const handlePrint = (e) => {

    e.preventDefault();

    window.print();

  };



  return (

    <div className="w-full flex flex-col items-center justify-center">

      {/* Printable Card Container (Landscape, using container queries for responsiveness) */}

      <div 

        id={`student-card-${student.id}`}

        className="print-card-container w-full max-w-[500px] aspect-[85/54] bg-gradient-to-b from-blue-900 via-slate-905 to-slate-950 text-white rounded-[2.4cqw] p-[4%] shadow-2xl relative overflow-hidden flex flex-col justify-between border-[0.4cqw] border-amber-500/30"

        dir="rtl"

      >

        {/* Background Decorative Circles */}

        <div className="absolute -top-[12cqw] -right-[12cqw] w-[32cqw] h-[32cqw] bg-blue-600/15 rounded-full blur-[4.8cqw] pointer-events-none"></div>

        <div className="absolute -bottom-[12cqw] -left-[12cqw] w-[32cqw] h-[32cqw] bg-teal-500/15 rounded-full blur-[4.8cqw] pointer-events-none"></div>

        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[38cqw] h-[38cqw] bg-amber-500/5 rounded-full blur-[6cqw] pointer-events-none"></div>



        {/* Header Section */}

        <div className="text-center z-10 border-b border-white/10 pb-[2.5%] mb-[1%] relative">

          <img 

            src="/m.png" 

            alt="logo" 

            className="absolute right-[2cqw] top-[42%] -translate-y-1/2 w-[11cqw] h-[11cqw] object-contain pointer-events-none"

          />

          <h2 className="text-[3.2cqw] font-black tracking-wide bg-gradient-to-l from-amber-400 to-yellow-300 bg-clip-text text-transparent">

            كنيسة السيدة العذراء مريم

          </h2>

          <p className="text-[2cqw] font-bold text-slate-400 uppercase tracking-widest mt-[0.5%]">

            خدمة مدارس الأحد

          </p>

        </div>



        {/* Body Section (Horizontal Split) */}

        <div className="flex flex-1 items-center justify-between my-[2%] z-10 gap-[4.8cqw]">

          {/* Right side visually (First in RTL DOM): Avatar, Name & Code */}

          <div className="flex flex-col items-center justify-center text-center w-1/2 space-y-[2.4cqw]">

            {/* Avatar Circle */}

            <div className="relative">

              <div className="w-[16cqw] h-[16cqw] bg-slate-800 rounded-full flex items-center justify-center border-[0.4cqw] border-amber-500/40 shadow-inner overflow-hidden">

                {student.photoUrl ? (

                  <img 

                    src={student.photoUrl} 

                    alt={student.name} 

                    className="w-full h-full object-cover"

                  />

                ) : (

                  <User className="w-[8cqw] h-[8cqw] text-amber-500" />

                )}

              </div>

              <div className="absolute -bottom-[0.5cqw] -right-[0.5cqw] bg-amber-500 text-slate-950 p-[1cqw] rounded-full shadow-md flex items-center justify-center">

                <Award className="w-[3cqw] h-[3cqw] stroke-[3]" />

              </div>

            </div>



            {/* Student Name and ID */}

            <div className="space-y-[0.8cqw] w-full">

              <h3 className="text-[3.6cqw] font-black tracking-tight text-white drop-shadow-md truncate max-w-full px-[1.5cqw]">

                {student.name}

              </h3>

              

              <div className="inline-flex items-center gap-[1.2cqw] bg-slate-800/80 px-[2cqw] py-[0.4cqw] rounded-full border border-white/5">

                <span className="text-[1.8cqw] font-bold text-slate-400">كود المخدوم:</span>

                <span className="text-[2.4cqw] font-black text-amber-400 font-mono">{student.code}</span>

              </div>

            </div>

          </div>



          {/* Left side visually (Second in RTL DOM): Badges & QR Code */}

          <div className="flex flex-col items-center gap-[2cqw] w-1/2">

            {/* Badges row */}

            <div className="flex gap-[1.6cqw] w-full justify-center">

              <div className="bg-white/5 rounded-[1.6cqw] p-[1.5cqw] border border-white/5 text-center flex-1 min-w-0">

                <span className="block text-[1.6cqw] font-bold text-slate-400">الفصل</span>

                <span className="text-[2.2cqw] font-black text-slate-200 block truncate">{student.assignedClass || 'غير محدد'}</span>

              </div>

              <div className="bg-white/5 rounded-[1.6cqw] p-[1.5cqw] border border-white/5 text-center flex-1 min-w-0">

                <span className="block text-[1.6cqw] font-bold text-slate-400">المرحلة</span>

                <span className="text-[2.2cqw] font-black text-slate-200 block truncate">{student.schoolGrade || 'غير محدد'}</span>

              </div>

            </div>

            {/* QR Code */}

            <div className="bg-white p-[2cqw] rounded-[2cqw] shadow-lg border border-amber-500/20 transform transition-transform hover:scale-105 flex items-center justify-center">

              <div className="w-[19cqw] h-[19cqw] flex items-center justify-center">

                <QRCodeSVG 

                  value={student.id} 

                  style={{ width: '100%', height: '100%' }}

                  level="H"

                  includeMargin={false}

                  fgColor="#0f172a"

                />

              </div>

            </div>

          </div>

        </div>



        {/* Footer Section */}

        <div className="text-center z-10 border-t border-white/10 pt-[1.6cqw] flex justify-between items-center text-[1.8cqw] font-semibold text-slate-400">

          <span>كارنيه التحضير الذكي للأنشطة</span>

          <span className="text-amber-500/80 font-black">2026 / 2027</span>

        </div>

      </div>



      {/* Action Buttons (Hidden when printing) */}

      <div className="mt-6 w-full max-w-[500px] no-print flex gap-3">

        <button

          onClick={handlePrint}

          className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-l from-blue-600 to-teal-500 hover:from-blue-700 hover:to-teal-600 text-white font-black text-sm py-3 px-5 rounded-2xl transition-all shadow-lg hover:shadow-xl active:scale-95 cursor-pointer"

        >

          <Printer size={16} />

          <span>طباعة الكارنيه</span>

        </button>

      </div>



      {/* Global CSS for Container Queries and Print Layout */}

      <style>{`

        .print-card-container {

          container-type: inline-size;

          container-name: card;

          box-sizing: border-box;

        }



        @media print {

          /* Force printed page dimensions to match the card exactly */

          @page {

            size: 8.5cm 5.4cm;

            margin: 0;

          }

          

          /* Neutralize and reset intermediate container elements to prevent shifting */

          html, body, #root, #root *:not(#student-card-${student.id}):not(#student-card-${student.id} *) {

            position: static !important;

            transform: none !important;

            margin: 0 !important;

            padding: 0 !important;

            height: 0 !important;

            width: 0 !important;

            overflow: visible !important;

            box-shadow: none !important;

            filter: none !important;

            backdrop-filter: none !important;

          }

          

          html, body {

            width: 8.5cm !important;

            height: 5.4cm !important;

            overflow: hidden !important;

            background-color: transparent !important;

            -webkit-print-color-adjust: exact !important;

            print-color-adjust: exact !important;

          }

          

          body * {

            visibility: hidden;

          }

          

          /* Only make the student card and its contents visible */

          #student-card-${student.id},

          #student-card-${student.id} * {

            visibility: visible !important;

          }

          

          #student-card-${student.id} {

            position: absolute !important;

            left: 0 !important;

            top: 0 !important;

            transform: none !important;

            margin: 0 !important;

            width: 8.5cm !important;

            height: 5.4cm !important;

            border-radius: 0.2cm !important;

            border: 0.03cm solid rgba(245, 158, 11, 0.3) !important;

            box-sizing: border-box !important;

            /* Ensure the background gradient prints cleanly */

            background: linear-gradient(to bottom, #1e3a8a, #0f172a, #020617) !important;

            -webkit-print-color-adjust: exact !important;

            print-color-adjust: exact !important;

          }



          /* Fix clipped text transparent gradient bug in printing */

          #student-card-${student.id} h2 {

            background: none !important;

            -webkit-background-clip: unset !important;

            background-clip: unset !important;

            -webkit-text-fill-color: #fbbf24 !important;

            color: #fbbf24 !important;

          }

          

          .no-print {

            display: none !important;

          }

        }

      `}</style>

    </div>

  );

}

