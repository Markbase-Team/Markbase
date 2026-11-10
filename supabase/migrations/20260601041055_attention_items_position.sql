-- Per-board ordering for attention items so cards can be reordered (dnd-kit).
-- New items default to position 0 (top); listItems sorts by position then
-- created_at, so existing rows keep their current order until reordered.
alter table public.attention_items
  add column if not exists position integer not null default 0;

create index if not exists attention_items_board_position_idx
  on public.attention_items (board_id, position);
