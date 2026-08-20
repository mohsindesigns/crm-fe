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
        successMessage={successMessage}
        honeypotValue={honeypot}
        onHoneypotChange={setHoneypot}
        // Hide the captcha row once we're showing a success/already-answered
        // state — there's no form left to protect.
        captchaQuestion={successMessage ? undefined : captcha?.question}
        captchaAnswer={captchaAnswer}
        onCaptchaAnswerChange={setCaptchaAnswer}
      />
    </div>
  );
}
