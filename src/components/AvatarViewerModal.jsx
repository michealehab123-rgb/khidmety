import React, { useState, useRef } from 'react';
import { X, Camera, Check, Loader2, User, Trash2, ZoomIn, ZoomOut, RotateCcw, Move, Crop, Maximize2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function AvatarViewerModal({ isOpen, onClose, currentPhotoUrl, userName, userRole }) {
  const { updateProfilePhoto } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef(null);

  // Interactive Cropper States
  const [selectedImageSrc, setSelectedImageSrc] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [fitMode, setFitMode] = useState('cover'); // 'cover' or 'contain'

  if (!isOpen) return null;

  const handleDeletePhoto = async () => {
    if (!currentPhotoUrl) return;
    setUploading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      if (updateProfilePhoto) {
        await updateProfilePhoto(null);
        setSuccessMsg('تم حذف الصورة الشخصية بنجاح 🗑️');
        setTimeout(() => setSuccessMsg(''), 3000);
      }
    } catch (err) {
      console.error('Error deleting avatar image:', err);
      setErrorMsg('حدث خطأ أثناء حذف الصورة');
    } finally {
      setUploading(false);
    }
  };

  // Handle image file selection
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMsg('يرجى اختيار ملف صورة صالحة 🖼️');
      return;
    }

    if (file.size > 12 * 1024 * 1024) {
      setErrorMsg('حجم الصورة كبير جداً، اختر صورة أقل من 12 ميجابايت ⚠️');
      return;
    }

    setErrorMsg('');
    setSuccessMsg('');

    const reader = new FileReader();
    reader.onload = (event) => {
      setSelectedImageSrc(event.target.result);
      setZoom(1);
      setPosition({ x: 0, y: 0 });
      setFitMode('contain'); // Default to full image display so nothing is auto-cropped!
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Mouse Dragging
  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch Dragging
  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({
        x: e.touches[0].clientX - position.x,
        y: e.touches[0].clientY - position.y
      });
    }
  };

  const handleTouchMove = (e) => {
    if (isDragging && e.touches.length === 1) {
      setPosition({
        x: e.touches[0].clientX - dragStart.x,
        y: e.touches[0].clientY - dragStart.y
      });
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  // Crop & Export to Base64
  const handleSaveCrop = async () => {
    if (!selectedImageSrc) return;
    setUploading(true);
    setErrorMsg('');

    try {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const OUTPUT_SIZE = 600; // Final canvas dimension px
        const FRAME_SIZE = 240; // Preview container dimension px
        const scaleFactor = OUTPUT_SIZE / FRAME_SIZE;

        canvas.width = OUTPUT_SIZE;
        canvas.height = OUTPUT_SIZE;
        const ctx = canvas.getContext('2d');

        // Draw background white
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

        const aspect = img.width / img.height;
        let drawW, drawH;

        if (fitMode === 'contain') {
          if (aspect > 1) {
            drawW = FRAME_SIZE;
            drawH = FRAME_SIZE / aspect;
          } else {
            drawH = FRAME_SIZE;
            drawW = FRAME_SIZE * aspect;
          }
        } else {
          if (aspect > 1) {
            drawH = FRAME_SIZE;
            drawW = FRAME_SIZE * aspect;
          } else {
            drawW = FRAME_SIZE;
            drawH = FRAME_SIZE / aspect;
          }
        }

        const finalW = drawW * zoom * scaleFactor;
        const finalH = drawH * zoom * scaleFactor;

        const centerX = OUTPUT_SIZE / 2 + position.x * scaleFactor;
        const centerY = OUTPUT_SIZE / 2 + position.y * scaleFactor;

        const drawX = centerX - finalW / 2;
        const drawY = centerY - finalH / 2;

        ctx.drawImage(img, drawX, drawY, finalW, finalH);

        const croppedBase64 = canvas.toDataURL('image/jpeg', 0.88);

        if (updateProfilePhoto) {
          await updateProfilePhoto(croppedBase64);
          setSuccessMsg('تم حفظ الصورة الشخصية بنجاح! ✨');
          setTimeout(() => setSuccessMsg(''), 3500);
        }
        setSelectedImageSrc(null);
        setUploading(false);
      };
      img.onerror = () => {
        setErrorMsg('فشل في معالجة الصورة، حاول اختيار صورة أخرى');
        setUploading(false);
      };
      img.src = selectedImageSrc;
    } catch (err) {
      console.error('Error cropping image:', err);
      setErrorMsg('حدث خطأ أثناء حفظ وقص الصورة');
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md animate-in fade-in duration-200" dir="rtl">
      <div className="relative w-full max-w-md bg-white dark:bg-[#1e293b] rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700/60 overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
              {selectedImageSrc ? (
                <>
                  <Crop size={20} className="text-blue-500" />
                  <span>تعديل وتحديد إطار الصورة</span>
                </>
              ) : (
                <span>الصورة الشخصية</span>
              )}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {userName || 'المستخدم'} • <span className="text-blue-500 font-bold">{userRole || ''}</span>
            </p>
          </div>
          <button
            onClick={() => {
              setSelectedImageSrc(null);
              onClose();
            }}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body Area */}
        <div className="p-6 flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900/50">
          
          {/* ── MODE 1: Interactive Crop & Position Mode ── */}
          {selectedImageSrc ? (
            <div className="w-full flex flex-col items-center gap-4">
              <div className="text-center">
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center justify-center gap-1">
                  <Move size={14} className="text-blue-500 animate-pulse" />
                  <span>اسحب الصورة للتحريك أو استخدم الشريط لضبط الحجم</span>
                </span>
              </div>

              {/* Interactive Crop Circular Frame */}
              <div
                className="relative w-60 h-60 rounded-full overflow-hidden border-4 border-blue-500 shadow-2xl bg-white dark:bg-slate-950 flex items-center justify-center cursor-move select-none touch-none group"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
              >
                <img
                  src={selectedImageSrc}
                  alt="Crop preview"
                  draggable={false}
                  className="max-w-none transition-transform duration-75 select-none"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: fitMode,
                    transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
                    transformOrigin: 'center'
                  }}
                />
                
                {/* Visual Circle Overlay Indicator */}
                <div className="absolute inset-0 rounded-full border-2 border-white/40 pointer-events-none shadow-inner" />
              </div>

              {/* Display Mode Toggles & Controls */}
              <div className="w-full bg-white dark:bg-[#1e293b] p-4 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm space-y-3">
                {/* Mode Buttons */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setFitMode('contain');
                      setZoom(1);
                      setPosition({ x: 0, y: 0 });
                    }}
                    className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                      fitMode === 'contain'
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    <Maximize2 size={14} />
                    <span>إظهار الصورة كاملة 🖼️</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setFitMode('cover');
                      setZoom(1);
                      setPosition({ x: 0, y: 0 });
                    }}
                    className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                      fitMode === 'cover'
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    <Crop size={14} />
                    <span>ملء الإطار بالكامل ✂️</span>
                  </button>
                </div>

                {/* Zoom Controls */}
                <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300 pt-1">
                  <span className="flex items-center gap-1">
                    <ZoomIn size={14} className="text-blue-500" />
                    <span>التحكم بالحجم:</span>
                  </span>
                  <span className="text-blue-600 dark:text-blue-400 font-extrabold">{Math.round(zoom * 100)}%</span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setZoom(prev => Math.max(0.3, prev - 0.15))}
                    className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 transition-colors"
                    title="تصغير"
                  >
                    <ZoomOut size={16} />
                  </button>

                  <input
                    type="range"
                    min="0.3"
                    max="3"
                    step="0.05"
                    value={zoom}
                    onChange={(e) => setZoom(parseFloat(e.target.value))}
                    className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600 dark:accent-blue-500"
                  />

                  <button
                    type="button"
                    onClick={() => setZoom(prev => Math.min(3, prev + 0.15))}
                    className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 transition-colors"
                    title="تكبير"
                  >
                    <ZoomIn size={16} />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setZoom(1);
                      setPosition({ x: 0, y: 0 });
                    }}
                    className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 transition-colors shrink-0"
                    title="إعادة ضبط الموضع"
                  >
                    <RotateCcw size={16} />
                  </button>
                </div>
              </div>

              {/* Crop Action Buttons */}
              <div className="w-full flex gap-2 pt-2">
                <button
                  onClick={handleSaveCrop}
                  disabled={uploading}
                  className="flex-1 py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-2xl shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 text-sm"
                >
                  {uploading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      <span>جاري حفظ الصورة...</span>
                    </>
                  ) : (
                    <>
                      <Check size={18} />
                      <span>اعتماد وحفظ الصورة ✨</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => setSelectedImageSrc(null)}
                  disabled={uploading}
                  className="py-3 px-4 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-2xl text-xs transition-colors disabled:opacity-50"
                >
                  إلغاء
                </button>
              </div>
            </div>
          ) : (
            /* ── MODE 2: Normal Image Display Mode ── */
            <div className="w-full flex flex-col items-center">
              <div className="relative group w-52 h-52 sm:w-60 sm:h-60 rounded-full overflow-hidden border-4 border-white dark:border-slate-700 shadow-xl bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center">
                {currentPhotoUrl ? (
                  <img
                    src={currentPhotoUrl}
                    alt={userName}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <User size={80} className="text-white/80" />
                )}

                {/* Hover overlay indicator */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center cursor-pointer text-white gap-2 backdrop-blur-[2px]"
                >
                  <Camera size={32} />
                  <span className="text-xs font-black bg-white/20 px-3 py-1 rounded-full backdrop-blur-md">
                    تغيير / تحديد الصورة
                  </span>
                </div>
              </div>

              {/* Hidden File Input */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                className="hidden"
              />

              {/* Standard Action Buttons */}
              <div className="mt-6 w-full flex flex-col gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full py-3 px-5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-2xl shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {uploading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      <span>جاري المعالجة...</span>
                    </>
                  ) : (
                    <>
                      <Camera size={18} />
                      <span>تحديد وتغيير الصورة الشخصية</span>
                    </>
                  )}
                </button>

                {currentPhotoUrl && (
                  <button
                    onClick={handleDeletePhoto}
                    disabled={uploading}
                    className="w-full py-2.5 px-4 bg-rose-50 dark:bg-rose-955/35 hover:bg-rose-100 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={16} />
                    <span>حذف الصورة الشخصية الحاليّة</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Messages */}
          {successMsg && (
            <div className="mt-3 flex items-center gap-2 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800">
              <Check size={16} />
              <span>{successMsg}</span>
            </div>
          )}
          {errorMsg && (
            <div className="mt-3 text-xs font-bold text-rose-500 bg-rose-50 dark:bg-rose-955/40 px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-800">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-white dark:bg-[#1e293b] border-t border-slate-100 dark:border-slate-800 flex justify-end">
          <button
            onClick={() => {
              setSelectedImageSrc(null);
              onClose();
            }}
            className="px-5 py-2 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
