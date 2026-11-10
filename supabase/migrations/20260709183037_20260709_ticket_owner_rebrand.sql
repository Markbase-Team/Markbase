-- The jessie->markbase rebrand renamed the code's default ticket owner to
-- "markbase" (TICKET_OWNERS = ["markbase", "claude_code"]), but the DB enum
-- still held the old "jessie" label — so every ticket insert failed with
-- `invalid input value for enum ticket_owner: "markbase"`. Rename the value in
-- place: existing rows keep working (they now read as "markbase") and new
-- inserts succeed.
do $$
begin
  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'ticket_owner' and e.enumlabel = 'jessie'
  ) then
    alter type ticket_owner rename value 'jessie' to 'markbase';
  end if;
end $$;
