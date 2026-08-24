'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import LeadFormRenderer, { type FormField, type FormAnswer } from '@/components/leads/LeadFormRenderer';
import type { LeadFormTheme } from '@/lib/leadFormTheme';

interface FormSchema {
  id: string;
  name: string;
  fields: FormField[];
  branding: { brandName: string; logoUrl: string | null };
  theme: LeadFormTheme;
}

const apiBase = '/api';

// Purely public, unauthenticated page — no dashboard chrome, meant to be
// iframed on a third-party site (or linked to directly, e.g. as an ad
// destination URL). Uses a bare fetch against the /api rewrite, same pattern
// as app/review/[token] and app/invoice/[token] — no axios client, no auth.
// Rendering itself is delegated to LeadFormRenderer so this page can never
// visually drift from the builder's "preview" of the same form.
export default function EmbedLeadFormPage() {
  const { token } = useParams<{ token: string }>();
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [loadError, setLoadError] = useState('');
  const [answers, setAnswers] = useState<Record<string, FormAnswer>>({});
  const [honeypot, setHoneypot] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState<{ message: string; redirectUrl: string | null } | null>(null);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  useEffect(() => {
    if (!token) return;
    fetch(`${apiBase}/public/lead-forms/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || 'This form is no longer available.');
        return res.json();
      })
      .then((data: FormSchema) => setSchema(data))
      .catch((e) => setLoadError(e.message || 'This form is no longer available.'));
  }, [token]);

  useEffect(() => {
    if (result?.redirectUrl) {
      const t = setTimeout(() => { window.location.href = result.redirectUrl!; }, 1200);
      return () => clearTimeout(t);
    }
  }, [result]);

  async function uploadFile(file: File): Promise<{ url: string; name: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${apiBase}/public/lead-forms/${token}/upload`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || data?.message || 'Upload failed.');
    return { url: data.url, name: data.name };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!schema) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetch(`${apiBase}/public/lead-forms/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers,
          _hp: honeypot,
          turnstileToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Something went wrong — please try again.');
      setResult({ message: data.message, redirectUrl: data.redirectUrl || null });
    } catch (err: any) {
      setSubmitError(err.message || 'Something went wrong — please try again.');
      // The Turnstile token is single-use and short-lived — clear it so a
      // retry doesn't resubmit an already-spent/expired token; the widget
      // itself reruns its challenge on the next render.
      setTurnstileToken('');
      setTurnstileResetKey((k) => k + 1);
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

  return (
    <div style={{ minHeight: '100vh' }}>
      <LeadFormRenderer
        mode="live"
        theme={schema.theme}
        branding={schema.branding}
        fields={schema.fields}
        answers={answers}
        onAnswerChange={(key, value) => setAnswers((a) => ({ ...a, [key]: value }))}
        onFileUpload={uploadFile}
        onSubmit={handleSubmit}
        submitting={submitting}
        submitError={submitError}
        successMessage={result?.message || null}
        honeypotValue={honeypot}
        onHoneypotChange={setHoneypot}
        turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
        onTurnstileToken={setTurnstileToken}
        turnstileResetKey={turnstileResetKey}
      />
    </div>
  );
}
