-- Private "note to self" Michelle can jot on any order in Admin -> Orders.
-- Nullable text, never shown to the customer, for reminders like "double-bag,
-- allergy" or "regular, prefers less sweet".
alter table orders add column if not exists owner_note text;
