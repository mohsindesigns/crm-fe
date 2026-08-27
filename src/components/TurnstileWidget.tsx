'use client';

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string;
        callback: (token: string) => void;
        'expired-callback'?: () => void;
        'error-callback'?: () => void;
      }) => string;
      reset: (widgetId?: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script';

/** Loads Cloudflare's Turnstile script once per page and renders the widget
 *  into a div ref. Used on every public/anonymous submit that needs bot
 *  protection — lead-form embed, client-requirement form, and the staff
 *  login page. Pass a changing `key` prop from the caller to force a remount
 *  (and a fresh token) after a failed submit, since a spent/expired token
 *  can't be reused. */
export default function TurnstileWidget({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    function renderWidget() {
      if (cancelled || !containerRef.current || !window.turnstile || widgetId.current) return;
      widgetId.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: onToken,
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      });
    }

    if (window.turnstile) {
      renderWidget();
    } else if (!document.getElementById(TURNSTILE_SCRIPT_ID)) {
      window.onTurnstileLoad = renderWidget;
      const script = document.createElement('script');
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    } else {
      // Script tag already exists (e.g. a second widget on the same page) —
      // poll briefly for window.turnstile to be ready rather than re-adding it.
      const interval = setInterval(() => {
        if (window.turnstile) { clearInterval(interval); renderWidget(); }
      }, 100);
      return () => clearInterval(interval);
    }

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  return <div ref={containerRef} />;
}
