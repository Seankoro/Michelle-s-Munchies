"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RibbonBow } from "@/components/ui/RibbonBow";
import { Button } from "@/components/ui/Button";
import { findGuestOrder } from "./actions";
import { inputClass } from "@/lib/ui";

export default function TrackLookupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    setLoading(true);
    const result = await findGuestOrder(email, orderNumber);
    if (!result.ok) {
      setLoading(false);
      setError(result.error);
      return;
    }
    router.push(`/track/${result.token}`);
  }

  return (
    <main className="mx-auto flex max-w-md flex-col px-6 py-16">
      <div className="rounded-2xl border border-line bg-white p-8 shadow-soft">
        <div className="flex flex-col items-center text-center">
          <RibbonBow withTails={false} className="h-10 w-12" />
          <h1 className="mt-3 font-display text-2xl font-semibold">Track your order</h1>
          <p className="mt-1 text-sm text-muted">
            Enter your email and order number to pull it up.
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
          <div>
            <label htmlFor="orderNumber" className="mb-1 block text-sm font-semibold">
              Order number
            </label>
            <input
              id="orderNumber"
              className={inputClass}
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="MM-260602-XXXX"
            />
            <p className="mt-1 text-xs text-muted">It&rsquo;s in your confirmation email.</p>
          </div>

          {error && <p className="text-sm text-rose-deep">{error}</p>}

          <Button type="submit" size="lg" disabled={loading} className="w-full">
            {loading ? "Finding…" : "Find my order"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Have an account?{" "}
          <Link href="/account" className="font-semibold text-rose hover:text-rose-deep">
            See all your orders
          </Link>
        </p>
      </div>
    </main>
  );
}
