import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  api,
  clearSession,
  getStoredUser,
  getToken,
  setStoredUser,
  setToken,
  type User,
} from "./api";

type AuthResponse = { access_token: string; user: User };

type AuthCtx = {
  user: User | null;
  token: string | null;
  ready: boolean;
  setSession: (r: AuthResponse) => void;
  refreshUser: () => Promise<void>;
  signOut: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTok] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTok(getToken());
    setUser(getStoredUser());
    setReady(true);
  }, []);

  const setSession = useCallback((r: AuthResponse) => {
    setToken(r.access_token);
    setStoredUser(r.user);
    setTok(r.access_token);
    setUser(r.user);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const me = await api<User>("/api/profile");
      setStoredUser(me);
      setUser(me);
    } catch {
      /* leave cached user in place */
    }
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setTok(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, token, ready, setSession, refreshUser, signOut }),
    [user, token, ready, setSession, refreshUser, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Redirects to /login when signed out, and to /onboarding until onboarded. */
export function useRequireAuth({ allowUnonboarded = false } = {}) {
  const { user, token, ready } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!ready) return;
    if (!token) {
      navigate({ to: "/login", replace: true });
      return;
    }
    if (!allowUnonboarded && user && user.onboarded === false && pathname !== "/onboarding") {
      navigate({ to: "/onboarding", replace: true });
    }
  }, [ready, token, user, allowUnonboarded, navigate, pathname]);

  return { user, token, ready, authed: Boolean(token) };
}
