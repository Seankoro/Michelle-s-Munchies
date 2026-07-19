-- Ingredient/packaging cost per treat, so Insights can show margin, not just
-- revenue. Nullable, in integer cents like every other money column. Null means
-- "cost not entered yet" and the treat is simply left out of margin figures.
alter table products add column if not exists cost_cents integer;
