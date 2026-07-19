-- Saved occasions (birthdays, anniversaries) a signed-in customer wants a
-- reminder for, so they reorder in time. Recurs each year by month + day.
create table if not exists occasions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  month smallint not null check (month between 1 and 12),
  day smallint not null check (day between 1 and 31),
  remind_days_before smallint not null default 7 check (remind_days_before between 0 and 60),
  -- The date we last emailed a reminder, so the hourly cron never doubles up.
  last_reminded_on date,
  created_at timestamptz not null default now()
);

create index if not exists occasions_user_idx on occasions(user_id);

alter table occasions enable row level security;

-- A customer manages only their own occasions. The cron reads with the service
-- role, which bypasses RLS, so no separate read policy is needed for it.
create policy "occasions_select_own" on occasions
  for select using (auth.uid() = user_id);
create policy "occasions_insert_own" on occasions
  for insert with check (auth.uid() = user_id);
create policy "occasions_update_own" on occasions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "occasions_delete_own" on occasions
  for delete using (auth.uid() = user_id);
