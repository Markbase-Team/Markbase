-- Optional priority on an attention item: 'high' | 'medium' | 'low' (or null).
-- Set when approving a needs_approval card, or changed later on a filed card.
alter table public.attention_items
  add column if not exists priority text;
