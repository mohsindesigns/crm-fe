'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onCancel: () => void;
  onCapture: (file: File) => void;
}

/**
 * Webcam / device-camera capture for profile photos.
 * Captures a still frame and hands a JPEG File to the existing cropper flow.
 */
export default function ProfilePhotoCapture({ open, onCancel, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setReady(false);
    setBusy(false);

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error('Camera is not supported in this browser.');
        onCancel();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
          setReady(true);
        }
      } catch {
        toast.error('Could not access the camera. Allow camera permission and try again.');
        onCancel();
      }
    }

    start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    // Intentionally only re-run when the modal opens/closes — not when onCancel identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function handleCancel() {
    stopStream();
    onCancel();
  }

  function handleCapture() {
    const video = videoRef.current;
    if (!video || !ready || busy) return;
    setBusy(true);
    try {
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      // Mirror so the still matches the mirrored preview
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            toast.error('Could not capture photo. Try again.');
            setBusy(false);
            return;
          }
          const file = new File([blob], `profile-capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
          stopStream();
          onCapture(file);
        },
        'image/jpeg',
        0.92,
      );
    } catch {
      toast.error('Could not capture photo. Try again.');
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleCancel} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Take profile photo</h3>
            <p className="text-xs text-gray-500 mt-0.5">Center your face, then capture</p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="relative bg-gray-900 aspect-video">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
          />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
              Starting camera…
            </div>
          )}
          {/* Soft face guide */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="w-36 h-36 sm:w-44 sm:h-44 rounded-full border-2 border-white/40 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
          </div>
        </div>

        <div className="px-5 py-4 flex gap-2 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCapture}
            disabled={!ready || busy}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-brand-700 hover:bg-brand-800 rounded-lg transition-colors disabled:opacity-60"
          >
            <Camera className="w-4 h-4" />
            {busy ? 'Capturing…' : 'Capture'}
          </button>
        </div>
      </div>
    </div>
  );
}
