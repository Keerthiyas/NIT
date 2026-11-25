import { useState } from 'react';
import { AlertCircle, Lock } from 'lucide-react';
import { orderAuditService } from '../../services/orderAuditService';
import type { AuthUser } from '../../types/orderAudit';

const DEMO_ACCOUNTS = [
  { label: 'Admin', email: 'admin@nitt.local', role: 'ADMIN' },
  { label: 'Owner / Super Admin', email: 'owner@nitt.local', role: 'OWNER_SUPER_ADMIN' },
  { label: 'Production Supervisor', email: 'supervisor@nitt.local', role: 'PRODUCTION_SUPERVISOR' },
  { label: 'Accountant', email: 'accountant@nitt.local', role: 'ACCOUNTANT' },
];

export function LoginView({ onSuccess }: { onSuccess: (user: AuthUser) => void }) {
  const [email, setEmail] = useState('admin@nitt.local');
  const [password, setPassword] = useState('password123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInWith = async (targetEmail: string, targetPassword: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await orderAuditService.login(targetEmail, targetPassword);
      onSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void signInWith(email, password);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-5">
        <div className="border-b border-slate-100 pb-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-900">
            NIT Trichy • Small Food Manufacturer
          </p>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">
            Order-to-Audit Console Sign In
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Role-based access enforced by backend session authentication.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label htmlFor="login-email" className="block font-medium text-slate-700 mb-1">
              Email or Username
            </label>
            <input
              id="login-email"
              type="text"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-800 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block font-medium text-slate-700 mb-1">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-800 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-950 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
          >
            <Lock className="h-3.5 w-3.5" />
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="border-t border-slate-100 pt-4">
          <p className="text-[11px] font-medium text-slate-500 mb-2">
            Quick Sign-In (Seeded Accounts • Password: <code className="text-slate-700">password123</code>)
          </p>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                type="button"
                disabled={loading}
                onClick={() => {
                  setEmail(acc.email);
                  setPassword('password123');
                  void signInWith(acc.email, 'password123');
                }}
                className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-[11px] hover:bg-blue-50 hover:border-blue-200"
              >
                <p className="font-semibold text-slate-800">{acc.label}</p>
                <p className="text-slate-500 truncate">{acc.email}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

