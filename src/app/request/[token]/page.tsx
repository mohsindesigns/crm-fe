'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import LeadFormRenderer, { type FormField } from '@/components/leads/LeadFormRenderer';
import type { LeadFormTheme } from '@/lib/leadFormTheme';

interface RequestSchema {
  projectName: string | null;
  recipientName: string | null;
  subject: string;
  message: string | null;
  dueAt: string | null;
  alreadyResponded: boolean;
  respondedAt: string | null;
  fields: FormField[];
  branding: { brandName: string; logoUrl: string | null };
  theme: LeadFormTheme;
}

const apiBase = '/api';

// Public, unauthenticated page — the requirements form a staff member emailed
// to a client from a project (crm-be ClientRequestService). The token in the
// URL is the only credential. Uses a bare fetch against the /api rewrite, no
// axios client and no auth, exactly like app/embed/form/[token],
// app/review/[token] and app/invoice/[token].
//
// Rendering goes through LeadFormRenderer so this page can never drift visually
// from the lead-form embed it shares field types with.
export default function ClientRequestPage() {
  const { token } = useParams<{ token: string }>();
  const [schema, setSchema] = useState<RequestSchema | null>(null);
  const [loadError, setLoadError] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [honeypot, setHoneypot] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<{ question: string; captchaToken: string } | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  function fetchCaptcha() {
    if (!token) return;
    fetch(`${apiBase}/public/client-requests/${token}/captcha`)
      .then((res) => res.json())
      .then((data) => setCaptcha(data))
      .catch(() => {});
  }

  useEffect(() => {
    if (!token) return;
    fetch(`${apiBase}/public/client-requests/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || 'This form is no longer available.');
        return res.json();
      })
      .then((data: RequestSchema) => {
        setSchema(data);
        // Clicking the emailed link a second time shouldn't be a dead end —
        // show the "we've got this" state instead of an empty form they'd
        // only be told they can't submit.
        if (data.alreadyResponded) {
          setSuccessMessage(
            `We've already received your answers${data.respondedAt ? ` on ${new Date(data.respondedAt).toLocaleDateString()}` : ''}. Thanks! If something needs changing, just reply to our email.`,
          );
        }
      })
      .catch((e) => setLoadError(e.message || 'This form is no longer available.'));
    fetchCaptcha();
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!schema) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetch(`${apiBase}/public/client-requests/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers,
          _hp: honeypot,
          captchaToken: captcha?.captchaToken,
          captchaAnswer,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Something went wrong — please try again.');
      setSuccessMessage(data.message);
    } catch (err: any) {
      setSubmitError(err.message || 'Something went wrong — please try again.');
      // The captcha token may now be spent or expired — hand back a fresh
      // challenge so retrying doesn't just repeat the same error.
      setCaptchaAnswer('');
      fetchCaptcha();
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <p style={{ color: '#6B7280', fontSize: 14, textAlign: 'center' }}>{loadError}</p>
      </div>
    );
  }

  if (!schema) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <p style={{ color: '#9CA3AF', fontSize: 14 }}>Loading…</p>
      </div>
    );
  }

  const dueLabel = schema.dueAt && !successMessage
    ? new Date(`${schema.dueAt.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div style={{ minHeight: '100vh', background: schema.theme.backgroundColor }}>
      {dueLabel && (
        <div style={{ background: '#FEF3C7', color: '#92400E', fontSize: 13, textAlign: 'center', padding: '10px 16px', fontFamily: 'system-ui, sans-serif' }}>
          Please complete this by <strong>{dueLabel}</strong>.
        </div>
      )}
      {successMessage ? (
        <ThankYouScreen
          message={successMessage}
          brandName={schema.branding.brandName}
          logoUrl={schema.branding.logoUrl}
          primaryColor={schema.theme.primaryColor}
        />
      ) : (
        <LeadFormRenderer
          mode="live"
          theme={schema.theme}
          branding={schema.branding}
          fields={schema.fields}
          answers={answers}
          onAnswerChange={(key, value) => setAnswers((a) => ({ ...a, [key]: value }))}
          onSubmit={handleSubmit}
          submitting={submitting}
          submitError={submitError}
          honeypotValue={honeypot}
          onHoneypotChange={setHoneypot}
          captchaQuestion={captcha?.question}
          captchaAnswer={captchaAnswer}
          onCaptchaAnswerChange={setCaptchaAnswer}
          enablePhoneCountryCode
        />
      )}
    </div>
  );
}

// Shown once the form is submitted (or was already answered on a repeat
// visit). Counts down and attempts to close the tab — this only works when
// the tab was opened via script (window.open), which most mail-client "open
// link" actions don't do, so browsers commonly ignore the close and the
// countdown just settles on "you can close this tab now" instead.
function ThankYouScreen({
  message, brandName, logoUrl, primaryColor,
}: { message: string; brandName: string; logoUrl: string | null; primaryColor: string }) {
  const [secondsLeft, setSecondsLeft] = useState(5);

  useEffect(() => {
    if (secondsLeft <= 0) {
      window.close();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#F9FAFB' }}>
      <div style={{ maxWidth: 440, width: '100%', textAlign: 'center', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: '44px 32px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {logoUrl ? (
          <img src={logoUrl} alt={brandName} style={{ height: 32, margin: '0 auto 22px', display: 'block', objectFit: 'contain' }} />
        ) : (
          <div style={{ width: 44, height: 44, borderRadius: 12, background: primaryColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 17, margin: '0 auto 22px' }}>
            {(brandName || '?').charAt(0)}
          </div>
        )}
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#ECFDF5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 6L9 17L4 12" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 style={{ fontSize: 19, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>Thank you!</h1>
        <p style={{ fontSize: 14, color: '#4B5563', lineHeight: 1.6, margin: '0 0 24px', whiteSpace: 'pre-wrap' }}>{message}</p>
        <p style={{ fontSize: 12, color: '#9CA3AF' }}>
          {secondsLeft > 0 ? `This tab will close automatically in ${secondsLeft}s…` : 'You can close this tab now.'}
        </p>
      </div>
    </div>
  );
}
