-- Seed the entry-point skill: "personal-skill-library". It teaches an agent how
-- to call the /api/v1 endpoints to list and install skills, and to push back
-- learnings, glossary terms, and new skills. The user hands Claude this one
-- skill — it can then pull all the others and record what it learns.
-- Idempotent: only inserts when a skill of that name doesn't already exist.

insert into public.skills (name, description, body)
select
  'personal-skill-library',
  $desc$Sync with your personal skill library API — list and install reusable Claude Code skills, and push back what you learn: record learnings, add glossary terms, or publish new skills. Use when you need a skill you don't have yet, want to browse/install from the library, or want to save a learning, term, or skill.$desc$,
  $skillmd$# Personal skill library

Sync with the user's personal skill library API: pull reusable Claude Code skills and install them locally, and push back what you learn — new skills, learnings (dated notes), and glossary terms.

## Setup (once)
Set two environment variables:

- `MARKBASE_API_BASE` — the library's API base URL, e.g. `https://skills.markbase.so/api/v1`
- `MARKBASE_API_KEY` — an API key from the library's **API Keys** page

Every request sends the header `Authorization: Bearer $MARKBASE_API_KEY`.

## List available skills
```bash
curl -s -H "Authorization: Bearer ${MARKBASE_API_KEY:?set MARKBASE_API_KEY}" \
  "${MARKBASE_API_BASE:?set MARKBASE_API_BASE}/skills"
```
Returns `{ "skills": [ { "name", "description", "raw_url" }, ... ] }`.

## Install one skill
```bash
name=<name>
mkdir -p ~/.claude/skills/"$name"
curl -s -H "Authorization: Bearer $MARKBASE_API_KEY" \
  "$MARKBASE_API_BASE/skills/$name?format=raw" \
  -o ~/.claude/skills/"$name"/SKILL.md
```
Use `.claude/skills/<name>/` to scope it to the current project. It's now `/`-callable.

## Install everything
```bash
for name in $(curl -s -H "Authorization: Bearer $MARKBASE_API_KEY" "$MARKBASE_API_BASE/skills" | jq -r '.skills[].name'); do
  mkdir -p ~/.claude/skills/"$name"
  curl -s -H "Authorization: Bearer $MARKBASE_API_KEY" \
    "$MARKBASE_API_BASE/skills/$name?format=raw" -o ~/.claude/skills/"$name"/SKILL.md
  echo "installed $name"
done
```

## Check for updates
Installed skills carry a `version:` in their SKILL.md frontmatter; compare it to the library to see what changed.
```bash
curl -s -H "Authorization: Bearer $MARKBASE_API_KEY" "$MARKBASE_API_BASE/skills" \
  | jq -r '.skills[] | "\(.name) \(.version)"' \
  | while read -r name ver; do
      f=~/.claude/skills/"$name"/SKILL.md
      have=$(grep -m1 '^version:' "$f" 2>/dev/null | awk '{print $2}')
      if [ ! -f "$f" ]; then echo "$name: not installed (v$ver available)";
      elif [ -z "$have" ] || [ "$have" -lt "$ver" ]; then echo "$name: OUTDATED (local ${have:-none} < library v$ver)";
      else echo "$name: up to date (v$have)"; fi
    done
```
To update, just re-install the skill (overwrites with the latest version) — see "Install one skill" above.

## Record a learning
Save a dated note in markdown. `title` and `entry_date` (YYYY-MM-DD) are optional; the date defaults to today.
```bash
curl -s -X POST -H "Authorization: Bearer $MARKBASE_API_KEY" -H "content-type: application/json" \
  -d '{"title":"What I learned","content":"# notes in markdown"}' \
  "$MARKBASE_API_BASE/learnings"
```

## Add a glossary term
Define a term. Omit `definition` and the API generates one for you.
```bash
curl -s -X POST -H "Authorization: Bearer $MARKBASE_API_KEY" -H "content-type: application/json" \
  -d '{"term":"idempotency","definition":"optional — generated if omitted"}' \
  "$MARKBASE_API_BASE/terms"
```

## Publish a skill
Share a reusable skill so it can be installed later. `name` is kebab-case; `body` is the SKILL.md markdown.
```bash
curl -s -X POST -H "Authorization: Bearer $MARKBASE_API_KEY" -H "content-type: application/json" \
  -d '{"name":"my-skill","description":"one line: what it does + when to use it","body":"# How this skill works…"}' \
  "$MARKBASE_API_BASE/skills"
```

## Browse existing entries (optional)
```bash
curl -s -H "Authorization: Bearer $MARKBASE_API_KEY" "$MARKBASE_API_BASE/terms"
curl -s -H "Authorization: Bearer $MARKBASE_API_KEY" "$MARKBASE_API_BASE/learnings"
```

## Handling API keys safely
A skill never contains a secret — it references an environment variable by name, and you set that once.

- One variable per provider: `MARKBASE_API_KEY` for this library, `OPENAI_API_KEY` for OpenAI, etc. Skills from the same library share one.
- Set it once in `~/.zshenv` (loaded by *every* shell, including non-interactive ones), then `chmod 600 ~/.zshenv`, and never commit it. `~/.zshrc` is interactive-only — don't put keys there. For stronger at-rest safety use the macOS Keychain (`security add-generic-password …` / `security find-generic-password -s <name> -w`).
- Read the key as `${MARKBASE_API_KEY:?set MARKBASE_API_KEY}` so a missing key fails loudly instead of silently using the wrong one.
- Installing a skill that needs a new provider's key = add one line to `~/.zshenv`. Never paste a key into a SKILL.md or commit it.
- Keys are scoped (read/write) and revocable on the API Keys page. If a key leaks, rotate it: revoke the old one, mint a new one, update `~/.zshenv`.

## Troubleshooting
- `401` — the key is missing or invalid.
- `403` — the key lacks the required scope (`read` to list/fetch, `write` to create).
- `GET $MARKBASE_API_BASE` (no key) returns the full API manifest.
$skillmd$
where not exists (
  select 1 from public.skills where lower(name) = 'personal-skill-library'
);
