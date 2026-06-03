"use client";

import { useState } from "react";
import Link from "next/link";
import { RibbonBow } from "@/components/ui/RibbonBow";
import { Button } from "@/components/ui/Button";
import { updatePassword } from "../actions";
import { inputClass } from "@/lib/ui";

export default function ResetPasswordPage() {
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
    window.location.assign("/account");
  }

  return (
    <main className="mx-auto flex max-w-md flex-col px-6 py-16">
      <div className="rounded-2xl border border-line bg-white p-8 shadow-soft">
        <div className="flex flex-col items-center text-center">
          <RibbonBow withTails={false} className="h-10 w-12" />
          <h1 className="mt-3 font-display text-2xl font-semibold">Set a new password</h1>
          <p className="mt-1 text-sm text-muted">Choose a new password for your account.</p>
        </div>

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

          {error && <p className="text-sm text-rose-deep">{error}</p>}

          <Button type="submit" size="lg" disabled={loading} className="w-full">
            {loading ? "Saving…" : "Save new password"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Link expired?{" "}
          <Link href="/account/forgot" className="font-semibold text-rose hover:text-rose-deep">
            Request a new one
          </Link>
        </p>
      </div>
    </main>
  );
}
