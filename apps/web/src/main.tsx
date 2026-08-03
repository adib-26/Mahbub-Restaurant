import { StrictMode, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AddressesPanel,
  FavoritesPanel,
  LoyaltyPanel,
  OrdersPanel,
  PaymentsPanel,
  ReviewsPanel,
} from './account';
import { api } from './api';
import './styles.css';

type ApiUser = {
  id?: string;
  fullName: string;
  email: string;
  loyaltyPoints: number;
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

  return (
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
        body: JSON.stringify(form),
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
          <input
            className="field"
            autoComplete="name"
            placeholder="Full name"
            required
            value={form.fullName}
            onChange={(event) => setForm({ ...form, fullName: event.target.value })}
          />
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
  const tabs = ['overview', 'addresses', 'orders', 'favorites', 'payments', 'reviews', 'loyalty'];

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
          {tab === 'addresses' && <AddressesPanel />}
          {tab === 'orders' && <OrdersPanel onLoyaltyChange={onUserRefresh} />}
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
