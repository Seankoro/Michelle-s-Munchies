-- Ingredients move from a plain text[] of names to a jsonb list of
-- { name, amount, unit } so the shopping list can total real quantities to buy.
-- Existing names convert to objects with no amount, so nothing is lost and the
-- customer-facing list (names only) is unchanged.
alter table products alter column ingredients drop default;

alter table products
  alter column ingredients type jsonb
  using coalesce(to_jsonb(ingredients), '[]'::jsonb);

update products
set ingredients = coalesce(
  (select jsonb_agg(jsonb_build_object('name', elem))
   from jsonb_array_elements_text(ingredients) as elem),
  '[]'::jsonb
);

alter table products alter column ingredients set default '[]'::jsonb;
