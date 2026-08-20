'use client';

import { useEffect, useRef, useState } from 'react';
import type { LeadFormTheme } from '@/lib/leadFormTheme';
import { RADIUS_PX } from '@/lib/leadFormTheme';
import { PHONE_COUNTRIES, digitRange } from '@/lib/phoneCountries';

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
 *  into a div ref. Kept self-contained here (rather than a global <script> in
 *  the root layout) since only the two public embed pages need it. */
function TurnstileWidget({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
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

export type FieldType = 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox';
export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  hidden?: boolean;
}

// Loose enough to not fight real-world formatting (extensions, spaces,
// dashes), strict enough to reject obvious junk like "abc" or a single digit.
// Mirrors crm-be's LeadService PHONE_RE — keep the two in sync.
const PHONE_PATTERN = '\\+?[\\d\\s().-]{7,20}';

interface LeadFormRendererProps {
  mode: 'live' | 'preview';
  theme: LeadFormTheme;
  branding: { brandName: string; logoUrl: string | null };
  fields: FormField[];
  answers?: Record<string, string>;
  onAnswerChange?: (key: string, value: string) => void;
  onSubmit?: (e: React.FormEvent) => void;
  submitting?: boolean;
  submitError?: string;
  successMessage?: string | null;
  honeypotValue?: string;
  onHoneypotChange?: (v: string) => void;
  /** Cloudflare Turnstile site key — omit to hide the widget (used by the
   *  builder preview, which has no live submit to protect). */
  turnstileSiteKey?: string;
  onTurnstileToken?: (token: string) => void;
  /** Bump this after a failed submit to force the widget to remount and
   *  issue a fresh token — a spent/expired token can't be reused. */
  turnstileResetKey?: number;
  /** Renders phone fields as a country-code select + digit-limited number input
   *  instead of one free-text box, storing "+<dial> <digits>" as the answer.
   *  Off by default — only the client-requirements forms opt in (see
   *  crm-fe/src/lib/phoneCountries.ts); lead-capture forms keep the plain input. */
  enablePhoneCountryCode?: boolean;
}

/** Splits a stored "+<dial> <digits>" value back into a country + digit string
 *  so the field can be re-rendered from an existing answer. Falls back to the
 *  first country in the list when nothing matches. */
function parsePhoneValue(value: string): { iso: string; digits: string } {
  const trimmed = (value || '').trim();
  const fallback = { iso: PHONE_COUNTRIES[0].iso, digits: trimmed.replace(/[^\d]/g, '') };
  if (!trimmed.startsWith('+')) return fallback;
  const digitsOnly = trimmed.replace(/[^\d]/g, '');
  const match = [...PHONE_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)
    .find((c) => digitsOnly.startsWith(c.dial));
  if (!match) return fallback;
  return { iso: match.iso, digits: digitsOnly.slice(match.dial.length) };
}

function PhoneFieldInput({
  value, onChange, disabled, required, inputStyle,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  required?: boolean;
  inputStyle: React.CSSProperties;
}) {
  const initial = parsePhoneValue(value);
  const [iso, setIso] = useState(initial.iso);
  const [digits, setDigits] = useState(initial.digits);
  const country = PHONE_COUNTRIES.find((c) => c.iso === iso) || PHONE_COUNTRIES[0];
  const [minDigits, maxDigits] = digitRange(country);

  function emit(nextIso: string, nextDigits: string) {
    const c = PHONE_COUNTRIES.find((x) => x.iso === nextIso) || PHONE_COUNTRIES[0];
    onChange(nextDigits ? `+${c.dial} ${nextDigits}` : '');
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <select
        value={iso}
        disabled={disabled}
        onChange={(e) => { setIso(e.target.value); emit(e.target.value, digits); }}
        style={{ ...inputStyle, width: 100, flexShrink: 0, paddingLeft: 8, paddingRight: 4 }}
      >
        {PHONE_COUNTRIES.map((c) => <option key={c.iso} value={c.iso}>+{c.dial} {c.iso}</option>)}
      </select>
      <input
        type="tel"
        inputMode="numeric"
        required={required}
        disabled={disabled}
        maxLength={maxDigits}
        placeholder={minDigits === maxDigits ? `${minDigits} digits` : `${minDigits}-${maxDigits} digits`}
        value={digits}
        onChange={(e) => {
          const clean = e.target.value.replace(/[^\d]/g, '').slice(0, maxDigits);
          setDigits(clean);
          emit(iso, clean);
        }}
        style={{ ...inputStyle, flex: 1 }}
      />
    </div>
  );
}

/** Renders a lead form exactly as it appears live — used both for the actual
 *  public embed page and for the builder's "how it'll look" preview (with
 *  `mode="preview"`: inputs go inert and the submit button is a no-op, but
 *  every visual it draws from is identical to the live path). Never let the
 *  two paths diverge — if the live page needs a visual change, make it here. */
export default function LeadFormRenderer({
  mode,
  theme,
  branding,
  fields,
  answers = {},
  onAnswerChange,
  onSubmit,
  submitting,
  submitError,
  successMessage,
  honeypotValue = '',
  onHoneypotChange,
  turnstileSiteKey,
  onTurnstileToken,
  turnstileResetKey,
  enablePhoneCountryCode = false,
}: LeadFormRendererProps) {
  const radius = RADIUS_PX[theme.borderRadius];
  const isPreview = mode === 'preview';

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '9px 12px',
    fontSize: 14,
    border: '1px solid #D1D5DB',
    borderRadius: Math.min(radius, 10),
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    background: '#fff',
    color: '#111827',
  };

  return (
    <div style={{ background: theme.backgroundColor, fontFamily: 'system-ui, -apple-system, sans-serif', padding: isPreview ? 24 : '32px 20px', borderRadius: isPreview ? 12 : 0 }}>
      <div style={{ width: '100%', maxWidth: 480, margin: isPreview ? undefined : '0 auto' }}>
        {(theme.showLogo || theme.showName) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            {theme.showLogo && (
              branding.logoUrl ? (
                <img src={branding.logoUrl} alt={branding.brandName} style={{ height: 28, width: 'auto', objectFit: 'contain' }} />
              ) : (
                <div style={{ width: 32, height: 32, borderRadius: Math.min(radius, 10), background: theme.primaryColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>
                  {(branding.brandName || '?').charAt(0)}
                </div>
              )
            )}
            {theme.showName && <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{branding.brandName}</span>}
          </div>
        )}

        {theme.showHeadline && (
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 6px' }}>{theme.headline}</h1>
        )}
        {theme.description && (
          <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 18px', lineHeight: 1.5 }}>{theme.description}</p>
        )}
        {!theme.description && <div style={{ marginBottom: 14 }} />}

        {successMessage ? (
          <div style={{ padding: '20px 0', color: '#111827', fontSize: 14, lineHeight: 1.6 }}>{successMessage}</div>
        ) : (
          <form onSubmit={isPreview ? (e) => e.preventDefault() : onSubmit}>
            {!isPreview && (
              <div style={{ position: 'absolute', left: '-9999px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }} aria-hidden="true">
                <label htmlFor="_hp">Leave this field blank</label>
                <input id="_hp" name="_hp" type="text" tabIndex={-1} autoComplete="off" value={honeypotValue} onChange={(e) => onHoneypotChange?.(e.target.value)} />
              </div>
            )}

            {fields.length === 0 && isPreview && (
              <p style={{ fontSize: 13, color: '#9CA3AF', textAlign: 'center', padding: '20px 0' }}>Add fields to see them here.</p>
            )}

            {fields.map((field) => (
              <div key={field.key} style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                  {field.label}{field.required && <span style={{ color: '#DC2626' }}> *</span>}
                </label>
                {field.type === 'textarea' ? (
                  <textarea
                    required={field.required}
                    disabled={isPreview}
                    rows={3}
                    value={answers[field.key] || ''}
                    onChange={(e) => onAnswerChange?.(field.key, e.target.value)}
                    style={inputStyle}
                  />
                ) : field.type === 'select' ? (
                  <select
                    required={field.required}
                    disabled={isPreview}
                    value={answers[field.key] || ''}
                    onChange={(e) => onAnswerChange?.(field.key, e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">Select…</option>
                    {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : field.type === 'checkbox' ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151' }}>
                    <input
                      type="checkbox"
                      required={field.required}
                      disabled={isPreview}
                      checked={answers[field.key] === 'yes'}
                      onChange={(e) => onAnswerChange?.(field.key, e.target.checked ? 'yes' : '')}
                    />
                    Yes
                  </label>
                ) : field.type === 'phone' && enablePhoneCountryCode ? (
                  <PhoneFieldInput
                    value={answers[field.key] || ''}
                    onChange={(v) => onAnswerChange?.(field.key, v)}
                    disabled={isPreview}
                    required={field.required}
                    inputStyle={inputStyle}
                  />
                ) : (
                  <input
                    type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
                    required={field.required}
                    disabled={isPreview}
                    pattern={field.type === 'phone' ? PHONE_PATTERN : undefined}
                    title={field.type === 'phone' ? 'Enter a valid phone number (7-20 digits, may start with +).' : undefined}
                    value={answers[field.key] || ''}
                    onChange={(e) => onAnswerChange?.(field.key, e.target.value)}
                    style={inputStyle}
                  />
                )}
              </div>
            ))}

            {turnstileSiteKey && !isPreview && (
              <div style={{ marginBottom: 16 }}>
                <TurnstileWidget key={turnstileResetKey} siteKey={turnstileSiteKey} onToken={(token) => onTurnstileToken?.(token)} />
              </div>
            )}

            {submitError && <p style={{ color: '#DC2626', fontSize: 13, marginBottom: 12 }}>{submitError}</p>}

            <button
              type="submit"
              disabled={isPreview || submitting}
              style={{
                width: '100%', padding: '11px 16px', borderRadius: Math.min(radius, 10), border: 'none',
                background: theme.primaryColor, color: '#fff', fontSize: 14, fontWeight: 600,
                cursor: isPreview || submitting ? 'default' : 'pointer', opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? 'Submitting…' : theme.buttonText}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
