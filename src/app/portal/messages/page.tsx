'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import MessagesApp from '@/components/messages/MessagesApp';
import { usePortalStore } from '@/store/portal';

function PortalMessagesInner() {
  const searchParams = useSearchParams();
  const roomId = searchParams.get('room') || undefined;
  const token = usePortalStore((s) => s.token);

  return (
    <div className="flex-1 min-h-0 h-full bg-white">
      <MessagesApp
        roomId={roomId}
        portalMode
        apiBase="/portal/messages"
        token={token}
      />
    </div>
  );
}

export default function PortalMessagesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-400 p-6">Loading…</p>}>
      <PortalMessagesInner />
    </Suspense>
  );
}
