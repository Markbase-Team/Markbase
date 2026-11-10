-- Attention boards: a kanban of "things that need your attention", fed by
-- dragging emails from the Inbox onto the Attention sidebar region.
--
-- Each board is one category (events, finance, chores, …) with matching rules:
--   structured  → sender_domains + keywords (checked first, in code)
--   fallback    → rules (free text, handed to a cheap model when structured
--                 rules don't produce a confident match)
--
-- Items are emails filed onto a board. status='needs_approval' means the
-- classifier wasn't confident and the user must confirm the board.
--
-- RLS is ENABLED with NO policies → the publishable/anon key cannot touch these
-- tables; only the service-role key (which bypasses RLS) can, same as
-- email_accounts. The Attention API runs server-side with the service-role key.

create table if not exists public.attention_boards (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  color          text not null default '#e5ff6e',
  sender_domains text[] not null default '{}',
  keywords       text[] not null default '{}',
  rules          text not null default '',
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.attention_items (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.attention_boards(id) on delete cascade,
  account_id  uuid,
  message_id  text not null,
  thread_id   text,
  from_addr   text not null default '',
  subject     text not null default '',
  snippet     text not null default '',
  summary     text not null default '',
  email_date  text not null default '',
  -- 'filed' = confidently matched; 'needs_approval' = best guess, awaiting OK.
  status      text not null default 'filed',
  created_at  timestamptz not null default now()
);

create index if not exists attention_items_board_id_idx
  on public.attention_items (board_id);

-- One row per email per board (re-dropping the same email just updates it).
create unique index if not exists attention_items_board_message_uniq
  on public.attention_items (board_id, message_id);

alter table public.attention_boards enable row level security;
alter table public.attention_items enable row level security;
-- Intentionally no policies: deny all access except service-role.

-- Seed the starter boards from the examples. position orders the columns L→R.
insert into public.attention_boards (name, color, sender_domains, keywords, rules, position)
values
  ('Events',  '#a78bfa',
   array['lu.ma','luma.com','eventbrite.com','eventbrite.co'],
   array['event','rsvp','invite','invitation','ticket','webinar','meetup'],
   'Event invitations and RSVPs, e.g. from Luma or Eventbrite.', 0),
  ('CBA',     '#60a5fa',
   array['anthropic.com'],
   array['cba','claude builder','builder club'],
   'CBA (Claude Builder Ambassador) related messages.', 1),
  ('Finance', '#34d399',
   array['chase.com','paypal.com','apple.com','mail.apple.com'],
   array['statement','payment','receipt','invoice','transaction','balance','autopay','apple card'],
   'Finance & money: statements and receipts from Apple Card, Chase, or PayPal.', 2),
  ('Chores',  '#fbbf24',
   array['primobrands.com'],
   array['chore','household','delivery','order','primo'],
   'Household chores and errands, e.g. from Primo Brands.', 3)
on conflict do nothing;
