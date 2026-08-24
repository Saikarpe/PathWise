import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, type User } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorNote, Loading } from "@/components/pf";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — PathWise" },
      { name: "description", content: "Sign in to PathWise to pick up your learning path." },
      { property: "og:title", content: "Sign in — PathWise" },
      { property: "og:description", content: "Sign in to continue your personalised path." },
    ],
  }),
  component: LoginPage,
});

type AuthResponse = { access_token: string; user: User };
type DemoUser = {
  email: string;
  name?: string;
  headline?: string;
  password?: string;
  available?: boolean;
};

function LoginPage() {
  const { setSession, token, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (token) navigate({ to: user?.onboarded === false ? "/onboarding" : "/dashboard", replace: true });
  }, [token, user, navigate]);

  const demo = useQuery({
    queryKey: ["demo-users"],
    // The real endpoint returns { seeded, accounts: [...] } — not a bare array.
    queryFn: () =>
      api<DemoUser[] | { accounts: DemoUser[] }>("/api/auth/demo-users", { auth: false }),
    retry: false,
  });
  const demoUsers: DemoUser[] = Array.isArray(demo.data)
    ? demo.data
    : ((demo.data as { accounts?: DemoUser[] } | undefined)?.accounts ?? []);

  const finish = (r: AuthResponse) => {
    setSession(r);
    navigate({ to: r.user?.onboarded === false ? "/onboarding" : "/dashboard", replace: true });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy("form");
    try {
      finish(
        await api<AuthResponse>("/api/auth/login", {
          method: "POST",
          auth: false,
          body: { email, password },
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const demoLogin = async (demoEmail: string) => {
    setError(null);
    setBusy(demoEmail);
    try {
      finish(
        await api<AuthResponse>("/api/auth/demo-login", {
          method: "POST",
          auth: false,
          query: { email: demoEmail },
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md px-6 py-24">
      <Link to="/" className="font-display text-sm font-semibold">
        PathWise
      </Link>
      <h1 className="mt-10 text-3xl font-semibold">Welcome back</h1>
      <p className="mt-2 text-sm text-muted-foreground">Sign in to continue your path.</p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error ? <ErrorNote error={error} /> : null}
        <Button type="submit" className="w-full" disabled={busy === "form"}>
          {busy === "form" ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        No account?{" "}
        <Link to="/register" className="text-primary underline-offset-4 hover:underline">
          Create one
        </Link>
      </p>

      <div className="mt-14 space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Or try a demo account
        </p>
        {demo.isLoading ? <Loading label="Loading demo accounts…" /> : null}
        {demo.isError ? (
          <p className="text-sm text-muted-foreground">Demo accounts aren’t available right now.</p>
        ) : null}
        <div className="space-y-2">
          {demoUsers.map((d) => (
            <button
              key={d.email}
              type="button"
              disabled={d.available === false || busy === d.email}
              onClick={() => demoLogin(d.email)}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/30 disabled:opacity-50 disabled:hover:bg-card disabled:hover:border-border"
            >
              <p className="text-sm font-medium">{d.name || d.email}</p>
              {d.headline ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{d.headline}</p>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
