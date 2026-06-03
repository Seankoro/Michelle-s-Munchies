-- Storefront enhancements: new dietary tags.
-- Enum ADD VALUE must live in its own migration (cannot be used in the same
-- transaction it is added in), so this is separate from 0011.

alter type dietary_tag add value if not exists 'vegan';
alter type dietary_tag add value if not exists 'dairy_free';
alter type dietary_tag add value if not exists 'gluten_free';
