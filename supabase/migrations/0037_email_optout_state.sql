-- 0036 gave email_opt_outs an email and a token, but no way to tell the two
-- states apart. A token has to exist BEFORE someone opts out, because it is what
-- the unsubscribe link in the footer is built from, so the presence of a row
-- cannot mean "opted out" on its own.
--
-- opted_out_at splits them: a row with a null opted_out_at is just an address
-- that has been sent a marketing email and therefore needed a link, and a row
-- with a timestamp is someone who asked to stop. Only the second suppresses.
alter table public.email_opt_outs add column if not exists opted_out_at timestamptz;

-- Any row created before this column existed was minted by an opt-out click,
-- since nothing else wrote to the table yet, so treat those as opted out rather
-- than silently resubscribing anyone.
update public.email_opt_outs set opted_out_at = created_at where opted_out_at is null;

-- The suppression check filters on this column on every cron run.
create index if not exists email_opt_outs_opted_out_idx
  on public.email_opt_outs (email)
  where opted_out_at is not null;
