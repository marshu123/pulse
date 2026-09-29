import { useCallback, useEffect, useState } from 'react';
import { getToken, setToken, type User } from './api';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { MonitorDetail } from './pages/MonitorDetail';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [route, setRoute] = useState<string>(() => window.location.pathname);

  // Popstate drives routing. A hash-free single-file app does not need a
  // router dependency for two screens.
  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    // Nothing to restore beyond the token; the first dashboard fetch will 401
    // and drop us back to the login screen if the token is stale.
    if (!getToken()) {
      setReady(true);
      return;
    }
    setReady(true);
  }, []);

  const navigate = useCallback((path: string) => {
    window.history.pushState({}, '', path);
    setRoute(path);
  }, []);

  const signIn = useCallback((nextUser: User, token: string) => {
    setToken(token);
    setUser(nextUser);
    navigate('/');
  }, [navigate]);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
    navigate('/login');
  }, [navigate]);

  const handleAuthed = useCallback(() => signOut(), [signOut]);

  if (!ready) {
    return <div className="boot">Loading…</div>;
  }

  if (!user) {
    return (
      <Login
        onAuthenticated={signIn}
        onUnauthorised={handleAuthed}
        initialRegister={route === '/register'}
      />
    );
  }

  const detailMatch = route.match(/^\/monitors\/(\d+)$/);
  if (detailMatch) {
    return (
      <MonitorDetail
        monitorId={Number(detailMatch[1])}
        onBack={() => navigate('/')}
        onUnauthorised={signOut}
      />
    );
  }

  return <Dashboard onSignOut={signOut} onOpen={(id) => navigate(`/monitors/${id}`)} />;
}
