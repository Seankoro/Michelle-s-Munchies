"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/account/AuthCard";
import { Button } from "@/components/ui/Button";
import { updatePassword } from "../actions";
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

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don’t match.");
      return;
    }
    setLoading(true);
    const result = await updatePassword(password);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    // Full reload so the header reflects the signed-in session.
    window.location.assign(safeNextPath(next));
  }

  return (
    <AuthCard title="Set a new password" subtitle="Choose a new password for your account.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="mt-6 flex flex-col gap-4"
        >
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-semibold">
              New password
            </label>
            <input
              id="password"
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label htmlFor="confirm" className="mb-1 block text-sm font-semibold">
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              className={inputClass}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-rose-deep">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" disabled={loading} className="w-full">
            {loading ? "Saving…" : "Save new password"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Link expired?{" "}
          <Link href="/account/forgot" className="font-semibold text-rose-deep hover:text-rose">
            Request a new one
          </Link>
        </p>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
