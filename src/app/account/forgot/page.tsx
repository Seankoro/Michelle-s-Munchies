"use client";

import { useState } from "react";
import Link from "next/link";
import { RibbonBow } from "@/components/ui/RibbonBow";
import { Button } from "@/components/ui/Button";
import { sendPasswordReset } from "../actions";
import { inputClass } from "@/lib/ui";

export default function ForgotPasswordPage() {
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
    const result = await sendPasswordReset(email);
    setLoading(false);
    if (result.error) setError(result.error);
    else setPending(result.pending ?? "Check your inbox.");
  }

  return (
    <main className="mx-auto flex max-w-md flex-col px-6 py-16">
      <div className="rounded-2xl border border-line bg-white p-8 shadow-soft">
        <div className="flex flex-col items-center text-center">
          <RibbonBow withTails={false} className="h-10 w-12" />
          <h1 className="mt-3 font-display text-2xl font-semibold">Reset your password</h1>
          <p className="mt-1 text-sm text-muted">
            Enter your email and we&rsquo;ll send you a link to set a new one.
          </p>
        </div>

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

          {error && <p className="text-sm text-rose-deep">{error}</p>}
          {pending && (
            <p className="rounded-xl bg-blush-soft/60 px-3 py-2 text-sm text-rose-deep">{pending}</p>
          )}

          <Button type="submit" size="lg" disabled={loading} className="w-full">
            {loading ? "Sending…" : "Send reset link"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Remembered it?{" "}
          <Link href="/account/sign-in" className="font-semibold text-rose hover:text-rose-deep">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
