-- Per-board ordering so cards can be reordered (dnd-kit). Idempotent.
alter table public.attention_items
  add column if not exists position integer not null default 0;

create index if not exists attention_items_board_position_idx
  on public.attention_items (board_id, position);
