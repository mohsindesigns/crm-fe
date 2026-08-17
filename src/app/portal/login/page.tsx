'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { usePortalStore } from '@/store/portal';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
const RESEND_COOLDOWN_S = 30;

export default function PortalLoginPage() {
  const router = useRouter();
  const { login, setBranding, branding } = usePortalStore();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const codeRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Fetch branding for login page (no auth required)
  useEffect(() => {
    fetch(`${API_URL}/portal/branding`)
      .then((r) => r.json())
      .then((data) => {
        setBranding(data);
        document.title = `${data?.brandName || 'Mohsin Designs Project Management'} — Client Portal`;
      })
      .catch(() => {});
  }, [setBranding]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const brandName = branding?.brandName || 'Mohsin Designs Project Management';
  const accentColor = branding?.primaryColor || '#0B1D5E';
  const logoUrl = branding?.logoUrl || '/logo-file.png';

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/portal/auth/request-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'No portal access for this email.'); return; }
      setStep('code');
      setCode('');
      setResendCooldown(RESEND_COOLDOWN_S);
      setTimeout(() => codeRefs.current[0]?.focus(), 50);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (code.length < 6 || loading) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/portal/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Invalid code. Please try again.');
        setCode('');
        codeRefs.current[0]?.focus();
        return;
      }
      login(data.token, data.contact, data.client, data.branding || branding || { brandName, primaryColor: accentColor, logoUrl });
      document.title = `${data.branding?.brandName || brandName} — Client Portal`;
      router.push('/portal');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // Auto-submit the moment all 6 digits are in
  useEffect(() => {
    if (step === 'code' && code.length === 6 && !loading) verifyCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  function setDigit(idx: number, raw: string) {
    const digit = raw.replace(/\D/g, '').slice(-1);
    const chars = code.padEnd(6, ' ').split('');
    chars[idx] = digit || ' ';
    const next = chars.join('').replace(/\s+$/, '');
    setCode(next);
    if (digit && idx < 5) codeRefs.current[idx + 1]?.focus();
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !code[idx] && idx > 0) codeRefs.current[idx - 1]?.focus();
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    setCode(pasted);
    codeRefs.current[Math.min(pasted.length, 5)]?.focus();
  }

  const focusRing = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.backgroundColor = '#fff';
    e.currentTarget.style.borderColor = accentColor;
    e.currentTarget.style.boxShadow = `0 0 0 3px ${accentColor}1A`;
  };
  const blurRing = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.backgroundColor = '';
    e.currentTarget.style.borderColor = '';
    e.currentTarget.style.boxShadow = '';
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel: brand ── */}
      <div className="hidden lg:flex lg:w-105 xl:w-120 shrink-0 flex-col justify-between px-12 py-14" style={{ background: '#0F172A' }}>
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt={brandName} className="h-8 w-auto" />
          ) : (
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: accentColor }}>
              <span className="text-white font-bold text-base">{brandName.charAt(0)}</span>
            </div>
          )}
          <span className="text-white font-semibold text-lg tracking-tight">{brandName}</span>
        </div>

        <div>
          <p className="text-xs font-semibold tracking-widest uppercase mb-5" style={{ color: accentColor }}>
            Client Portal
          </p>
          <h2 className="text-3xl xl:text-4xl font-semibold text-white leading-snug">
            Your projects,<br />always in view.
          </h2>
          <p className="mt-4 text-sm text-white/40 leading-relaxed max-w-xs">
            Track progress, review deliverables, and stay on top of billing — securely, from one place.
          </p>
        </div>

        <p className="text-xs text-white/20">
          © {new Date().getFullYear()} {brandName}. All rights reserved.
        </p>
      </div>

      {/* ── Right panel: form ── */}
      <div
        className="flex-1 flex items-center justify-center px-6 py-12"
        style={{
          backgroundColor: '#F1F5F9',
          backgroundImage: 'radial-gradient(circle, #CBD5E1 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      >
        <div className="w-full max-w-sm">

          {/* Mobile-only logo */}
          <div className="flex lg:hidden items-center gap-2.5 mb-8 justify-center">
            {logoUrl ? (
              <img src={logoUrl} alt={brandName} className="h-7 w-auto" />
            ) : (
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: accentColor }}>
                <span className="text-white font-bold text-sm">{brandName.charAt(0)}</span>
              </div>
            )}
            <span className="text-gray-900 font-semibold">{brandName}</span>
          </div>

          {/* Form card */}
          <div className="bg-white rounded-2xl border border-gray-200/80 shadow-lg shadow-gray-200/60 px-8 py-9">

            {step === 'email' ? (
              <>
                <h1 className="text-xl font-semibold text-gray-900 tracking-tight">Client Portal</h1>
                <p className="mt-1 text-sm text-gray-400">Enter your email to receive a verification code.</p>

                <form onSubmit={requestCode} className="mt-7 space-y-5">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-2">
                      Email address
                    </label>
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      placeholder="you@company.com"
                      autoComplete="email"
                      autoFocus
                      required
                      className="w-full px-4 py-2.5 text-sm text-gray-900 placeholder-gray-300 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none transition"
                      onFocus={focusRing}
                      onBlur={blurRing}
                    />
                  </div>

                  {error && (
                    <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={!email || loading}
                    className="w-full flex items-center justify-center gap-2 text-white font-semibold text-sm py-3 rounded-xl transition-all disabled:opacity-60 hover:opacity-90 active:scale-[0.99]"
                    style={{ backgroundColor: accentColor }}
                  >
                    {loading ? 'Sending code…' : (
                      <>
                        Send verification code
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              </>
            ) : (
              <>
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                  style={{ backgroundColor: `${accentColor}14` }}
                >
                  <ShieldCheck className="w-5 h-5" style={{ color: accentColor }} />
                </div>
                <h1 className="text-xl font-semibold text-gray-900 tracking-tight">Check your email</h1>
                <p className="mt-1 text-sm text-gray-400">
                  We sent a 6-digit code to <span className="text-gray-600 font-medium">{email}</span>
                </p>

                <form onSubmit={verifyCode} className="mt-7 space-y-5">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-2">
                      Verification code
                    </label>
                    <div className="flex gap-2 justify-between" onPaste={handlePaste}>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <input
                          key={i}
                          ref={(el) => { codeRefs.current[i] = el; }}
                          value={code[i] || ''}
                          onChange={(e) => setDigit(i, e.target.value)}
                          onKeyDown={(e) => handleKeyDown(i, e)}
                          type="text"
                          inputMode="numeric"
                          maxLength={1}
                          autoFocus={i === 0}
                          className="w-full h-13 text-center text-lg font-semibold text-gray-900 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none transition"
                          onFocus={focusRing}
                          onBlur={blurRing}
                        />
                      ))}
                    </div>
                  </div>

                  {error && (
                    <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={code.length < 6 || loading}
                    className="w-full flex items-center justify-center gap-2 text-white font-semibold text-sm py-3 rounded-xl transition-all disabled:opacity-60 hover:opacity-90 active:scale-[0.99]"
                    style={{ backgroundColor: accentColor }}
                  >
                    {loading ? 'Verifying…' : (
                      <>
                        Verify & sign in
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>

                  <div className="flex flex-wrap items-center justify-between text-xs pt-1 gap-2">
                    <button
                      type="button"
                      onClick={() => { setStep('email'); setCode(''); setError(''); }}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      ← Change email
                    </button>
                    <button
                      type="button"
                      onClick={() => requestCode()}
                      disabled={loading || resendCooldown > 0}
                      className="font-semibold hover:underline disabled:opacity-50 disabled:hover:no-underline transition-colors"
                      style={{ color: accentColor }}
                    >
                      {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">
            Portal access is granted by {brandName}. Contact your account manager if you need access.
          </p>
        </div>
      </div>
    </div>
  );
}
