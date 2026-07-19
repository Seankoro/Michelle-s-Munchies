-- Per-product personalisation. A non-empty label turns it on for that product
-- and prompts the customer for a short message (e.g. a name to pipe on a cake).
-- allow_photo optionally lets them attach one reference photo.
alter table products add column if not exists personalisation_label text;
alter table products add column if not exists personalisation_allow_photo boolean default false;

-- The chosen message and photo travel with each order line as { message, photoUrl }.
alter table order_items add column if not exists personalisation jsonb;

-- Public bucket for customer reference photos. Reads are public (low-sensitivity
-- reference images); writes go through the service-role client in the upload
-- action, which validates type, size, and that the product allows a photo.
insert into storage.buckets (id, name, public)
values ('personalisation-images', 'personalisation-images', true)
on conflict (id) do nothing;
