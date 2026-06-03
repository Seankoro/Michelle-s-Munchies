"use client";

import { useState } from "react";
import Link from "next/link";
import { RibbonBow } from "@/components/ui/RibbonBow";
import { Button } from "@/components/ui/Button";
import { GoogleButton } from "@/components/account/GoogleButton";
import { signInWithPassword, sendMagicLink } from "../actions";
import { inputClass } from "@/lib/ui";

export default function SignInPage() {
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
    // Full reload so the session cookie is picked up everywhere (header, etc.).
    window.location.assign("/account");
  }

  async function handleMagicLink() {
    if (!email) {
      setError("Enter your email first.");
      return;
    }
    setError("");
    setPending("");
    setLoading(true);
    const result = await sendMagicLink(email);
    setLoading(false);
    if (result.error) setError(result.error);
    else setPending(result.pending ?? "Check your email.");
  }

  return (
    <main className="mx-auto flex max-w-md flex-col px-6 py-16">
      <div className="rounded-2xl border border-line bg-white p-8 shadow-soft">
        <div className="flex flex-col items-center text-center">
          <RibbonBow withTails={false} className="h-10 w-12" />
          <h1 className="mt-3 font-display text-2xl font-semibold">Welcome back</h1>
          <p className="mt-1 text-sm text-muted">Sign in to track orders & earn rewards.</p>
        </div>

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
                href="/account/forgot"
                className="text-sm font-semibold text-rose hover:text-rose-deep"
              >
                Forgot password?
              </Link>
            </div>
          </div>

          {error && <p className="text-sm text-rose-deep">{error}</p>}
          {pending && <p className="text-sm text-sky-deep">{pending}</p>}

          <Button type="submit" size="lg" disabled={loading} className="w-full">
            {loading ? "Please wait…" : "Sign in"}
          </Button>
        </form>

        <div className="mt-4 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <p className="text-center text-xs text-muted">
            Signed up with Google? Use the Continue with Google button below.
          </p>
          <GoogleButton />
          <button
            type="button"
            onClick={handleMagicLink}
            disabled={loading}
            className="w-full rounded-full border border-line bg-white px-6 py-2.5 text-sm font-semibold text-ink transition hover:border-rose disabled:opacity-60"
          >
            Email me a magic link
          </button>
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          New here?{" "}
          <Link href="/account/sign-up" className="font-semibold text-rose hover:text-rose-deep">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
