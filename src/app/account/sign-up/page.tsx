"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/account/AuthCard";
import { Button } from "@/components/ui/Button";
import { GoogleButton } from "@/components/account/GoogleButton";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { Toggle } from "@/components/ui/Toggle";
import { signUpWithPassword } from "../actions";
import { subscribeNewsletterAction } from "@/lib/newsletter-actions";
import { inputClass } from "@/lib/ui";

export default function SignUpPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [referral, setReferral] = useState("");
  const [joinNewsletter, setJoinNewsletter] = useState(true);
  const features = useFeatures();
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [loading, setLoading] = useState(false);

  // Prefill the referral code from a ?ref=CODE share link.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) setReferral(ref.toUpperCase());
  }, []);

  async function handleSubmit() {
    setError("");
    setPending("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    const result = await signUpWithPassword(email, password, fullName, referral);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    // Newsletter opt-in, best-effort and never blocks navigation.
    if (joinNewsletter && features.newsletter) {
      void subscribeNewsletterAction(email.trim());
    }
    if (result.pending) {
      setPending(result.pending);
      return;
    }
    window.location.assign("/account");
  }

  return (
    <AuthCard
      title="Join Michelle’s Munchies"
      subtitle="Create an account to track orders & earn rewards."
    >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="mt-6 flex flex-col gap-4"
        >
          <div>
            <label htmlFor="fullName" className="mb-1 block text-sm font-semibold">Name</label>
            <input
              id="fullName"
              className={inputClass}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
            />
          </div>
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
              autoComplete="new-password"
            />
          </div>
          {features.referrals && (
            <div>
              <label htmlFor="referral" className="mb-1 block text-sm font-semibold">
                Referral code <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="referral"
                className={`${inputClass} uppercase`}
                value={referral}
                onChange={(e) => setReferral(e.target.value.toUpperCase())}
                placeholder="From a friend?"
              />
            </div>
          )}

          {features.newsletter && (
            <div className="flex items-start gap-2 text-sm">
              <Toggle
                checked={joinNewsletter}
                onChange={setJoinNewsletter}
                label="Email me occasional updates"
                className="mt-0.5"
              />
              <span>Email me occasional updates and new treats. Unsubscribe any time.</span>
            </div>
          )}

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
            {loading ? "Creating…" : "Create account"}
          </Button>
        </form>

        <div className="mt-4 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
        </div>

        <div className="mt-4">
          <GoogleButton label="Sign up with Google" />
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/account/sign-in" className="font-semibold text-rose-deep hover:text-rose">
            Sign in
          </Link>
        </p>
    </AuthCard>
  );
}
