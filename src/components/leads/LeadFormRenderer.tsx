'use client';

import type { LeadFormTheme } from '@/lib/leadFormTheme';
import { RADIUS_PX } from '@/lib/leadFormTheme';

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
  /** Anti-bot math challenge, e.g. "3 + 7 = ?" — omit to hide the captcha row (used by the builder preview, which has no live token to solve against). */
  captchaQuestion?: string;
  captchaAnswer?: string;
  onCaptchaAnswerChange?: (v: string) => void;
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
  captchaQuestion,
  captchaAnswer = '',
  onCaptchaAnswerChange,
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

        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 6px' }}>{theme.headline}</h1>
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

            {captchaQuestion && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                  Quick check: {captchaQuestion}<span style={{ color: '#DC2626' }}> *</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  disabled={isPreview}
                  value={captchaAnswer}
                  onChange={(e) => onCaptchaAnswerChange?.(e.target.value)}
                  style={inputStyle}
                />
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
