"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/account/AuthCard";
import { Button } from "@/components/ui/Button";
import { sendPasswordReset } from "../actions";
import { inputClass } from "@/lib/ui";

function ForgotPasswordForm() {
  // Carried over from a deep link via the sign-in page, so the reset flow can
  // send the customer on to where they originally meant to go (LOW-16).
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    setPending("");
    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }
    setLoading(true);
    const result = await sendPasswordReset(email, next ?? undefined);
    setLoading(false);
    if (result.error) setError(result.error);
    else setPending(result.pending ?? "Check your inbox.");
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter your email and we’ll send you a link to set a new one."
    >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="mt-6 flex flex-col gap-4"
        >
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-semibold">
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

          {error && (
            <p role="alert" className="text-sm text-rose-deep">
              {error}
            </p>
          )}
          {pending && (
            <p
              role="status"
              aria-live="polite"
              className="rounded-xl bg-blush-soft/60 px-3 py-2 text-sm text-rose-deep"
            >
              {pending}
            </p>
          )}

          <Button type="submit" size="lg" disabled={loading} className="w-full">
            {loading ? "Sending…" : "Send reset link"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Remembered it?{" "}
          <Link href="/account/sign-in" className="font-semibold text-rose-deep hover:text-rose">
            Back to sign in
          </Link>
        </p>
    </AuthCard>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
