import { useState, type FormEvent } from 'react';
import { ApiError, api, setToken, type User } from '../api';

export function Login({
  onAuthenticated,
  onUnauthorised,
  initialRegister = false,
}: {
  onAuthenticated: (user: User, token: string) => void;
  onUnauthorised: () => void;
  initialRegister?: boolean;
}) {
  const [mode, setMode] = useState<'login' | 'register'>(
    initialRegister ? 'register' : 'login'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const result =
        mode === 'login'
          ? await api.login(email, password)
          : await api.register(email, password);
      onAuthenticated(result.user, result.access_token);
    } catch (caught) {
      if (caught instanceof ApiError) {
        // A 401 here means a stale token is sitting in storage. Drop it so the
        // rest of the app starts clean.
        if (caught.status === 401 && mode === 'login') {
          setToken(null);
          onUnauthorised();
        }
        setError(caught.message);
      } else {
        setError('Could not reach the API. Is the backend running?');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand-mark">
          <span className="dot" />
          Pulse
        </div>

        <h1>{mode === 'login' ? 'Sign in' : 'Create an account'}</h1>
        <p className="muted">
          {mode === 'login'
            ? 'Watch your endpoints and see when they break.'
            : 'Start monitoring endpoints in about a minute.'}
        </p>

        <form onSubmit={submit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete={
              mode === 'login' ? 'current-password' : 'new-password'
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy}>
            {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="switch">
          {mode === 'login' ? 'No account? ' : 'Already registered? '}
          <button
            type="button"
            className="link"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
          >
            {mode === 'login' ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
