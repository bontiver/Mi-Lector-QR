import React, { useState, useRef, DragEvent, ChangeEvent, useEffect } from 'react';
import { Upload, Image as ImageIcon, Link as LinkIcon, Copy, AlertCircle, CheckCircle2, QrCode, Camera, X } from 'lucide-react';
import jsQR from 'jsqr';
import * as pdfjsLib from 'pdfjs-dist';

// Configurar el worker de PDF.js apuntando a un CDN compatible con la misma versión
pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

type ScanResult = {
  type: 'url' | 'text' | 'error' | null;
  content: string;
};

export default function App() {
  const [isDragging, setIsDragging] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult>({ type: null, content: '' });
  const [copied, setCopied] = useState(false);
  const [isScanningCamera, setIsScanningCamera] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);

  const startCamera = async () => {
    try {
      setIsScanningCamera(true);
      setScanResult({ type: null, content: '' });
      setPreviewImage(null);
      setCopied(false);
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err) {
      console.error(err);
      setScanResult({ type: 'error', content: 'No se pudo acceder a la cámara. Revisa los permisos.' });
      setIsScanningCamera(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsScanningCamera(false);
  };

  useEffect(() => {
    let intervalId: number;
    if (isScanningCamera) {
      intervalId = window.setInterval(() => {
        if (!videoRef.current || videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) return;
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return;
        
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        
        if (canvas.width === 0 || canvas.height === 0) return;
        
        context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        
        if (code) {
          stopCamera();
          setPreviewImage(canvas.toDataURL('image/png'));
          handleSuccessfulDecode(code.data);
        }
      }, 500);
    }
    return () => clearInterval(intervalId);
  }, [isScanningCamera]);

  // Limpiar la cámara al desmontar
  useEffect(() => {
    return () => stopCamera();
  }, []);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = (file: File) => {
    if (file.type.match(/^image\/(jpeg|png|webp|gif)$/)) {
      setScanResult({ type: null, content: '' });
      setCopied(false);

      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        setPreviewImage(dataUrl);
        decodeQR(dataUrl);
      };
      reader.onerror = () => {
        setScanResult({ type: 'error', content: 'Hubo un error al leer el archivo.' });
      };
      reader.readAsDataURL(file);
    } else if (file.type === 'application/pdf') {
      setScanResult({ type: null, content: '' });
      setCopied(false);
      decodePDF(file);
    } else {
      setScanResult({ type: 'error', content: 'Por favor, sube una imagen válida (PNG, JPG, WEBP) o un archivo PDF.' });
      setPreviewImage(null);
    }
  };

  const decodePDF = async (file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        // Escalar la página para mejor resolución del QR
        const viewport = page.getViewport({ scale: 2.0 }); 
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) continue;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;
        
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        
        if (code) {
          setPreviewImage(canvas.toDataURL('image/png'));
          handleSuccessfulDecode(code.data);
          return;
        }
      }
      
      setScanResult({ type: 'error', content: 'No se encontró ningún código QR válido en el PDF.' });
      // Mostrar la primera página como vista previa si no se encontró QR
      if (pdf.numPages > 0) {
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.0 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (context) {
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: context, viewport }).promise;
          setPreviewImage(canvas.toDataURL('image/png'));
        }
      }
    } catch (err) {
      console.error(err);
      setScanResult({ type: 'error', content: 'Ocurrió un error al procesar el archivo PDF.' });
    }
  };

  const decodeQR = (dataUrl: string) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      
      if (!context) {
        setScanResult({ type: 'error', content: 'Error al inicializar el procesador de imágenes.' });
        return;
      }

      canvas.width = image.width;
      canvas.height = image.height;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      
      try {
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code) {
          handleSuccessfulDecode(code.data);
        } else {
          setScanResult({ type: 'error', content: 'No se encontró ningún código QR válido en la imagen.' });
        }
      } catch (err) {
        console.error(err);
        setScanResult({ type: 'error', content: 'Ocurrió un error al decodificar la imagen.' });
      }
    };
    image.src = dataUrl;
  };

  const handleSuccessfulDecode = (data: string) => {
    const isUrl = (str: string) => {
      try {
        new URL(str);
        return true;
      } catch {
        return false;
      }
    };

    if (isUrl(data)) {
      setScanResult({ type: 'url', content: data });
      // Open in new tab automatically
      window.open(data, '_blank', 'noopener,noreferrer');
    } else {
      setScanResult({ type: 'text', content: data });
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(scanResult.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const resetScanner = () => {
    setPreviewImage(null);
    setScanResult({ type: null, content: '' });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    stopCamera();
  };

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (e.clipboardData && e.clipboardData.files.length > 0) {
        const file = e.clipboardData.files[0];
        if (file.type.match(/^image\/(jpeg|png|webp|gif)$/) || file.type === 'application/pdf') {
          e.preventDefault();
          processFile(file);
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  });

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background Atmosphere */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/10 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[120px]"></div>
      </div>
      
      {/* Decorative Grid Overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(#ffffff05_1px,transparent_1px)] [background-size:32px_32px] pointer-events-none"></div>

      <div className="z-10 w-full max-w-3xl flex flex-col gap-8">
        {/* Header Section */}
        <header className="text-center space-y-2 mt-8 md:mt-0">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-4">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-xs font-medium uppercase tracking-widest text-emerald-400">Procesamiento Local</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-transparent italic pb-1">
            Lector QR Instantáneo
          </h1>
          <p className="text-zinc-400 text-lg max-w-lg mx-auto">
            Sube una captura de pantalla, imagen o PDF con un código QR. Lo decodificaremos al instante.
          </p>
        </header>

        {/* Main Content Area */}
        {!previewImage && !isScanningCamera ? (
          <div className="relative group mx-auto w-full max-w-2xl mt-4">
            <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-blue-600 rounded-3xl blur opacity-20 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"></div>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                relative h-[340px] w-full bg-zinc-900/80 backdrop-blur-xl border-2 border-dashed rounded-3xl flex flex-col items-center justify-center p-8 text-center transition-all cursor-pointer
                ${isDragging 
                  ? 'border-emerald-500/80 bg-zinc-800/80' 
                  : 'border-zinc-700 hover:border-emerald-500/50'
                }
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png, image/jpeg, image/webp, application/pdf"
                onChange={handleFileSelect}
                className="hidden"
              />
              
              <div className={`mb-6 p-5 rounded-2xl border transition-all duration-300 group-hover:scale-110
                ${isDragging ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-zinc-800 border-zinc-700 text-emerald-500'}`}>
                <Upload className="w-10 h-10" />
              </div>
              
              <div className="space-y-2 mb-8">
                <h3 className="text-xl font-semibold text-white tracking-wide">Arrastra, pega o selecciona</h3>
                <p className="text-zinc-500 text-sm max-w-[280px] mx-auto">
                  Compatible con PNG, JPG, WEBP y PDF. Puedes presionar Ctrl+V para pegar.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm pointer-events-auto">
                <button className="flex-1 px-4 py-3 bg-white text-black font-bold rounded-xl hover:bg-emerald-400 transition-colors shadow-lg shadow-white/5 pointer-events-none">
                  Subir archivo
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); startCamera(); }}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-zinc-800/80 hover:bg-zinc-700 text-emerald-400 font-bold rounded-xl transition-colors border border-zinc-700"
                >
                  <Camera className="w-5 h-5" />
                  Cámara
                </button>
              </div>
            </div>
          </div>
        ) : isScanningCamera ? (
          <div className="relative mx-auto w-full max-w-2xl mt-4">
            <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-blue-600 rounded-3xl blur opacity-20"></div>
            <div className="relative bg-zinc-900/80 backdrop-blur-xl border border-zinc-700 rounded-3xl p-6 md:p-8 space-y-6 flex flex-col items-center">
              <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-zinc-950/50 border border-zinc-800 flex items-center justify-center">
                <video 
                  ref={videoRef}
                  className="w-full h-full object-contain"
                  playsInline
                />
                <div className="absolute inset-0 border-2 border-emerald-500/30 rounded-2xl pointer-events-none"></div>
                <div className="absolute w-[60%] h-[60%] border-2 border-dashed border-emerald-500/70 rounded-xl pointer-events-none opacity-50 animate-pulse"></div>
              </div>
              <p className="text-zinc-400 text-sm animate-pulse">Apuntando al código QR...</p>
              <button
                onClick={stopCamera}
                className="w-full sm:w-auto px-8 py-3 bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <X className="w-4 h-4" />
                Cancelar cámara
              </button>
            </div>
          </div>
        ) : (
          <div className="relative mx-auto w-full max-w-2xl mt-4">
            <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-blue-600 rounded-3xl blur opacity-20"></div>
            <div className="relative bg-zinc-900/80 backdrop-blur-xl border border-zinc-700 rounded-3xl p-6 md:p-8 space-y-6">
              {/* Image Preview */}
              <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-zinc-950/50 border border-zinc-800 flex items-center justify-center">
                <img 
                  src={previewImage} 
                  alt="Preview" 
                  className="max-w-full max-h-full object-contain"
                />
              </div>

              {/* Status / Results */}
              <div className="space-y-4">
                {scanResult.type === 'error' && (
                  <div className="flex items-start gap-3 p-4 bg-red-500/10 text-red-400 rounded-2xl border border-red-500/20">
                    <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                    <p className="text-sm font-medium">{scanResult.content}</p>
                  </div>
                )}

                {scanResult.type === 'url' && (
                  <div className="space-y-3">
                    <div className="flex items-start gap-3 p-4 bg-emerald-500/10 text-emerald-400 rounded-2xl border border-emerald-500/20">
                      <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-emerald-300">¡Enlace detectado y abierto!</p>
                        <p className="text-sm text-emerald-500/80 mt-1 break-all">{scanResult.content}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => window.open(scanResult.content, '_blank', 'noopener,noreferrer')}
                      className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-white text-black hover:bg-emerald-400 font-bold rounded-xl transition-colors shadow-lg shadow-white/5"
                    >
                      <LinkIcon className="w-4 h-4" />
                      Volver a abrir enlace
                    </button>
                  </div>
                )}

                {scanResult.type === 'text' && (
                  <div className="space-y-3">
                    <div className="flex items-start gap-3 p-4 bg-blue-500/10 text-blue-400 rounded-2xl border border-blue-500/20">
                      <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                      <div className="w-full">
                        <p className="text-sm font-semibold text-blue-300">Texto detectado</p>
                        <div className="mt-3 p-4 bg-zinc-950/50 rounded-xl border border-zinc-800">
                          <p className="text-sm text-zinc-300 whitespace-pre-wrap break-words">
                            {scanResult.content}
                          </p>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={copyToClipboard}
                      className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-white text-black hover:bg-blue-400 font-bold rounded-xl transition-colors shadow-lg shadow-white/5"
                    >
                      {copied ? (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          Copiado al portapapeles
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          Copiar texto
                        </>
                      )}
                    </button>
                  </div>
                )}

                <button
                  onClick={resetScanner}
                  className="w-full py-3 px-4 bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 text-sm font-bold rounded-xl transition-colors"
                >
                  Subir otra imagen
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer Info */}
        <footer className="w-full max-w-2xl mx-auto flex justify-between items-center px-4 py-6 border-t border-zinc-800/50 mt-auto">
          <div className="flex items-center gap-6">
            <div className="flex flex-col">
              <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Seguridad</span>
              <span className="text-xs text-zinc-400">Procesado Local</span>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Estado</span>
            <p className="text-xs text-zinc-400 italic font-serif">Lista para decodificar</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
