-- Convert a folder into a vault of its own, atomically.
--
-- "Mount" points a folder at a vault that already exists. Converting is a data
-- migration: a new vault is created, the documents under one folder move into it,
-- and their paths are RE-BASED — a path is vault-relative, so the folder that was
-- a prefix becomes the root ("projects/2026/q1.md" → "2026/q1.md"). Leave the
-- prefix in and the new vault nests one level inside its own folder on every
-- device.
--
-- This must not half-happen. A partial convert splits a user's documents across
-- two vaults with paths that match neither, and no device could reconcile that:
-- the old vault's daemon would restore the files it thinks it lost while the new
-- one materializes them somewhere else. A plpgsql function runs in a single
-- transaction, so the vault and every move commit together or not at all.
--
-- The moves are computed by the caller (rebaseToVaultRoot in @ticketing/docs) and
-- passed in, rather than recomputed here in SQL: the path rules are subtle enough
-- to deserve unit tests, and one tested implementation beats two that agree until
-- they don't.
create or replace function docs.convert_folder_to_vault(
  p_owner uuid,
  p_name  text,
  p_moves jsonb  -- [{ "id": "<uuid>", "path": "<new vault-relative path>" }, …]
)
returns docs.vaults
language plpgsql
security invoker
as $$
declare
  v docs.vaults;
begin
  insert into docs.vaults (name, owner_id)
  values (p_name, p_owner)
  returning * into v;

  -- `owner_id = p_owner` is the guard: a caller who passes document ids they
  -- don't own moves nothing, rather than quietly stealing rows into a vault.
  update docs.documents d
     set vault_id   = v.id,
         path       = m.path,
         updated_at = now()
    from jsonb_to_recordset(p_moves) as m(id uuid, path text)
   where d.id = m.id
     and d.owner_id = p_owner;

  return v;
end;
$$;

grant execute on function docs.convert_folder_to_vault(uuid, text, jsonb)
  to anon, authenticated, service_role;
