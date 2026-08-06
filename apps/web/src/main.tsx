import { StrictMode, useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AddressesPanel,
  FavoritesPanel,
  LoyaltyPanel,
  OrdersPanel,
  PaymentsPanel,
  RestaurantMenuPanel,
  ReviewsPanel,
} from './account';
import { api } from './api';
import './styles.css';

type ApiUser = {
  id?: string;
  fullName: string;
  email: string;
  loyaltyPoints: number;
  role?: 'CUSTOMER' | 'RESTAURANT' | 'RIDER' | 'ADMIN';
  emailVerified?: boolean;
  emailVerifiedAt?: string | null;
};

type CustomerUser = Omit<ApiUser, 'emailVerified'> & { emailVerified: boolean };

type AuthResponse = {
  user: ApiUser;
  accessToken: string;
  refreshToken: string;
};

function readPath() {
  const path = window.location.pathname.replace(/\/+$/, '');
  return path || '/';
}

function toCustomerUser(user: ApiUser): CustomerUser {
  return { ...user, emailVerified: user.emailVerified ?? Boolean(user.emailVerifiedAt) };
}

function App() {
  const [path, setPath] = useState(readPath);
  const [user, setUser] = useState<CustomerUser | null>(null);
  const [loading, setLoading] = useState(true);
  const isPublicRoute = ['/verify-email', '/forgot-password', '/reset-password'].includes(path);

  const navigate = (nextPath: string) => {
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
    setPath(readPath());
  };

  useEffect(() => {
    const handlePopState = () => setPath(readPath());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    let active = true;

    if (isPublicRoute) {
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    api<{ user: ApiUser }>('/me')
      .then((response) => {
        if (active) setUser(toCustomerUser(response.user));
      })
      .catch(() => {
        localStorage.removeItem('accessToken');
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isPublicRoute]);

  if (path === '/verify-email') return <VerifyEmail onContinue={() => navigate('/')} />;
  if (path === '/forgot-password') return <ForgotPassword onBack={() => navigate('/')} />;
  if (path === '/reset-password') return <ResetPassword onContinue={() => navigate('/')} />;

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-cream text-ink">Loading your account…</div>;
  }

  if (!user) {
    return <Auth onLogin={setUser} onForgotPassword={() => navigate('/forgot-password')} />;
  }

  return user.role === 'RESTAURANT' ? (
    <RestaurantDashboard user={user} onSignOut={() => {
      localStorage.removeItem('accessToken');
      setUser(null);
    }} />
  ) : (
    <CustomerDashboard
      user={user}
      onUserRefresh={() => {
        api<{ user: ApiUser }>('/me')
          .then((response) => setUser(toCustomerUser(response.user)))
          .catch(() => undefined);
      }}
      onSignOut={() => {
        localStorage.removeItem('accessToken');
        setUser(null);
      }}
    />
  );
}

function Auth({
  onLogin,
  onForgotPassword,
}: {
  onLogin: (user: CustomerUser) => void;
  onForgotPassword: () => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ email: '', password: '', fullName: '' });
  const [accountRole, setAccountRole] = useState<'CUSTOMER' | 'RESTAURANT'>('CUSTOMER');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const resend = useResendVerification(registeredEmail);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const response = await api<AuthResponse | { message: string }>(`/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ ...form, ...(mode === 'register' ? { role: accountRole } : {}) }),
      });

      if (mode === 'login') {
        const login = response as AuthResponse;
        localStorage.setItem('accessToken', login.accessToken);
        onLogin(toCustomerUser(login.user));
      } else {
        setRegisteredEmail(form.email.trim().toLowerCase());
        setForm((current) => ({ ...current, password: '' }));
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to continue.');
    } finally {
      setSubmitting(false);
    }
  }

  if (registeredEmail) {
    return (
      <AuthLayout>
        <span className="inline-flex rounded-full bg-sage px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand">
          One last step
        </span>
        <h1 className="mt-5 text-3xl font-black text-ink">Verify your email</h1>
        <p className="mt-3 text-slate-600">
          We sent a verification link to <strong className="text-ink">{registeredEmail}</strong>. Open it to
          confirm your customer account.
        </p>
        <ResendStatus resend={resend} />
        <button
          type="button"
          className="mt-7 w-full rounded-xl border border-brand py-3 font-bold text-brand transition hover:bg-sage"
          onClick={() => {
            setRegisteredEmail('');
            setMode('login');
          }}
        >
          Back to sign in
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="mt-8 text-3xl font-black text-ink">
        {mode === 'login' ? 'Welcome back' : 'Create your account'}
      </h1>
      <p className="mb-7 mt-2 text-slate-500">Your favourite meals, one tap away.</p>
      <form onSubmit={submit}>
        {mode === 'register' && (
          <>
            <input
              className="field"
              autoComplete="name"
              placeholder="Full name"
              required
              value={form.fullName}
              onChange={(event) => setForm({ ...form, fullName: event.target.value })}
            />
            <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-cream p-1">
              {(['CUSTOMER', 'RESTAURANT'] as const).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setAccountRole(role)}
                  className={`rounded-lg px-3 py-2 text-sm font-bold transition ${accountRole === role ? 'bg-white text-brand shadow-sm' : 'text-slate-500'}`}
                >
                  {role === 'CUSTOMER' ? 'Customer' : 'Restaurant owner'}
                </button>
              ))}
            </div>
          </>
        )}
        <input
          className="field"
          type="email"
          autoComplete="email"
          placeholder="Email address"
          required
          value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
        />
        <input
          className="field"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          placeholder="Password (8+ characters)"
          minLength={8}
          required
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
        />
        {mode === 'login' && (
          <button
            type="button"
            className="mb-5 -mt-1 text-sm font-semibold text-brand hover:underline"
            onClick={onForgotPassword}
          >
            Forgot password?
          </button>
        )}
        {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button
          className="w-full rounded-xl bg-brand py-3 font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting}
        >
          {submitting ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <button
        type="button"
        className="mt-5 w-full text-sm font-semibold text-brand hover:underline"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setError('');
        }}
      >
        {mode === 'login' ? 'New here? Create an account' : 'Already registered? Sign in'}
      </button>
    </AuthLayout>
  );
}

function useResendVerification(email: string) {
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function resend() {
    if (!email) return;
    setResending(true);
    setNotice('');
    setError('');

    try {
      const response = await api<{ message: string }>('/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setNotice(response.message);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to resend the link.');
    } finally {
      setResending(false);
    }
  }

  return { resending, notice, error, resend };
}

function ResendStatus({ resend }: { resend: ReturnType<typeof useResendVerification> }) {
  return (
    <div className="mt-6 rounded-xl bg-cream p-4">
      <p className="text-sm text-slate-600">Can’t find the email? Check spam, or request a fresh link.</p>
      <button
        type="button"
        className="mt-3 text-sm font-bold text-brand hover:underline disabled:cursor-not-allowed disabled:opacity-60"
        disabled={resend.resending}
        onClick={resend.resend}
      >
        {resend.resending ? 'Sending…' : 'Resend verification email'}
      </button>
      {resend.notice && (
        <p className="mt-2 text-sm text-emerald-700" role="status">
          {resend.notice}
        </p>
      )}
      {resend.error && <p className="mt-2 text-sm text-red-700">{resend.error}</p>}
    </div>
  );
}

function VerifyEmail({ onContinue }: { onContinue: () => void }) {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [status, setStatus] = useState<'checking' | 'success' | 'error'>(token ? 'checking' : 'error');
  const [message, setMessage] = useState(
    token ? 'Checking your verification link…' : 'This verification link is incomplete or invalid.',
  );

  useEffect(() => {
    let active = true;
    if (!token) return () => {
      active = false;
    };

    setStatus('checking');
    api<{ message: string }>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then((response) => {
        if (!active) return;
        setStatus('success');
        setMessage(response.message);
      })
      .catch((requestError) => {
        if (!active) return;
        setStatus('error');
        setMessage(
          requestError instanceof Error
            ? requestError.message
            : 'We could not verify this email link. Please request another one.',
        );
      });

    return () => {
      active = false;
    };
  }, [token]);

  return (
    <PublicCard>
      <StatusBadge status={status} />
      <h1 className="mt-5 text-3xl font-black text-ink">
        {status === 'checking' ? 'Verifying email' : status === 'success' ? 'Email verified' : 'Unable to verify email'}
      </h1>
      <p className="mt-3 text-slate-600" role="status">
        {message}
      </p>
      {status !== 'checking' && (
        <button
          type="button"
          className="mt-7 w-full rounded-xl bg-brand py-3 font-bold text-white transition hover:bg-emerald-800"
          onClick={onContinue}
        >
          Continue to sign in
        </button>
      )}
    </PublicCard>
  );
}

function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to request a reset link.');
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <PublicCard>
        <StatusBadge status="success" />
        <h1 className="mt-5 text-3xl font-black text-ink">Check your inbox</h1>
        <p className="mt-3 text-slate-600">
          If that email belongs to an account, you’ll receive a password-reset link shortly.
        </p>
        <button
          type="button"
          className="mt-7 w-full rounded-xl bg-brand py-3 font-bold text-white transition hover:bg-emerald-800"
          onClick={onBack}
        >
          Back to sign in
        </button>
      </PublicCard>
    );
  }

  return (
    <PublicCard>
      <h1 className="mt-8 text-3xl font-black text-ink">Reset your password</h1>
      <p className="mb-7 mt-2 text-slate-500">Enter your email and we’ll send a secure reset link.</p>
      <form onSubmit={submit}>
        <input
          className="field"
          type="email"
          autoComplete="email"
          placeholder="Email address"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button
          className="w-full rounded-xl bg-brand py-3 font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting}
        >
          {submitting ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <button type="button" className="mt-5 w-full text-sm font-semibold text-brand hover:underline" onClick={onBack}>
        Back to sign in
      </button>
    </PublicCard>
  );
}

function ResetPassword({ onContinue }: { onContinue: () => void }) {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await api<{ message: string }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setComplete(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to reset your password.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <PublicCard>
        <StatusBadge status="error" />
        <h1 className="mt-5 text-3xl font-black text-ink">Invalid reset link</h1>
        <p className="mt-3 text-slate-600">Request a new password-reset email and use the latest link.</p>
        <button
          type="button"
          className="mt-7 w-full rounded-xl bg-brand py-3 font-bold text-white transition hover:bg-emerald-800"
          onClick={onContinue}
        >
          Back to sign in
        </button>
      </PublicCard>
    );
  }

  if (complete) {
    return (
      <PublicCard>
        <StatusBadge status="success" />
        <h1 className="mt-5 text-3xl font-black text-ink">Password updated</h1>
        <p className="mt-3 text-slate-600">Your new password is ready to use. Please sign in again.</p>
        <button
          type="button"
          className="mt-7 w-full rounded-xl bg-brand py-3 font-bold text-white transition hover:bg-emerald-800"
          onClick={onContinue}
        >
          Sign in
        </button>
      </PublicCard>
    );
  }

  return (
    <PublicCard>
      <h1 className="mt-8 text-3xl font-black text-ink">Choose a new password</h1>
      <p className="mb-7 mt-2 text-slate-500">Use at least 8 characters and keep it unique to Mahbub.</p>
      <form onSubmit={submit}>
        <input
          className="field"
          type="password"
          autoComplete="new-password"
          placeholder="New password"
          minLength={8}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <input
          className="field"
          type="password"
          autoComplete="new-password"
          placeholder="Confirm new password"
          minLength={8}
          required
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
        {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button
          className="w-full rounded-xl bg-brand py-3 font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting}
        >
          {submitting ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </PublicCard>
  );
}

type BusinessDay = { open: string; close: string; closed?: boolean };
type RestaurantProfile = {
  id: string;
  name: string;
  description?: string | null;
  phone: string;
  address: string;
  city: string;
  logoUrl?: string | null;
  bannerUrl?: string | null;
  businessHours: Record<string, BusinessDay>;
  cuisineCategories: string[];
  deliveryRadiusKm: number;
  minimumOrderCents: number;
  status: 'OPEN' | 'BUSY' | 'CLOSED';
};

type RestaurantForm = Omit<RestaurantProfile, 'id' | 'description' | 'logoUrl' | 'bannerUrl'> & {
  description: string;
  logoUrl: string | null;
  bannerUrl: string | null;
};

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function emptyRestaurantForm(): RestaurantForm {
  return {
    name: '', description: '', phone: '', address: '', city: 'Kuala Lumpur', logoUrl: null, bannerUrl: null,
    cuisineCategories: ['Malaysian'], deliveryRadiusKm: 5, minimumOrderCents: 0, status: 'CLOSED',
    businessHours: Object.fromEntries(days.map((day) => [day, { open: '09:00', close: '22:00', closed: false }])),
  };
}

function profileToForm(profile: RestaurantProfile): RestaurantForm {
  return { ...profile, description: profile.description || '', logoUrl: profile.logoUrl || null, bannerUrl: profile.bannerUrl || null };
}

function RestaurantDashboard({ user, onSignOut }: { user: CustomerUser; onSignOut: () => void }) {
  const [restaurant, setRestaurant] = useState<RestaurantProfile | null>(null);
  const [form, setForm] = useState<RestaurantForm>(emptyRestaurantForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [workspace, setWorkspace] = useState<'profile' | 'menu'>('profile');

  useEffect(() => {
    let active = true;
    api<{ restaurant: RestaurantProfile | null }>('/owner/restaurant')
      .then(({ restaurant: existing }) => {
        if (!active) return;
        setRestaurant(existing);
        if (existing) setForm(profileToForm(existing));
      })
      .catch(() => active && setError('We could not load your restaurant profile.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  function updateHour(day: string, key: keyof BusinessDay, value: string | boolean) {
    setForm((current) => ({
      ...current,
      businessHours: { ...current.businessHours, [day]: { ...current.businessHours[day], [key]: value } },
    }));
  }

  function readImage(event: ChangeEvent<HTMLInputElement>, field: 'logoUrl' | 'bannerUrl') {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 900_000) {
      setError('Please choose an image under 900 KB (JPG, PNG, or WebP).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, [field]: String(reader.result) }));
    reader.readAsDataURL(file);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(''); setNotice('');
    const payload = { ...form, cuisineCategories: form.cuisineCategories.map((item) => item.trim()).filter(Boolean) };
    try {
      const response = await api<{ restaurant: RestaurantProfile }>('/owner/restaurant', {
        method: restaurant ? 'PUT' : 'POST', body: JSON.stringify(payload),
      });
      setRestaurant(response.restaurant);
      setForm(profileToForm(response.restaurant));
      setNotice(restaurant ? 'Restaurant settings saved.' : 'Your restaurant is now ready to manage.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to save the restaurant.');
    } finally { setSaving(false); }
  }

  if (loading) return <div className="grid min-h-screen place-items-center bg-cream text-ink">Loading restaurant workspace…</div>;

  const statusTone = { OPEN: 'bg-emerald-100 text-emerald-800', BUSY: 'bg-amber-100 text-amber-800', CLOSED: 'bg-slate-200 text-slate-700' };
  return (
    <div className="min-h-screen bg-[#f6f7f4] text-ink">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <Brand />
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-slate-500 sm:block">{user.fullName}</span>
            <button type="button" className="rounded-full border border-sage px-4 py-2 text-sm font-semibold transition hover:bg-sage" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-bold uppercase tracking-[.18em] text-brand">Restaurant workspace</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{workspace === 'menu' ? 'Menu management' : restaurant ? 'Restaurant settings' : 'Set up your restaurant'}</h1>
            <p className="mt-2 max-w-xl text-slate-500">{workspace === 'menu' ? 'Build a customer-ready menu with real prices, choices, availability, and scheduled promotions.' : 'Keep your storefront accurate so customers know exactly when and how to order.'}</p>
          </div>
          {restaurant && <span className={`w-fit rounded-full px-3 py-1.5 text-sm font-bold ${statusTone[form.status]}`}>{form.status === 'OPEN' ? '● Open for orders' : form.status === 'BUSY' ? '● Busy right now' : '● Closed'}</span>}
        </div>

        <nav className="mb-6 flex w-fit rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-slate-200" aria-label="Restaurant workspace">
          {(['profile', 'menu'] as const).map((view) => <button key={view} type="button" onClick={() => setWorkspace(view)} className={`rounded-xl px-4 py-2.5 text-sm font-bold transition ${workspace === view ? 'bg-brand text-white shadow-sm' : 'text-slate-500 hover:text-ink'}`}>{view === 'profile' ? 'Restaurant profile' : 'Menu & pricing'}</button>)}
        </nav>

        {workspace === 'profile' ? <form onSubmit={save} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            <section className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="relative h-44 bg-gradient-to-br from-brand via-emerald-700 to-teal-600">
                {form.bannerUrl && <img src={form.bannerUrl} alt="Restaurant banner preview" className="h-full w-full object-cover" />}
                <label className="absolute right-4 top-4 cursor-pointer rounded-xl bg-white/95 px-3 py-2 text-sm font-bold text-ink shadow-sm hover:bg-white">
                  {form.bannerUrl ? 'Change banner' : 'Upload banner'}
                  <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => readImage(event, 'bannerUrl')} />
                </label>
              </div>
              <div className="relative px-5 pb-6 pt-14 sm:px-7">
                <div className="absolute -top-12 left-5 grid h-24 w-24 place-items-center overflow-hidden rounded-2xl border-4 border-white bg-sage text-3xl font-black text-brand shadow-sm sm:left-7">
                  {form.logoUrl ? <img src={form.logoUrl} alt="Restaurant logo preview" className="h-full w-full object-cover" /> : form.name.slice(0, 1).toUpperCase() || 'M'}
                </div>
                <label className="absolute right-5 top-4 cursor-pointer text-sm font-bold text-brand hover:underline sm:right-7">
                  Upload logo
                  <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => readImage(event, 'logoUrl')} />
                </label>
                <SectionTitle eyebrow="Public profile" title="Tell customers about your restaurant" />
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Input label="Restaurant name" value={form.name} required onChange={(value) => setForm({ ...form, name: value })} />
                  <Input label="Phone number" value={form.phone} required placeholder="+60 12 345 6789" onChange={(value) => setForm({ ...form, phone: value })} />
                  <div className="sm:col-span-2"><Input label="Street address" value={form.address} required placeholder="123 Jalan Tun Razak" onChange={(value) => setForm({ ...form, address: value })} /></div>
                  <Input label="City" value={form.city} required onChange={(value) => setForm({ ...form, city: value })} />
                  <label className="block text-sm font-bold text-slate-700">Cuisine categories
                    <input className="field mt-1 !mb-0" value={form.cuisineCategories.join(', ')} onChange={(event) => setForm({ ...form, cuisineCategories: event.target.value.split(',') })} placeholder="Malaysian, Halal, Rice bowls" />
                    <span className="mt-1 block text-xs font-normal text-slate-400">Separate categories with commas.</span>
                  </label>
                  <label className="block text-sm font-bold text-slate-700 sm:col-span-2">Restaurant description
                    <textarea className="field mt-1 min-h-24 !mb-0 resize-y" maxLength={1000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What makes your food special?" />
                  </label>
                </div>
              </div>
            </section>

            <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
              <SectionTitle eyebrow="Availability" title="Business hours" note="Set the schedule your customers see before placing an order." />
              <div className="mt-5 divide-y divide-slate-100">
                {days.map((day) => {
                  const schedule = form.businessHours[day];
                  return <div key={day} className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 sm:grid-cols-[130px_1fr_1fr_auto]">
                    <span className="font-bold text-slate-700">{day.slice(0, 3)}</span>
                    <input className="field hidden !mb-0 sm:block" type="time" disabled={schedule.closed} value={schedule.open} onChange={(event) => updateHour(day, 'open', event.target.value)} />
                    <input className="field hidden !mb-0 sm:block" type="time" disabled={schedule.closed} value={schedule.close} onChange={(event) => updateHour(day, 'close', event.target.value)} />
                    <span className="text-sm text-slate-500 sm:hidden">{schedule.closed ? 'Closed' : `${schedule.open} – ${schedule.close}`}</span>
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-600"><input type="checkbox" checked={Boolean(schedule.closed)} onChange={(event) => updateHour(day, 'closed', event.target.checked)} /> Closed</label>
                  </div>;
                })}
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-3xl bg-ink p-6 text-white shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-200">Order availability</p>
              <h2 className="mt-2 text-xl font-black">Current restaurant status</h2>
              <div className="mt-5 grid gap-2">
                {(['OPEN', 'BUSY', 'CLOSED'] as const).map((status) => <button key={status} type="button" onClick={() => setForm({ ...form, status })} className={`rounded-xl border px-4 py-3 text-left text-sm font-bold transition ${form.status === status ? 'border-emerald-300 bg-emerald-400 text-ink' : 'border-white/15 text-white hover:bg-white/10'}`}>
                  {status === 'OPEN' ? 'Open — accepting orders' : status === 'BUSY' ? 'Busy — longer wait times' : 'Closed — pause new orders'}
                </button>)}
              </div>
            </section>
            <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <SectionTitle eyebrow="Delivery" title="Order requirements" />
              <div className="mt-5 space-y-4">
                <label className="block text-sm font-bold text-slate-700">Delivery radius
                  <div className="relative mt-1"><input className="field !mb-0 pr-12" type="number" min="1" max="50" step="0.5" value={form.deliveryRadiusKm} onChange={(event) => setForm({ ...form, deliveryRadiusKm: Number(event.target.value) })} /><span className="absolute right-4 top-3 text-sm text-slate-500">km</span></div>
                </label>
                <label className="block text-sm font-bold text-slate-700">Minimum order
                  <div className="relative mt-1"><span className="absolute left-4 top-3 text-sm text-slate-500">RM</span><input className="field !mb-0 pl-12" type="number" min="0" max="1000" step="0.5" value={(form.minimumOrderCents / 100).toFixed(2)} onChange={(event) => setForm({ ...form, minimumOrderCents: Math.round(Number(event.target.value) * 100) })} /></div>
                </label>
              </div>
            </section>
            {error && <p className="rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700">{error}</p>}
            {notice && <p className="rounded-2xl bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{notice}</p>}
            <button className="w-full rounded-2xl bg-brand px-5 py-4 font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60" disabled={saving}>{saving ? 'Saving settings…' : restaurant ? 'Save changes' : 'Create restaurant'}</button>
            {restaurant && <button type="button" className="w-full text-sm font-bold text-slate-500 hover:text-ink" onClick={() => setForm(profileToForm(restaurant))}>Discard unsaved changes</button>}
          </aside>
        </form> : restaurant ? <MenuManager /> : <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-sm"><p className="text-lg font-black">Create your restaurant profile first</p><p className="mt-2 text-slate-500">Save your restaurant details before adding categories and menu items.</p><button type="button" className="mt-5 rounded-xl bg-brand px-5 py-3 font-bold text-white" onClick={() => setWorkspace('profile')}>Complete restaurant profile</button></div>}
      </main>
    </div>
  );
}

function SectionTitle({ eyebrow, title, note }: { eyebrow: string; title: string; note?: string }) {
  return <div><p className="text-xs font-bold uppercase tracking-[.16em] text-brand">{eyebrow}</p><h2 className="mt-1 text-xl font-black text-ink">{title}</h2>{note && <p className="mt-1 text-sm text-slate-500">{note}</p>}</div>;
}

function Input({ label, value, onChange, required, placeholder }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; placeholder?: string }) {
  return <label className="block text-sm font-bold text-slate-700">{label}<input className="field mt-1 !mb-0" value={value} required={required} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

type MenuOption = { id?: string; name: string; priceCents: number; isAvailable: boolean };
type MenuChoiceGroup = { id?: string; name: string; minSelections: number; maxSelections: number; isRequired: boolean; options: MenuOption[] };
type MenuDiscount = { discountType: 'PERCENTAGE' | 'FIXED_AMOUNT'; value: number; startsAt: string; endsAt?: string | null; isActive: boolean };
type ManagedMenuItem = {
  id: string; categoryId: string; name: string; description?: string | null; imageUrl?: string | null; basePriceCents: number;
  preparationTimeMinutes: number; isAvailable: boolean; displayOrder: number; variations: MenuChoiceGroup[]; addOnGroups: MenuChoiceGroup[]; discount: MenuDiscount | null;
};
type MenuCategory = { id: string; name: string; description?: string | null; displayOrder: number; isAvailable: boolean; items: ManagedMenuItem[] };
type MenuItemDraft = Omit<ManagedMenuItem, 'id' | 'description' | 'imageUrl'> & { description: string; imageUrl: string | null };
type MenuCategoryDraft = { name: string; description: string; isAvailable: boolean; displayOrder: number };

const money = new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' });
const localDateTime = () => new Date().toISOString().slice(0, 16);
const blankOption = (): MenuOption => ({ name: '', priceCents: 0, isAvailable: true });
const blankChoiceGroup = (): MenuChoiceGroup => ({ name: '', minSelections: 0, maxSelections: 1, isRequired: false, options: [blankOption()] });
const blankCategory = (): MenuCategoryDraft => ({ name: '', description: '', isAvailable: true, displayOrder: 0 });
const blankMenuItem = (categoryId: string): MenuItemDraft => ({
  categoryId, name: '', description: '', imageUrl: null, basePriceCents: 0, preparationTimeMinutes: 15, isAvailable: true,
  displayOrder: 0, variations: [], addOnGroups: [], discount: null,
});

function menuItemToDraft(item: ManagedMenuItem): MenuItemDraft {
  return { ...item, description: item.description || '', imageUrl: item.imageUrl || null };
}

function toLocalControlValue(value?: string | null) {
  return value ? new Date(value).toISOString().slice(0, 16) : '';
}

function currentDiscountedPrice(item: ManagedMenuItem) {
  const discount = item.discount;
  if (!discount || !discount.isActive || new Date(discount.startsAt) > new Date() || (discount.endsAt && new Date(discount.endsAt) <= new Date())) return item.basePriceCents;
  return discount.discountType === 'PERCENTAGE'
    ? Math.max(0, Math.round(item.basePriceCents * (1 - discount.value / 100)))
    : Math.max(0, item.basePriceCents - discount.value);
}

function MenuManager() {
  const [categories, setCategories] = useState<MenuCategory[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [categoryEditor, setCategoryEditor] = useState<{ category?: MenuCategory } | null>(null);
  const [itemEditor, setItemEditor] = useState<{ item?: ManagedMenuItem; categoryId: string } | null>(null);

  async function loadMenu() {
    setError('');
    try {
      const response = await api<{ categories: MenuCategory[] }>('/owner/menu');
      setCategories(response.categories);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load menu.');
    }
  }

  useEffect(() => { void loadMenu(); }, []);

  async function deleteCategory(category: MenuCategory) {
    if (!window.confirm(`Delete “${category.name}”? Categories with menu items cannot be deleted.`)) return;
    try {
      await api(`/owner/menu/categories/${category.id}`, { method: 'DELETE' });
      setNotice('Category deleted.');
      void loadMenu();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to delete category.'); }
  }

  async function deleteItem(item: ManagedMenuItem) {
    if (!window.confirm(`Delete “${item.name}”? This cannot be undone.`)) return;
    try {
      await api(`/owner/menu/items/${item.id}`, { method: 'DELETE' });
      setNotice('Menu item deleted.');
      void loadMenu();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to delete item.'); }
  }

  const allItems = categories?.flatMap((category) => category.items) || [];
  const availableItems = allItems.filter((item) => item.isAvailable).length;
  return (
    <div>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <MenuStat label="Menu categories" value={String(categories?.length || 0)} note="Organize the customer menu" />
        <MenuStat label="Available items" value={String(availableItems)} note={`${allItems.length - availableItems} currently hidden`} />
        <MenuStat label="Active promotions" value={String(allItems.filter((item) => currentDiscountedPrice(item) < item.basePriceCents).length)} note="Live item-level discounts" />
      </div>
      <div className="mb-6 flex flex-col justify-between gap-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:flex-row sm:items-center sm:p-6">
        <div><p className="text-xs font-bold uppercase tracking-[.16em] text-brand">Menu catalogue</p><h2 className="mt-1 text-xl font-black">Items with real pricing & choices</h2></div>
        <button type="button" className="rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-800" onClick={() => setCategoryEditor({})}>Add category</button>
      </div>
      {error && <p className="mb-5 rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700">{error}</p>}
      {notice && <p className="mb-5 rounded-2xl bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{notice}</p>}
      {!categories ? <div className="rounded-3xl bg-white p-12 text-center text-slate-500 shadow-sm">Loading menu catalogue…</div> : categories.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-sm"><p className="text-xl font-black">Start with a menu category</p><p className="mx-auto mt-2 max-w-md text-slate-500">Create categories such as Mains, Drinks, or Desserts, then add individual items with their own pricing and options.</p><button type="button" className="mt-5 rounded-xl bg-brand px-5 py-3 font-bold text-white" onClick={() => setCategoryEditor({})}>Create first category</button></div>
      ) : <div className="space-y-5">
        {categories.map((category) => <section key={category.id} className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-col justify-between gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:px-6">
            <div className="min-w-0"><div className="flex items-center gap-3"><h3 className="truncate text-lg font-black">{category.name}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${category.isAvailable ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{category.isAvailable ? 'Visible' : 'Hidden'}</span></div>{category.description && <p className="mt-1 text-sm text-slate-500">{category.description}</p>}</div>
            <div className="flex gap-2"><button type="button" className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100" onClick={() => setCategoryEditor({ category })}>Edit</button><button type="button" className="rounded-lg px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50" onClick={() => void deleteCategory(category)}>Delete</button><button type="button" className="rounded-xl bg-brand px-3 py-2 text-sm font-bold text-white hover:bg-emerald-800" onClick={() => setItemEditor({ categoryId: category.id })}>Add item</button></div>
          </div>
          {category.items.length === 0 ? <p className="p-6 text-sm text-slate-500">No menu items in this category yet.</p> : <div className="divide-y divide-slate-100">
            {category.items.map((item) => <MenuItemRow key={item.id} item={item} onEdit={() => setItemEditor({ item, categoryId: category.id })} onDelete={() => void deleteItem(item)} />)}
          </div>}
        </section>)}
      </div>}
      {categoryEditor && <CategoryEditor category={categoryEditor.category} onClose={() => setCategoryEditor(null)} onSaved={(message) => { setCategoryEditor(null); setNotice(message); void loadMenu(); }} onError={setError} />}
      {itemEditor && <MenuItemEditor key={itemEditor.item?.id || `new-${itemEditor.categoryId}`} item={itemEditor.item} categoryId={itemEditor.categoryId} categories={categories || []} onClose={() => setItemEditor(null)} onSaved={(message) => { setItemEditor(null); setNotice(message); void loadMenu(); }} />}
    </div>
  );
}

function MenuStat({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-2 text-3xl font-black">{value}</p><p className="mt-1 text-xs text-slate-400">{note}</p></div>;
}

function MenuItemRow({ item, onEdit, onDelete }: { item: ManagedMenuItem; onEdit: () => void; onDelete: () => void }) {
  const salePrice = currentDiscountedPrice(item);
  const discount = item.discount;
  return <div className="flex gap-4 p-5 sm:items-center sm:px-6">
    <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-sage font-black text-brand">{item.imageUrl ? <img src={item.imageUrl} alt="" className="h-full w-full object-cover" /> : item.name.slice(0, 1).toUpperCase()}</div>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-black">{item.name}</p><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${item.isAvailable ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{item.isAvailable ? 'Available' : 'Unavailable'}</span>{salePrice < item.basePriceCents && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">{discount?.discountType === 'PERCENTAGE' ? `${discount.value}% off` : 'Sale'}</span>}</div><p className="mt-1 line-clamp-1 text-sm text-slate-500">{item.description || 'No description yet.'}</p><p className="mt-2 text-xs font-semibold text-slate-400">{item.preparationTimeMinutes} min prep · {item.variations.length} variation group{item.variations.length === 1 ? '' : 's'} · {item.addOnGroups.length} add-on group{item.addOnGroups.length === 1 ? '' : 's'}</p></div>
    <div className="hidden text-right sm:block"><p className="font-black text-brand">{money.format(salePrice / 100)}</p>{salePrice < item.basePriceCents && <p className="text-xs text-slate-400 line-through">{money.format(item.basePriceCents / 100)}</p>}</div>
    <div className="flex shrink-0 flex-col gap-1"><button type="button" className="rounded-lg px-2 py-1.5 text-sm font-bold text-brand hover:bg-sage" onClick={onEdit}>Edit</button><button type="button" className="rounded-lg px-2 py-1.5 text-sm font-bold text-red-600 hover:bg-red-50" onClick={onDelete}>Delete</button></div>
  </div>;
}

function CategoryEditor({ category, onClose, onSaved, onError }: { category?: MenuCategory; onClose: () => void; onSaved: (message: string) => void; onError: (message: string) => void }) {
  const [form, setForm] = useState<MenuCategoryDraft>(category ? { name: category.name, description: category.description || '', isAvailable: category.isAvailable, displayOrder: category.displayOrder } : blankCategory());
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); onError('');
    try {
      await api(category ? `/owner/menu/categories/${category.id}` : '/owner/menu/categories', { method: category ? 'PUT' : 'POST', body: JSON.stringify(form) });
      onSaved(category ? 'Category updated.' : 'Category created.');
    } catch (requestError) { onError(requestError instanceof Error ? requestError.message : 'Unable to save category.'); } finally { setSaving(false); }
  }
  return <Modal title={category ? 'Edit menu category' : 'New menu category'} onClose={onClose}>
    <form onSubmit={save} className="space-y-4"><label className="block text-sm font-bold text-slate-700">Category name<input className="field mt-1 !mb-0" required value={form.name} placeholder="e.g. Signature Mains" onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label className="block text-sm font-bold text-slate-700">Short description <span className="font-normal text-slate-400">(optional)</span><textarea className="field mt-1 min-h-20 !mb-0" maxLength={300} value={form.description} placeholder="A short introduction for this category" onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><div className="grid grid-cols-2 gap-4"><label className="block text-sm font-bold text-slate-700">Display order<input className="field mt-1 !mb-0" type="number" min="0" value={form.displayOrder} onChange={(event) => setForm({ ...form, displayOrder: Number(event.target.value) })} /></label><label className="flex items-center gap-2 self-end pb-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={form.isAvailable} onChange={(event) => setForm({ ...form, isAvailable: event.target.checked })} /> Visible to customers</label></div><ModalActions saving={saving} submitLabel={category ? 'Save category' : 'Create category'} onClose={onClose} /></form>
  </Modal>;
}

function MenuItemEditor({ item, categoryId, categories, onClose, onSaved }: { item?: ManagedMenuItem; categoryId: string; categories: MenuCategory[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [form, setForm] = useState<MenuItemDraft>(item ? menuItemToDraft(item) : blankMenuItem(categoryId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function updateGroups(key: 'variations' | 'addOnGroups', groups: MenuChoiceGroup[]) { setForm((current) => ({ ...current, [key]: groups })); }
  function readImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 900_000) { setError('Use a JPG, PNG, or WebP image under 900 KB.'); return; }
    const reader = new FileReader(); reader.onload = () => setForm((current) => ({ ...current, imageUrl: String(reader.result) })); reader.readAsDataURL(file);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const invalidGroup = [...form.variations, ...form.addOnGroups].some((group) => !group.name.trim() || group.options.some((option) => !option.name.trim()) || group.minSelections > group.maxSelections || (group.isRequired && group.minSelections === 0));
    if (invalidGroup) { setError('Each choice group needs a name, named options, and valid selection limits.'); return; }
    if (form.discount && form.discount.endsAt && new Date(form.discount.endsAt) <= new Date(form.discount.startsAt)) { setError('Discount end time must be after its start time.'); return; }
    setSaving(true);
    const payload = { ...form, discount: form.discount ? { ...form.discount, startsAt: new Date(form.discount.startsAt).toISOString(), endsAt: form.discount.endsAt ? new Date(form.discount.endsAt).toISOString() : null } : null };
    try {
      await api(item ? `/owner/menu/items/${item.id}` : '/owner/menu/items', { method: item ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      onSaved(item ? 'Menu item updated.' : 'Menu item added to your catalogue.');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to save menu item.'); } finally { setSaving(false); }
  }
  return <Modal title={item ? 'Edit menu item' : 'Add menu item'} onClose={onClose} wide>
    <form onSubmit={save} className="space-y-7"><div className="grid gap-5 md:grid-cols-[150px_1fr]"><div className="relative grid h-36 place-items-center overflow-hidden rounded-2xl bg-sage text-4xl font-black text-brand">{form.imageUrl ? <img src={form.imageUrl} alt="Item preview" className="h-full w-full object-cover" /> : form.name.slice(0, 1).toUpperCase() || 'M'}<label className="absolute inset-x-2 bottom-2 cursor-pointer rounded-lg bg-white/95 px-2 py-1.5 text-center text-xs font-bold text-ink shadow-sm">Upload image<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={readImage} /></label></div><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-bold text-slate-700">Item name<input className="field mt-1 !mb-0" required value={form.name} placeholder="e.g. Charcoal chicken bowl" onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label className="block text-sm font-bold text-slate-700">Menu category<select className="field mt-1 !mb-0 bg-white" value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="block text-sm font-bold text-slate-700 sm:col-span-2">Description <span className="font-normal text-slate-400">(optional)</span><textarea className="field mt-1 min-h-20 !mb-0" maxLength={1000} value={form.description} placeholder="Describe the dish, ingredients, and serving size." onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div></div>
      <section className="rounded-2xl bg-cream p-5"><p className="text-xs font-bold uppercase tracking-[.16em] text-brand">Pricing & availability</p><div className="mt-4 grid gap-4 sm:grid-cols-3"><MoneyInput label="Base price" cents={form.basePriceCents} onChange={(basePriceCents) => setForm({ ...form, basePriceCents })} /><label className="block text-sm font-bold text-slate-700">Preparation time<div className="relative mt-1"><input className="field !mb-0 pr-12" type="number" min="1" max="240" value={form.preparationTimeMinutes} onChange={(event) => setForm({ ...form, preparationTimeMinutes: Number(event.target.value) })} /><span className="absolute right-4 top-3 text-sm text-slate-500">min</span></div></label><label className="flex items-center gap-2 self-end pb-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={form.isAvailable} onChange={(event) => setForm({ ...form, isAvailable: event.target.checked })} /> Available to order</label></div></section>
      <ChoiceGroupEditor title="Variations" description="Let customers choose sizes, spice levels, or other required configurations." groups={form.variations} onChange={(groups) => updateGroups('variations', groups)} />
      <ChoiceGroupEditor title="Add-ons" description="Offer optional extras such as drinks, toppings, or sides." groups={form.addOnGroups} onChange={(groups) => updateGroups('addOnGroups', groups)} />
      <DiscountEditor discount={form.discount} basePriceCents={form.basePriceCents} onChange={(discount) => setForm({ ...form, discount })} />
      {error && <p className="rounded-xl bg-red-50 p-4 text-sm font-medium text-red-700">{error}</p>}<ModalActions saving={saving} submitLabel={item ? 'Save item changes' : 'Add menu item'} onClose={onClose} />
    </form>
  </Modal>;
}

function MoneyInput({ label, cents, onChange }: { label: string; cents: number; onChange: (cents: number) => void }) {
  return <label className="block text-sm font-bold text-slate-700">{label}<div className="relative mt-1"><span className="absolute left-4 top-3 text-sm text-slate-500">RM</span><input className="field !mb-0 pl-12" type="number" min="0" max="10000" step="0.01" value={(cents / 100).toFixed(2)} onChange={(event) => onChange(Math.round(Number(event.target.value) * 100))} /></div></label>;
}

function ChoiceGroupEditor({ title, description, groups, onChange }: { title: string; description: string; groups: MenuChoiceGroup[]; onChange: (groups: MenuChoiceGroup[]) => void }) {
  function updateGroup(index: number, changes: Partial<MenuChoiceGroup>) { onChange(groups.map((group, groupIndex) => groupIndex === index ? { ...group, ...changes } : group)); }
  function updateOption(groupIndex: number, optionIndex: number, changes: Partial<MenuOption>) { onChange(groups.map((group, index) => index === groupIndex ? { ...group, options: group.options.map((option, optionIndexValue) => optionIndexValue === optionIndex ? { ...option, ...changes } : option) } : group)); }
  return <section className="rounded-2xl border border-slate-200 p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-brand">Customer choices</p><h3 className="mt-1 text-lg font-black">{title}</h3><p className="mt-1 text-sm text-slate-500">{description}</p></div><button type="button" className="rounded-xl border border-brand px-3 py-2 text-sm font-bold text-brand hover:bg-sage" onClick={() => onChange([...groups, blankChoiceGroup()])}>Add group</button></div>{groups.length === 0 ? <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No {title.toLowerCase()} yet.</p> : <div className="mt-5 space-y-4">{groups.map((group, groupIndex) => <div key={groupIndex} className="rounded-xl bg-slate-50 p-4"><div className="grid gap-3 sm:grid-cols-[1fr_105px_105px_auto]"><label className="block text-sm font-bold text-slate-700">Group name<input className="field mt-1 !mb-0" value={group.name} placeholder={title === 'Variations' ? 'e.g. Choose your size' : 'e.g. Extras'} onChange={(event) => updateGroup(groupIndex, { name: event.target.value })} /></label><label className="block text-sm font-bold text-slate-700">Min<select className="field mt-1 !mb-0 bg-white" value={group.minSelections} onChange={(event) => updateGroup(groupIndex, { minSelections: Number(event.target.value) })}>{[0, 1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="block text-sm font-bold text-slate-700">Max<select className="field mt-1 !mb-0 bg-white" value={group.maxSelections} onChange={(event) => updateGroup(groupIndex, { maxSelections: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><button type="button" className="self-end rounded-lg px-2 py-3 text-sm font-bold text-red-600 hover:bg-red-100" onClick={() => onChange(groups.filter((_, index) => index !== groupIndex))}>Remove</button></div><label className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-700"><input type="checkbox" checked={group.isRequired} onChange={(event) => updateGroup(groupIndex, { isRequired: event.target.checked, minSelections: event.target.checked && group.minSelections === 0 ? 1 : group.minSelections })} /> Required choice</label><div className="mt-4 space-y-2">{group.options.map((option, optionIndex) => <div key={optionIndex} className="grid gap-2 sm:grid-cols-[1fr_130px_auto_auto]"><input className="field !mb-0" value={option.name} placeholder="Option name" onChange={(event) => updateOption(groupIndex, optionIndex, { name: event.target.value })} /><MoneyInput label="" cents={option.priceCents} onChange={(priceCents) => updateOption(groupIndex, optionIndex, { priceCents })} /><label className="flex items-center gap-2 self-center text-xs font-bold text-slate-600"><input type="checkbox" checked={option.isAvailable} onChange={(event) => updateOption(groupIndex, optionIndex, { isAvailable: event.target.checked })} /> Available</label><button type="button" className="rounded-lg px-2 text-sm font-bold text-red-600 hover:bg-red-100" disabled={group.options.length === 1} onClick={() => updateGroup(groupIndex, { options: group.options.filter((_, index) => index !== optionIndex) })}>×</button></div>)}<button type="button" className="mt-1 text-sm font-bold text-brand hover:underline" onClick={() => updateGroup(groupIndex, { options: [...group.options, blankOption()] })}>+ Add option</button></div></div>)}</div>}</section>;
}

function DiscountEditor({ discount, basePriceCents, onChange }: { discount: MenuDiscount | null; basePriceCents: number; onChange: (discount: MenuDiscount | null) => void }) {
  const enabled = Boolean(discount);
  const setEnabled = (value: boolean) => onChange(value ? { discountType: 'PERCENTAGE', value: 10, startsAt: localDateTime(), endsAt: null, isActive: true } : null);
  return <section className="rounded-2xl border border-rose-100 bg-rose-50/50 p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-rose-600">Promotion</p><h3 className="mt-1 text-lg font-black">Item discount</h3><p className="mt-1 text-sm text-slate-500">Set a live or scheduled promotional price for this item.</p></div><label className="flex items-center gap-2 text-sm font-bold text-slate-700"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Enable</label></div>{discount && <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="block text-sm font-bold text-slate-700">Discount type<select className="field mt-1 !mb-0 bg-white" value={discount.discountType} onChange={(event) => onChange({ ...discount, discountType: event.target.value as MenuDiscount['discountType'], value: event.target.value === 'PERCENTAGE' ? Math.min(discount.value, 100) : discount.value })}><option value="PERCENTAGE">Percentage off</option><option value="FIXED_AMOUNT">Fixed amount off</option></select></label>{discount.discountType === 'PERCENTAGE' ? <label className="block text-sm font-bold text-slate-700">Percentage<input className="field mt-1 !mb-0" type="number" min="1" max="100" value={discount.value} onChange={(event) => onChange({ ...discount, value: Number(event.target.value) })} /></label> : <MoneyInput label="Amount off" cents={discount.value} onChange={(value) => onChange({ ...discount, value })} />}<label className="block text-sm font-bold text-slate-700">Starts<input className="field mt-1 !mb-0" type="datetime-local" value={toLocalControlValue(discount.startsAt)} onChange={(event) => onChange({ ...discount, startsAt: event.target.value })} /></label><label className="block text-sm font-bold text-slate-700">Ends <span className="font-normal text-slate-400">(optional)</span><input className="field mt-1 !mb-0" type="datetime-local" value={toLocalControlValue(discount.endsAt)} onChange={(event) => onChange({ ...discount, endsAt: event.target.value || null })} /></label><label className="flex items-center gap-2 text-sm font-bold text-slate-700 sm:col-span-2"><input type="checkbox" checked={discount.isActive} onChange={(event) => onChange({ ...discount, isActive: event.target.checked })} /> Promotion is active</label><p className="sm:col-span-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-rose-700">Customer price: {money.format((discount.discountType === 'PERCENTAGE' ? Math.max(0, Math.round(basePriceCents * (1 - discount.value / 100))) : Math.max(0, basePriceCents - discount.value)) / 100)}</p></div>}</section>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 flex items-end bg-ink/40 p-0 sm:items-center sm:justify-center sm:p-6"><div className={`max-h-[94vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7 ${wide ? 'sm:max-w-4xl' : 'sm:max-w-xl'}`} role="dialog" aria-modal="true" aria-label={title}><div className="mb-6 flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-brand">Menu editor</p><h2 className="mt-1 text-2xl font-black">{title}</h2></div><button type="button" className="grid h-9 w-9 place-items-center rounded-full text-xl text-slate-500 hover:bg-slate-100" aria-label="Close" onClick={onClose}>×</button></div>{children}</div></div>;
}

function ModalActions({ saving, submitLabel, onClose }: { saving: boolean; submitLabel: string; onClose: () => void }) {
  return <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end"><button type="button" className="rounded-xl px-5 py-3 text-sm font-bold text-slate-600 hover:bg-slate-100" onClick={onClose}>Cancel</button><button className="rounded-xl bg-brand px-5 py-3 text-sm font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60" disabled={saving}>{saving ? 'Saving…' : submitLabel}</button></div>;
}

function CustomerDashboard({
  user,
  onUserRefresh,
  onSignOut,
}: {
  user: CustomerUser;
  onUserRefresh: () => void;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState('overview');
  const tabs = ['overview', 'restaurants', 'addresses', 'orders', 'favorites', 'payments', 'reviews', 'loyalty'];

  return (
    <div className="min-h-screen bg-cream text-ink">
      <header className="flex items-center justify-between border-b border-sage bg-white px-6 py-5">
        <Brand />
        <button
          type="button"
          className="rounded-full border border-sage px-4 py-2 text-sm font-semibold transition hover:bg-sage"
          onClick={onSignOut}
        >
          Sign out
        </button>
      </header>
      <main className="mx-auto flex max-w-6xl gap-8 px-6 py-10 max-md:flex-col">
        <aside className="w-56 shrink-0 max-md:w-full">
          <p className="mb-5 text-xs font-bold uppercase tracking-widest text-slate-400">My account</p>
          <div className="flex gap-1 max-md:flex-wrap md:block">
            {tabs.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                className={`mb-1 block rounded-xl px-4 py-3 text-left capitalize transition max-md:w-auto md:w-full ${
                  tab === item ? 'bg-brand font-semibold text-white' : 'hover:bg-sage'
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </aside>
        <section className="min-w-0 flex-1">
          <p className="text-sm text-slate-500">Welcome back</p>
          <h1 className="mb-5 text-4xl font-black">{user.fullName}</h1>
          {!user.emailVerified && <VerificationBanner email={user.email} />}
          {tab === 'overview' && <Overview user={user} />}
          {tab === 'restaurants' && <RestaurantMenuPanel />}
          {tab === 'addresses' && <AddressesPanel />}
          {tab === 'orders' && <OrdersPanel />}
          {tab === 'favorites' && <FavoritesPanel />}
          {tab === 'payments' && <PaymentsPanel />}
          {tab === 'reviews' && <ReviewsPanel />}
          {tab === 'loyalty' && <LoyaltyPanel />}
        </section>
      </main>
    </div>
  );
}

function VerificationBanner({ email }: { email: string }) {
  const resend = useResendVerification(email);

  return (
    <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <p className="font-bold text-amber-950">Your email is not verified yet.</p>
      <p className="mt-1 text-sm text-amber-900">
        Confirm <strong>{email}</strong> to keep your customer account secure.
      </p>
      <button
        type="button"
        className="mt-3 text-sm font-bold text-brand hover:underline disabled:cursor-not-allowed disabled:opacity-60"
        disabled={resend.resending}
        onClick={resend.resend}
      >
        {resend.resending ? 'Sending…' : 'Resend verification email'}
      </button>
      {resend.notice && <p className="mt-2 text-sm text-emerald-700">{resend.notice}</p>}
      {resend.error && <p className="mt-2 text-sm text-red-700">{resend.error}</p>}
    </div>
  );
}

function Overview({ user }: { user: CustomerUser }) {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      <Card label="Loyalty points" value={String(user.loyaltyPoints)} note="Available to redeem" />
      <Card
        label="Email status"
        value={user.emailVerified ? 'Verified' : 'Verification needed'}
        note={user.email}
      />
      <Card label="Member account" value="Active" note="Good food, delivered" />
    </div>
  );
}

function Card({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-4 text-3xl font-black">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{note}</p>
    </div>
  );
}

function PublicCard({ children }: { children: ReactNode }) {
  return <AuthLayout>{children}</AuthLayout>;
}

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-cream px-5 py-10">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm">
        <Brand />
        {children}
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div>
      <span className="text-xl font-black text-brand">Mahbub</span>
      <span className="ml-2 text-sm text-slate-500">Food delivery</span>
    </div>
  );
}

function StatusBadge({ status }: { status: 'checking' | 'success' | 'error' }) {
  const styles = {
    checking: 'bg-sage text-brand',
    success: 'bg-emerald-100 text-emerald-800',
    error: 'bg-red-100 text-red-800',
  };
  const label = status === 'checking' ? 'Please wait' : status === 'success' ? 'All set' : 'Action needed';

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${styles[status]}`}>
      {label}
    </span>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
