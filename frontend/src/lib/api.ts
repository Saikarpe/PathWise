import { toast } from "sonner";

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) || "http://127.0.0.1:8000";

// A free-tier backend (Render, notably) spins down after ~15 minutes idle and
// takes up to a couple of minutes to wake back up on the next request. Without
// this, that first request just sits there — a learner watching a spinner with
// no explanation reasonably concludes the app is broken and leaves. One toast,
// de-duplicated across concurrent requests, is enough to make a slow-but-alive
// backend read as "starting up" instead of "down".
const SLOW_REQUEST_MS = 4000;
let slowToastActive = false;

function warnIfSlow(): () => void {
  const timer = setTimeout(() => {
    if (slowToastActive) return;
    slowToastActive = true;
    toast.message("Waking up the server…", {
      description: "The backend was asleep after a period of inactivity — this can take up to a couple of minutes on the first request. It won't need this again for a while.",
      duration: 15000,
    });
  }, SLOW_REQUEST_MS);
  return () => {
    clearTimeout(timer);
    slowToastActive = false;
  };
}

const TOKEN_KEY = "pf_token";
const USER_KEY = "pf_user";

export type User = {
  id?: string | number;
  email?: string;
  name?: string | null;
  onboarded?: boolean;
  [k: string]: unknown;
};

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function getStoredUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setStoredUser(user: User | null) {
  if (typeof window === "undefined") return;
  if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  else window.localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function clearSession() {
  setToken(null);
  setStoredUser(null);
}

type Options = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  auth?: boolean;
};

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, query, auth = true } = opts;

  let url = `${API_BASE_URL}${path}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += (url.includes("?") ? "&" : "?") + s;
  }

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);

  let res: Response;
  const cancelSlowWarning = warnIfSlow();
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(
      0,
      "Couldn't complete that request. If the server just went from idle to active, wait a moment and try again — otherwise it may genuinely be unreachable.",
    );
  } finally {
    cancelSlowWarning();
  }

  if (res.status === 401) {
    clearSession();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    throw new ApiError(401, "Your session expired. Please sign in again.");
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const detail =
      (data && typeof data === "object" && "detail" in (data as Record<string, unknown>)
        ? String((data as Record<string, unknown>).detail)
        : null) ?? (typeof data === "string" && data ? data : `Request failed (${res.status})`);
    throw new ApiError(res.status, detail);
  }

  return data as T;
}

export const pct = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(digits)}%`;

export const num = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toFixed(digits);
