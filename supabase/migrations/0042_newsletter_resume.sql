-- Let an interrupted newsletter send pick up where it stopped.
--
-- The send loops over every confirmed subscriber and mails them one at a time.
-- Nothing was written down as it went, so a run that died partway, a timeout, a
-- deploy, a closed laptop, left no record of who had already received it. The
-- only way to finish was to send again, which mailed everyone at the start of
-- the list a second time. The screen also told Michelle to check what had been
-- sent, and there was nothing to check.
--
-- Stamping each subscriber as their mail goes lets the next run skip anyone who
-- already has this same subject, so finishing a broken send is safe.

alter table public.newsletter_subscribers
  add column if not exists last_newsletter_at timestamptz,
  add column if not exists last_newsletter_subject text;

-- The send reads this pair back for every subscriber before mailing, so give it
-- an index rather than a scan of the whole list per run.
create index if not exists newsletter_subscribers_last_send_idx
  on public.newsletter_subscribers (last_newsletter_subject, last_newsletter_at);

-- Both columns are written only by the service role inside the send action, and
-- read only there. No storefront role needs either, so no grants are added. The
-- column-level grants from migration 0035 stay as they are.
