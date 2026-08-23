import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Compass,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Route as RouteIcon,
  Sparkles,
  User as UserIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { PathMark } from "@/components/PathMark";

const NAV = [
  { to: "/dashboard", label: "My Learning", icon: LayoutDashboard },
  { to: "/roadmap", label: "Roadmap", icon: RouteIcon },
  { to: "/recommendations", label: "Recommendations", icon: Sparkles },
  { to: "/explore", label: "Explore", icon: Compass },
  { to: "/chat", label: "Assistant", icon: MessageSquare },
] as const;

/**
 * The authenticated shell: a platform-style header (logo lockup, a tab-style
 * nav row, an account avatar) rather than the flatter icon-and-label bar it
 * replaced — closer to what a Coursera/Udemy learner actually recognises as
 * "an account is signed in here" than a plain text sign-out link was.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const label = (typeof user?.full_name === "string" && user.full_name) || user?.email || "";
  const initial = label.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="mx-auto flex h-16 w-full max-w-[80rem] items-center gap-8 px-6">
          <Link to="/dashboard" className="flex shrink-0 items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
              <PathMark className="h-4.5 w-4.5" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight text-foreground">
              PathFinder
            </span>
          </Link>

          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            {NAV.map(({ to, label: navLabel, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="inline-flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 py-5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                activeProps={{ className: "!border-primary !text-foreground" }}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden md:inline">{navLabel}</span>
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            <Link
              to="/profile"
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition-colors hover:bg-secondary"
              title={label}
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                {initial}
              </span>
              <span className="hidden max-w-28 truncate text-sm font-medium text-foreground sm:inline">
                {label.split(" ")[0] || "Profile"}
              </span>
              <UserIcon className="hidden h-3.5 w-3.5 text-muted-foreground sm:inline" />
            </Link>
            <button
              onClick={() => {
                signOut();
                navigate({ to: "/login", replace: true });
              }}
              title="Sign out"
              aria-label="Sign out"
              className="inline-flex items-center gap-1.5 rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
