'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import api from '@/lib/api';
import axios from 'axios';
import { setFavicon } from '@/lib/utils';
import TurnstileWidget from '@/components/TurnstileWidget';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const ORG_SUBDOMAIN = process.env.NEXT_PUBLIC_ORG_SUBDOMAIN || '';

interface BrandInfo {
  orgId: string | null;
  brandName: string;
  primaryColor: string;
  logoUrl: string | null;
}

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [brand, setBrand] = useState<BrandInfo>({
    orgId: null,
    brandName: 'Mohsin Designs Project Management',
    primaryColor: '#0B1D5E',
    logoUrl: '/logo-file.png',
  });

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  useEffect(() => {
    if (!ORG_SUBDOMAIN) return;
    axios
      .get(`${API_URL.replace('/api', '')}/api/brand?subdomain=${ORG_SUBDOMAIN}`)
      .then((r) => {
        // A real WhiteLabelConfig.logoUrl still wins once an org uploads one —
        // this only fills in for orgs that haven't (the API legitimately
        // returns logoUrl: null for those), so the static /logo-file.png shows
        // instead of the letter-in-a-circle fallback.
        setBrand({ ...r.data, logoUrl: r.data.logoUrl || '/logo-file.png' });
        document.title = `${r.data.brandName} — Agency Operations Platform`;
        setFavicon(r.data.logoUrl || '/logo-file.png');
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Email and password are required.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password, turnstileToken });
      setAuth(res.data.user, res.data.branding, res.data.tokens);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Login failed. Please try again.');
      // The Turnstile token is single-use and short-lived — remount the
      // widget so retrying gets a fresh one.
      setTurnstileToken('');
      setTurnstileResetKey((k) => k + 1);
    } finally {
      setLoading(false);
    }
  };

  const accentColor = brand.primaryColor || '#0B1D5E';

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel: brand ── */}
      <div
        className="hidden lg:flex lg:w-105 xl:w-120 shrink-0 flex-col justify-between px-12 py-14"
        style={{ background: '#0F172A' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3">
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt={brand.brandName} className="h-8 w-auto" />
          ) : (
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: accentColor }}
            >
              <span className="text-white font-bold text-base">{brand.brandName.charAt(0)}</span>
            </div>
          )}
          <span className="text-white font-semibold text-lg tracking-tight">{brand.brandName}</span>
        </div>

        {/* Centre copy */}
        <div>
          <p
            className="text-xs font-semibold tracking-widest uppercase mb-5"
            style={{ color: accentColor }}
          >
            Agency Operations
          </p>
          <h2 className="text-3xl xl:text-4xl font-semibold text-white leading-snug">
            Your workspace,<br />all in one place.
          </h2>
          <p className="mt-4 text-sm text-white/40 leading-relaxed max-w-xs">
            Projects, clients, invoices, and your team — managed together so nothing slips through.
          </p>
        </div>

        {/* Footer */}
        <p className="text-xs text-white/20">
          © {new Date().getFullYear()} {brand.brandName}. All rights reserved.
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
          <div className="flex lg:hidden items-center gap-2.5 mb-8">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt={brand.brandName} className="h-7 w-auto" />
            ) : (
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: accentColor }}
              >
                <span className="text-white font-bold text-sm">{brand.brandName.charAt(0)}</span>
              </div>
            )}
            <span className="text-gray-900 font-semibold">{brand.brandName}</span>
          </div>

          {/* Form card */}
          <div className="bg-white rounded-2xl border border-gray-200/80 shadow-lg shadow-gray-200/60 px-8 py-9">
            <h1 className="text-xl font-semibold text-gray-900 tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm text-gray-400">Sign in to your workspace to continue.</p>

            <form onSubmit={handleSubmit} className="mt-7 space-y-5">
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
                  className="w-full px-4 py-2.5 text-sm text-gray-900 placeholder-gray-300 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none transition"
                  onFocus={(e) => { e.currentTarget.style.backgroundColor = '#fff'; e.currentTarget.style.borderColor = accentColor; e.currentTarget.style.boxShadow = `0 0 0 3px ${accentColor}1A`; }}
                  onBlur={(e) => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.borderColor = ''; e.currentTarget.style.boxShadow = ''; }}
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-2">
                  Password
                </label>
                <div className="relative">
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="w-full px-4 py-2.5 pr-11 text-sm text-gray-900 placeholder-gray-300 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none transition"
                    onFocus={(e) => { e.currentTarget.style.backgroundColor = '#fff'; e.currentTarget.style.borderColor = accentColor; e.currentTarget.style.boxShadow = `0 0 0 3px ${accentColor}1A`; }}
                    onBlur={(e) => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.borderColor = ''; e.currentTarget.style.boxShadow = ''; }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-500 transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {TURNSTILE_SITE_KEY && (
                <TurnstileWidget key={turnstileResetKey} siteKey={TURNSTILE_SITE_KEY} onToken={setTurnstileToken} />
              )}

              {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || (!!TURNSTILE_SITE_KEY && !turnstileToken)}
                className="w-full flex items-center justify-center gap-2 text-white font-semibold text-sm py-3 rounded-xl transition-all disabled:opacity-60 hover:opacity-90 active:scale-[0.99]"
                style={{ backgroundColor: accentColor }}
              >
                {loading ? 'Signing in…' : (
                  <>
                    Sign in
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}
