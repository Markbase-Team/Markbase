-- Per-save semantic change magnitude: words added / removed, computed by
-- word-diffing the markdown before vs after each save. Stored so history reads
-- as "+N -M words" instead of a keystroke tally.
alter table docs.steps
  add column if not exists added   integer not null default 0,
  add column if not exists removed integer not null default 0;
