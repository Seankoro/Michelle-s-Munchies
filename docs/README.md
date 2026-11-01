# Settled decisions

These are deliberate. A review that raises one of them has got it wrong.

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
