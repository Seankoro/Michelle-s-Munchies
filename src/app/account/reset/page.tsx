"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/account/AuthCard";
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
