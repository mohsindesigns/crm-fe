'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Eye, EyeOff, ArrowRight, ShieldCheck,
  PenTool, TrendingUp, MapPin, Smartphone, Search, Code, Share2, Layers,
  Sparkles, Megaphone, Palette, Camera, Video, Globe, ShoppingCart,
  BarChart3, FileText, Users, Zap, Monitor, Briefcase, Mail,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import api from '@/lib/api';
import axios from 'axios';
import { setFavicon } from '@/lib/utils';
import TurnstileWidget from '@/components/TurnstileWidget';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const ORG_SUBDOMAIN = process.env.NEXT_PUBLIC_ORG_SUBDOMAIN || '';

interface Service { key: string; name: string; icon: string | null }

interface BrandInfo {
  orgId: string | null;
  brandName: string;
  primaryColor: string;
  logoUrl: string | null;
  services: Service[];
}

/**
 * ServiceType.icon is stored kebab-case (crm-be seeds `pen-tool`, `map-pin`,
 * `trending-up`, …). Mapped explicitly rather than looked up dynamically off
 * the lucide namespace so the bundle only carries the icons actually used, and
 * so an icon name nobody anticipated degrades to FALLBACK_ICON instead of
 * rendering `undefined` as a component and blanking the page.
 */
const ICONS: Record<string, LucideIcon> = {
  'pen-tool': PenTool,
  'trending-up': TrendingUp,
  'map-pin': MapPin,
  smartphone: Smartphone,
  search: Search,
  code: Code,
  share: Share2,
  'share-2': Share2,
  layers: Layers,
  // Room to grow — an org adding a service type in Admin can pick any of these.
  megaphone: Megaphone,
  palette: Palette,
  camera: Camera,
  video: Video,
  globe: Globe,
  'shopping-cart': ShoppingCart,
  'bar-chart': BarChart3,
  'bar-chart-3': BarChart3,
  'file-text': FileText,
  users: Users,
  zap: Zap,
  monitor: Monitor,
  briefcase: Briefcase,
  mail: Mail,
};
const FALLBACK_ICON = Sparkles;

/**
 * The login hero's blue — the single value everything on the dark panel is
 * derived from: the gradient, both glows, and the accent on the icons, the
 * rule and the "under one roof." line. Changing the brand's blue is a one-line
 * edit here; nothing else needs touching.
 *
 * Deliberately NOT read from WhiteLabelConfig.primaryColor. That field also
 * paints the sign-in button on the LIGHT right-hand panel, where a dark colour
 * is the right answer, and an org that sets it to a near-grey turns this whole
 * panel grey — which is exactly what happened on the deployed instance.
 */
const HERO_BLUE = '#1B3E9E';

/**
 * #rrggbb -> HSL. Returns null for anything unparseable so callers fall back
 * to a fixed palette rather than emitting `hsl(NaN ...)`, which paints nothing
 * and would leave the hero panel transparent.
 */
function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = (h * 60 + 360) % 360;
  const l = (max + min) / 2;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s: sat * 100, l: l * 100 };
}

/**
 * Expands one blue into the hero panel's full palette.
 *
 * The panel and the accent share a hue but have their LIGHTNESS pinned to fixed
 * stops rather than inherited from the input — that is what guarantees contrast
 * survives a colour change. Feed it any blue and you still get a panel dark
 * enough for white body text and an accent light enough to read against it.
 *
 * The stops sit high enough (36% for the mid) that the panel reads as an actual
 * blue rather than a near-black with a hint of blue in it.
 */
function heroPalette(brandColor: string) {
  const hsl = hexToHsl(brandColor) || { h: 224, s: 71, l: 36 };
  // A greyscale brand colour must stay greyscale — clamping its saturation up
  // would invent a hue it doesn't have (pure grey reads as h=0, i.e. red).
  const greyish = hsl.s < 10;
  // Rounded so the emitted CSS reads `hsl(227 79% 21%)` rather than carrying
  // ~15 digits of float noise into every style attribute on the page.
  const h = Math.round(hsl.h);
  const panelSat = Math.round(greyish ? hsl.s : Math.min(Math.max(hsl.s, 45), 85));
  // The accent is BOOSTED past the input's saturation, not merely clamped into
  // a range: a pale tint of an already-muted blue reads as washed-out grey.
  const accentSat = Math.round(greyish ? Math.max(hsl.s, 4) : Math.min(Math.max(hsl.s * 1.4, 70), 100));
  return {
    top: `hsl(${h} ${panelSat}% 28%)`,
    mid: `hsl(${h} ${panelSat}% 36%)`,
    bottom: `hsl(${h} ${panelSat}% 16%)`,
    // Pale sky blue. Has to be this light: an accent only a little brighter
    // than a mid-blue panel is the exact mistake that made the first version
    // unreadable.
    accent: `hsl(${h} ${accentSat}% 79%)`,
  };
}

/**
 * Shown until /api/brand answers, and for any org that hasn't set up service
 * types yet. Mirrors the seeded set, so the hero is never an empty column —
 * a login screen that renders a blank panel for 300ms looks broken.
 */
const FALLBACK_SERVICES: Service[] = [
  { key: 'web', name: 'Web Development', icon: 'code' },
  { key: 'seo', name: 'SEO', icon: 'search' },
  { key: 'logo', name: 'Logo Design', icon: 'pen-tool' },
  { key: 'app', name: 'App Development', icon: 'smartphone' },
  { key: 'gads', name: 'Google Ads', icon: 'trending-up' },
  { key: 'gmb', name: 'GMB Optimization', icon: 'map-pin' },
  { key: 'social', name: 'Social Media', icon: 'share' },
  { key: 'branding', name: 'Branding', icon: 'layers' },
];

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [brand, setBrand] = useState<BrandInfo>({
    orgId: null,
    brandName: 'Mohsin Designs Project Management',
    primaryColor: '#0B1D5E',
    logoUrl: '/logo-file.png',
    services: FALLBACK_SERVICES,
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
        // instead of the letter-in-a-circle fallback. Same idea for services:
        // an org with none configured keeps the placeholder set rather than
        // rendering an empty hero.
        setBrand({
          ...r.data,
          logoUrl: r.data.logoUrl || '/logo-file.png',
          services: r.data.services?.length ? r.data.services : FALLBACK_SERVICES,
        });
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
  const services = brand.services || [];
  // `accentColor` (the org's primaryColor) stays the button/focus-ring colour on
  // the LIGHT right-hand panel, where a dark colour is what's wanted. The dark
  // left panel is driven entirely by HERO_BLUE instead — see its comment.
  const hero = heroPalette(HERO_BLUE);

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">

      {/* ══ Left: the shopfront ══
          Dark, full-bleed, and the only place the brand gets to speak. The
          services list is the org's real ServiceType rows (GET /api/brand), so
          this stays accurate as they add or retire service lines — it is not a
          hardcoded marketing list that quietly goes stale. */}
      <div
        className="relative hidden lg:flex lg:w-[52%] xl:w-[55%] shrink-0 flex-col justify-between px-12 xl:px-16 py-12 overflow-hidden"
        style={{
          backgroundColor: hero.mid,
          backgroundImage: `linear-gradient(160deg, ${hero.top} 0%, ${hero.mid} 45%, ${hero.bottom} 100%)`,
        }}
      >
        {/* Two soft glows in the BRIGHT accent, not the brand colour itself —
            a wash the same darkness as the panel behind it is invisible, which
            is what made the old version look flat. */}
        <div
          className="pointer-events-none absolute -top-40 -left-32 w-[34rem] h-[34rem] rounded-full opacity-[0.22] blur-3xl"
          style={{ background: `radial-gradient(circle, ${hero.accent} 0%, transparent 70%)` }}
        />
        <div
          className="pointer-events-none absolute -bottom-48 -right-24 w-[30rem] h-[30rem] rounded-full opacity-[0.14] blur-3xl"
          style={{ background: `radial-gradient(circle, ${hero.accent} 0%, transparent 70%)` }}
        />
        {/* Hairline grid — stops the large dark area reading flat. */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.07) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
          }}
        />

        {/* Brand lockup. The wordmark is IN the logo artwork, so repeating the
            brand name beside it just said the same thing twice — the text now
            only appears when there is no logo to show. */}
        <div className="relative flex items-center gap-3">
          {brand.logoUrl ? (
            // White plate behind the logo. The mark is blue and so is this
            // panel; without the plate a blue-on-transparent logo sinks into
            // the background. The plate also means artwork of ANY colour stays
            // legible, which matters because the logo is swapped from Admin
            // without anyone revisiting this file.
            <span className="inline-flex items-center rounded-xl bg-white px-4 py-2.5 shadow-lg shadow-black/25">
              <img src={brand.logoUrl} alt={brand.brandName} className="h-7 w-auto" />
            </span>
          ) : (
            <>
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: hero.accent }}
              >
                <span className="font-bold text-base" style={{ color: hero.bottom }}>
                  {brand.brandName.charAt(0)}
                </span>
              </div>
              <span className="text-white font-semibold text-lg tracking-tight">{brand.brandName}</span>
            </>
          )}
        </div>

        <div className="relative py-8">
          <div className="flex items-center gap-2.5 mb-6">
            <span className="h-px w-8" style={{ backgroundColor: hero.accent }} />
            <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-white/70">
              Agency Operations Platform
            </p>
          </div>

          <h2 className="text-4xl xl:text-[2.75rem] font-semibold text-white leading-[1.15] tracking-tight">
            Design, build,<br />and grow —<br />
            <span style={{ color: hero.accent }}>under one roof.</span>
          </h2>
          <p className="mt-5 text-[15px] text-white/70 leading-relaxed max-w-md">
            Projects, clients, invoices and your team — managed together, so nothing slips
            through the cracks.
          </p>

          {/* The services themselves */}
          <div className="mt-10">
            <p className="text-[10px] font-semibold tracking-[0.18em] uppercase text-white/55 mb-4">
              What we do
            </p>
            <ul className="grid grid-cols-1 xl:grid-cols-2 gap-x-8 gap-y-1 max-w-xl">
              {services.map((s) => {
                const Icon = (s.icon && ICONS[s.icon]) || FALLBACK_ICON;
                return (
                  <li
                    key={s.key}
                    className="group flex items-center gap-3 py-2.5 border-b border-white/[0.12]"
                  >
                    <span
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-white/[0.16] bg-white/[0.07] transition-colors group-hover:bg-white/[0.13]"
                    >
                      <Icon className="w-4 h-4" style={{ color: hero.accent }} />
                    </span>
                    <span className="text-[13.5px] text-white/[0.92] font-medium truncate">{s.name}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <p className="relative text-xs text-white/45">
          © {new Date().getFullYear()} {brand.brandName}. All rights reserved.
        </p>
      </div>

      {/* ══ Right: sign in ══ */}
      <div
        className="flex-1 flex items-center justify-center px-6 py-12"
        style={{
          backgroundColor: '#F8FAFC',
          backgroundImage: 'radial-gradient(circle, #CBD5E1 1px, transparent 1px)',
          backgroundSize: '26px 26px',
        }}
      >
        <div className="w-full max-w-sm">

          {/* Mobile-only brand header — the hero panel is hidden below lg. No
              white plate needed here: this side is already light. */}
          <div className="flex lg:hidden items-center gap-2.5 mb-6">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt={brand.brandName} className="h-8 w-auto" />
            ) : (
              <>
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: accentColor }}
                >
                  <span className="text-white font-bold text-sm">{brand.brandName.charAt(0)}</span>
                </div>
                <span className="text-gray-900 font-semibold">{brand.brandName}</span>
              </>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xl shadow-slate-200/60 px-8 py-9">
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

            <p className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-gray-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              Secure, encrypted sign-in
            </p>
          </div>

          {/* Services on mobile, where the hero panel isn't rendered — a
              wrapping chip row rather than the full list, so the form stays
              the first thing on screen. */}
          <div className="lg:hidden mt-7">
            <p className="text-[10px] font-semibold tracking-[0.18em] uppercase text-gray-400 mb-2.5 text-center">
              What we do
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {services.map((s) => {
                const Icon = (s.icon && ICONS[s.icon]) || FALLBACK_ICON;
                return (
                  <span
                    key={s.key}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-[11px] font-medium text-gray-600"
                  >
                    <Icon className="w-3 h-3" style={{ color: accentColor }} />
                    {s.name}
                  </span>
                );
              })}
            </div>
          </div>

          <p className="lg:hidden mt-6 text-center text-[11px] text-gray-400">
            © {new Date().getFullYear()} {brand.brandName}
          </p>
        </div>
      </div>
    </div>
  );
}
