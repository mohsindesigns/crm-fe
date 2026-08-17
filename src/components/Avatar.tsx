'use client';

import { useEffect, useState } from 'react';
import { getInitials, avatarColorClasses, cn } from '@/lib/utils';

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'w-7 h-7 text-xs',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-lg',
  xl: 'w-16 h-16 text-xl',
};

// The single source of truth for "show the user's photo if they have one, else
// colored initials" — every avatar in the app should render through this component
// so a newly-uploaded profile picture shows up everywhere at once, with nothing
// left to patch page-by-page.
export default function Avatar({ src, name, size = 'sm', className }: AvatarProps) {
  const sizeClass = SIZE_CLASSES[size];
  // A stored avatar URL is not a guarantee the image loads — the media server
  // may be down, or the file removed. Without this the <img> failed silently and
  // left a blank circle where initials should be, which reads as a broken or
  // nameless user. Reset on `src` change so a fixed/replaced image is retried.
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name || 'Avatar'}
        onError={() => setFailed(true)}
        className={cn(sizeClass, 'rounded-full object-cover border border-gray-200 shrink-0', className)}
      />
    );
  }
  return (
    <div
      title={name || undefined}
      className={cn(sizeClass, 'rounded-full flex items-center justify-center font-semibold shrink-0', avatarColorClasses(name), className)}
    >
      {name ? getInitials(name) : '?'}
    </div>
  );
}
