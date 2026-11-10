-- Optional priority on an attention item: 'high' | 'medium' | 'low' (or null).
alter table public.attention_items
  add column if not exists priority text;
