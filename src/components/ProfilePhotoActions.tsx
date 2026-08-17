'use client';

import { useState } from 'react';
import { Camera, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import ProfilePhotoCapture from '@/components/ProfilePhotoCapture';

interface Props {
  onFile: (file: File) => void;
  uploading?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Upload from device + take photo with camera, then hand the file to the cropper. */
export default function ProfilePhotoActions({ onFile, uploading, disabled, className }: Props) {
  const [captureOpen, setCaptureOpen] = useState(false);
  const locked = !!uploading || !!disabled;

  return (
    <>
      <div className={cn('flex flex-wrap items-center gap-2', className)}>
        <label
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-gray-700',
            locked && 'opacity-60 pointer-events-none',
          )}
        >
          <Upload className="w-3.5 h-3.5" />
          {uploading ? 'Uploading…' : 'Upload Photo'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={locked}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onFile(file);
            }}
          />
        </label>

        <button
          type="button"
          disabled={locked}
          onClick={() => setCaptureOpen(true)}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 transition-colors',
            locked && 'opacity-60 pointer-events-none',
          )}
        >
          <Camera className="w-3.5 h-3.5" />
          Take Photo
        </button>
      </div>

      <ProfilePhotoCapture
        open={captureOpen}
        onCancel={() => setCaptureOpen(false)}
        onCapture={(file) => {
          setCaptureOpen(false);
          onFile(file);
        }}
      />
    </>
  );
}
