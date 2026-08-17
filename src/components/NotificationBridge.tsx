'use client';

/**
 * Keeps a socket connection alive for the whole logged-in session so message
 * notifications arrive anywhere in the app, not just on the Messages screen.
 *
 * Mounted once per layout (CRM dashboard and client portal). It:
 *   • asks for notification permission on a real user gesture (not a timer —
 *     timed prompts are blocked on Windows/macOS browsers and used to lock
 *     the user out of ever enabling notifications)
 *   • listens on the user's personal socket channel for `notify:message`
 *   • plays a chime and raises the OS popup, unless that conversation is
 *     already on screen and the window is focused
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff } from 'lucide-react';
import { toast } from 'sonner';
import { getMessagesSocket } from '@/lib/messagesSocket';
import {
  requestPermission, primeAudio, showMessageNotification, permissionState,
  type NotifyPayload,
} from '@/lib/desktopNotify';

export default function NotificationBridge({
  token,
  portalMode = false,
}: {
  token?: string | null;
  portalMode?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const authToken = token
    || (typeof window !== 'undefined' ? localStorage.getItem('access_token') : null);

  useEffect(() => {
    if (!authToken) return undefined;
    primeAudio();

    const askOnGesture = () => {
      if (permissionState() !== 'default') return;
      void requestPermission();
    };

    window.addEventListener('pointerdown', askOnGesture, { once: true });
    window.addEventListener('keydown', askOnGesture, { once: true });

    return () => {
      window.removeEventListener('pointerdown', askOnGesture);
      window.removeEventListener('keydown', askOnGesture);
    };
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return undefined;
    const sock = getMessagesSocket(authToken);

    const onNotify = (payload: NotifyPayload) => {
      const currentPath = pathRef.current || '';
      const viewingThisRoom = currentPath.includes(payload.roomId)
        || (typeof window !== 'undefined'
          && new URLSearchParams(window.location.search).get('room') === payload.roomId);
      // Only suppress when this chat is literally in front of them.
      const focused = typeof document !== 'undefined'
        && document.visibilityState === 'visible'
        && document.hasFocus();
      if (viewingThisRoom && focused) return;

      qc.invalidateQueries({ queryKey: ['message-rooms'] });

      showMessageNotification(payload, () => {
        router.push(portalMode
          ? `/portal/messages?room=${payload.roomId}&m=${payload.messageId}`
          : `/messages/${payload.roomId}?m=${payload.messageId}`);
      });
    };

    sock.on('notify:message', onNotify);
    if (!sock.connected) sock.connect();

    return () => {
      sock.off('notify:message', onNotify);
    };
  }, [authToken, portalMode, qc, router]);

  return null;
}

/**
 * Banner + button so users can explicitly enable Windows / macOS desktop
 * notifications when the browser hasn't granted permission yet.
 */
export function DesktopNotifyPrompt({ className }: { className?: string }) {
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('default');

  useEffect(() => {
    setPerm(permissionState());
    const onVis = () => setPerm(permissionState());
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  if (perm === 'unsupported' || perm === 'granted') return null;

  async function enable() {
    primeAudio();
    const res = await requestPermission();
    setPerm(res);
    if (res === 'granted') {
      toast.success('Desktop notifications enabled. You’ll get a sound + popup for new messages.');
      // Confirm it works on this machine.
      try {
        showMessageNotification({
          roomId: 'test',
          roomName: 'Messages',
          messageId: 'test',
          sender: 'Mohsin Designs',
          preview: 'Notifications are working on this device.',
          isDm: true,
        });
      } catch { /* ignore */ }
    } else if (res === 'denied') {
      toast.error('Notifications are blocked. Allow them in your browser site settings, then reload.');
    }
  }

  if (perm === 'denied') {
    return (
      <div className={className}>
        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-900">
          <BellOff className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">Desktop notifications are blocked</p>
            <p className="text-[11px] text-amber-800/80 mt-0.5 leading-relaxed">
              In your browser address bar, open site settings and allow Notifications — then reload.
              You’ll get a Windows / Mac popup and a sound when someone messages you.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => void enable()}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-brand-200 bg-brand-50 text-left hover:bg-brand-100/80 transition-colors"
      >
        <Bell className="w-4 h-4 text-brand-700 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-brand-900">Enable desktop notifications</span>
          <span className="block text-[11px] text-brand-800/70 mt-0.5">
            Sound + Windows / Mac popup when you get a new message (works while you’re on another page).
          </span>
        </span>
      </button>
    </div>
  );
}
