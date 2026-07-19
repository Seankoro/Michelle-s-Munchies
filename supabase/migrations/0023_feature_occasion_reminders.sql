-- Owner switch for the occasion-reminder emails, on by default like the others.
alter table settings
  add column if not exists feature_occasion_reminders boolean default true;
