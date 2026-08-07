# Audit history

Each file is a point-in-time record. Findings in them were true when written and
most have since been fixed, so read the newest one first and check the code
before acting on anything older.

| Date | File | What it covers |
| --- | --- | --- |
| 7 Aug 2026 | [audit-results-2026-08-07.md](audit-results-2026-08-07.md) | **Current.** Polish and correctness across 15 lenses. Every finding verified against the code, and the ones checked and dismissed are listed too, so they do not get raised again. |
| 31 Jul 2026 | [security-audit-2026-07-31.md](security-audit-2026-07-31.md) | Authorisation, injection, secrets, SSRF, IDOR, rate limits, server action exposure. |
| 31 Jul 2026 | [logic-gap-leads-2026-07-31.md](logic-gap-leads-2026-07-31.md) | Leads raised by the unfinished logic audit. |
| 30 Jul 2026 | [logic-gap-audit-2026-07-30.md](logic-gap-audit-2026-07-30.md) | Order lifecycle, money, and state transitions. |
| 29 Jul 2026 | [site-audit-2026-07-29.md](site-audit-2026-07-29.md) | Second full pass over the site. |
| 21 Jul 2026 | [site-audit-2026-07-21.md](site-audit-2026-07-21.md) | First full pass. |

## Decisions that are settled

These are deliberate. An audit that raises one of them has got it wrong.

- **No deposits.** Removed entirely on 6 Aug 2026, code and columns both.
- **A refund counts against the month the order was paid**, not the month the
  money went back.
- **Paid before baking means paid in full.** There is no part-payment.
- **Stock is not reserved at order time.** Michelle handles overselling.
- **The gift link answers the delivery address once and then closes.** The
  owner's own address control is how a mistake gets corrected afterwards.
- **The packing slip never prints the owner's private note**, because the slip
  goes in the box with the customer.
- **The product rails do not scroll-snap.** Measured on the live site: with
  either `mandatory` or `proximity`, a programmatic `scrollLeft` of 137 landed
  at 24, which breaks the grab-pan and the bow slider.
