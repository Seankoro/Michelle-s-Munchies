"use client";

import { useState } from "react";
import { RibbonBow } from "@/components/ui/RibbonBow";
import { Button } from "@/components/ui/Button";
import { adminSignIn } from "@/lib/admin-actions";
import { inputClass } from "@/lib/ui";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    setLoading(true);
    const result = await adminSignIn(email, password);
    if (!result.ok) {
      setLoading(false);
      setError(result.error);
      return;
    }
    // Full reload so middleware picks up the new session cookie.
    window.location.assign("/admin");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-6">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-8 shadow-soft">
        <div className="flex flex-col items-center text-center">
          <RibbonBow withTails={false} className="h-10 w-12" />
          <h1 className="mt-3 font-display text-2xl font-semibold">Munchies Admin</h1>
          <p className="mt-1 text-sm text-muted">Sign in to manage orders &amp; menu.</p>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
          className="mt-6 flex flex-col gap-4"
        >
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-semibold text-ink">
              Email
            </label>
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
            <label htmlFor="password" className="mb-1 block text-sm font-semibold text-ink">
              Password
            </label>
            <input
              id="password"
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {error && <p className="text-sm text-rose-deep">{error}</p>}

          <Button type="submit" size="lg" disabled={loading} className="mt-2 w-full">
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}
