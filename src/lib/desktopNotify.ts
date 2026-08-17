/**
 * Desktop notifications + alert sound, WhatsApp Web style.
 *
 * Two separate browser constraints shape this:
 *
 *  1. Notification permission can only be requested from a user gesture in most
 *     browsers. Asking on a timer without a gesture often leaves permission at
 *     "default" with no prompt — and we must NOT treat that as "already asked",
 *     or the user can never enable notifications again.
 *
 *  2. Audio cannot play until the page has seen a user interaction. The
 *     AudioContext is therefore created lazily and resumed on the first click or
 *     keypress, so the first notification of a session still makes a sound.
 */

const ASKED_KEY = 'notifications.permissionAsked';
const SOUND_KEY = 'notifications.soundEnabled';

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permissionState(): NotificationPermission | 'unsupported' {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Whether a meaningful permission prompt already completed (granted or denied).
 * If the browser still says "default", the user never answered — allow another ask.
 */
export function hasBeenAsked() {
  if (typeof window === 'undefined') return true;
  if (!notificationsSupported()) return true;
  if (Notification.permission === 'default') return false;
  return localStorage.getItem(ASKED_KEY) === 'true' || Notification.permission !== 'default';
}

export function soundEnabled() {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(SOUND_KEY) !== 'false';
}

export function setSoundEnabled(on: boolean) {
  try { localStorage.setItem(SOUND_KEY, on ? 'true' : 'false'); } catch { /* private mode */ }
}

/**
 * Ask for permission. Prefer calling from a click handler.
 * Only records "asked" when the user actually granted or denied.
 */
export async function requestPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') {
    try { localStorage.setItem(ASKED_KEY, 'true'); } catch { /* private mode */ }
    return Notification.permission;
  }

  try {
    const res = await Notification.requestPermission();
    if (res === 'granted' || res === 'denied') {
      try { localStorage.setItem(ASKED_KEY, 'true'); } catch { /* private mode */ }
    }
    return res;
  } catch {
    return Notification.permission;
  }
}

// ─── Sound ────────────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  return audioCtx;
}

/**
 * Resume the audio context on the first interaction of the session. Browsers
 * start it "suspended" until a gesture, and a suspended context plays silence.
 */
export function primeAudio() {
  if (unlocked || typeof window === 'undefined') return;
  const unlock = () => {
    const ctx = getCtx();
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
    unlocked = true;
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

function chirp(ctx: AudioContext) {
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.18;
  master.connect(ctx.destination);

  // Rising fifth — reads as "notification" rather than "error".
  [[880, 0], [1318.5, 0.09]].forEach(([freq, offset]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(1, now + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.28);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now + offset);
    osc.stop(now + offset + 0.3);
  });
}

/**
 * A short two-note chime, synthesised rather than loaded from a file.
 * Always resumes AudioContext first so a suspended context still chirps.
 */
export function playNotificationSound() {
  if (!soundEnabled()) return;
  const ctx = getCtx();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    ctx.resume().then(() => chirp(ctx)).catch(() => {});
    return;
  }
  chirp(ctx);
}

// ─── Showing a notification ───────────────────────────────────────────────────

export type NotifyPayload = {
  roomId: string;
  roomName: string;
  messageId: string;
  sender: string;
  preview: string;
  isMentioned?: boolean;
  isDm?: boolean;
};

function notificationIconUrl() {
  // Absolute URL + no spaces/parens — some Windows/macOS browsers reject
  // relative or poorly-encoded icon paths and throw when constructing Notification.
  if (typeof window === 'undefined') return '/logo-file.png';
  return new URL('/logo-file.png', window.location.origin).href;
}

/**
 * Show the OS-level popup (Windows bottom-right / macOS Notification Center)
 * and play the chime.
 *
 * `tag` is the room id so a burst of messages in one conversation collapses into
 * a single notification instead of stacking a dozen popups.
 */
export function showMessageNotification(payload: NotifyPayload, onClick?: () => void) {
  playNotificationSound();

  if (!notificationsSupported() || Notification.permission !== 'granted') return;

  const title = payload.isDm
    ? payload.sender
    : `${payload.sender} · ${payload.roomName}`;

  const opts: NotificationOptions = {
    body: payload.preview,
    tag: `room-${payload.roomId}`,
    renotify: true,
    requireInteraction: false,
    silent: true, // we play our own chime; avoid double OS beep
    data: { roomId: payload.roomId, messageId: payload.messageId },
  };

  try {
    const n = new Notification(title, {
      ...opts,
      icon: notificationIconUrl(),
      badge: notificationIconUrl(),
    } as NotificationOptions);

    n.onclick = () => {
      try { window.focus(); } catch { /* ignore */ }
      n.close();
      onClick?.();
    };
  } catch {
    // Retry without icon — icon URL failures must not kill the toast.
    try {
      const n = new Notification(title, opts);
      n.onclick = () => {
        try { window.focus(); } catch { /* ignore */ }
        n.close();
        onClick?.();
      };
    } catch {
      // Sound already played.
    }
  }
}
