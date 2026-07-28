"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/account/AuthCard";
import { Button } from "@/components/ui/Button";
import { GoogleButton } from "@/components/account/GoogleButton";
import { signInWithPassword, sendMagicLink } from "../actions";
import { inputClass } from "@/lib/ui";

// A relative path resolved against this fixed dummy origin keeps that same
// origin; anything absolute (a scheme, or a "//host" trick) resolves to a
// different one. That's enough to close the open-redirect hole in `next`
// without needing the real page origin, so it also works during the server
// render that hydrates this page.
const DUMMY_ORIGIN = "http://n";

function safeNextPath(raw: string | null): string {
  if (!raw) return "/account";
  try {
    const resolved = new URL(raw, DUMMY_ORIGIN);
    if (resolved.origin === DUMMY_ORIGIN) {
      const path = resolved.pathname + resolved.search + resolved.hash;
      // A safe local target is a single-slash absolute path. Reject "//" and
      // "/\\", which window.location.assign would treat as an off-site URL.
      if (path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\")) {
        return path;
      }
    }
  } catch {
    // Malformed `next`, fall back to the safe default.
  }
  return "/account";
}

function SignInForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const showCallbackError = searchParams.get("error") === "auth";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [loading, setLoading] = useState(false);

  async function handlePassword() {
    setError("");
    setPending("");
    setLoading(true);
    const result = await signInWithPassword(email, password);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    // Full reload so the session cookie is picked up everywhere, including the header.
    window.location.assign(safeNextPath(next));
  }

  async function handleMagicLink() {
    if (!email) {
      setError("Enter your email first.");
      return;
    }
    setError("");
    setPending("");
    setLoading(true);
    const result = await sendMagicLink(email, next ?? undefined);
    setLoading(false);
    if (result.error) setError(result.error);
    else setPending(result.pending ?? "Check your email.");
  }

  const forgotHref = next ? `/account/forgot?next=${encodeURIComponent(next)}` : "/account/forgot";

  return (
    <AuthCard title="Welcome back" subtitle="Sign in to track orders & earn rewards.">
        {showCallbackError && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-blush-soft/60 px-3 py-2 text-center text-sm text-rose-deep"
          >
            That link didn’t work or has expired. Please sign in again.
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handlePassword();
          }}
          className="mt-6 flex flex-col gap-4"
        >
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-semibold">Email</label>
            <input
              id="email"
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-semibold">Password</label>
            <input
              id="password"
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <div className="mt-1 text-right">
              <Link
                href={forgotHref}
                className="text-sm font-semibold text-rose-deep hover:text-rose"
              >
                Forgot password?
              </Link>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-rose-deep">
              {error}
            </p>
          )}
          {pending && (
            <p role="status" aria-live="polite" className="text-sm text-rose-deep">
              {pending}
            </p>
          )}

          <Button type="submit" size="lg" disabled={loading} className="w-full">
            {loading ? "Please wait…" : "Sign in"}
          </Button>
        </form>

        <div className="mt-4 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {error && (
            <p className="text-center text-xs text-muted">
              Signed up with Google? Use the Continue with Google button below.
            </p>
          )}
          <GoogleButton />
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={handleMagicLink}
            disabled={loading}
            className="w-full text-sm"
          >
            Email me a magic link
          </Button>
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          New here?{" "}
          <Link href="/account/sign-up" className="font-semibold text-rose-deep hover:text-rose">
            Create an account
          </Link>
        </p>
    </AuthCard>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
