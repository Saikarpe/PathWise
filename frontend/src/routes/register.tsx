import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { api, type User } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorNote } from "@/components/pf";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Create your account — PathFinder" },
      {
        name: "description",
        content: "Create a PathFinder account and turn your goal into a learning path.",
      },
      { property: "og:title", content: "Create your account — PathFinder" },
      {
        property: "og:description",
        content: "Start with a goal in plain words; get an explainable learning path.",
      },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(new Error("Passwords don’t match."));
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ access_token: string; user: User }>("/api/auth/register", {
        method: "POST",
        auth: false,
        body: { full_name: name || undefined, email, password },
      });
      setSession(r);
      navigate({ to: r.user?.onboarded ? "/dashboard" : "/onboarding", replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md px-6 py-24">
      <Link to="/" className="font-display text-sm font-semibold">
        PathFinder
      </Link>
      <h1 className="mt-10 text-3xl font-semibold">Create your account</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Next you’ll describe your goal — that’s all we need to build the first path.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name (optional)</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
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
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {error ? <ErrorNote error={error} /> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
