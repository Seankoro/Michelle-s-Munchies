-- "Michelle says" mascot speech bubble on the home hero.
-- Nullable text the owner edits in Admin -> Settings. Null or empty means the
-- storefront falls back to a built-in line.
alter table settings add column if not exists mascot_message text;
