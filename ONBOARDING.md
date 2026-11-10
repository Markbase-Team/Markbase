# Welcome to Markbase 👋

Markbase is **Google Docs for markdown** — and your AI agents can read and write the
same documents you do. Connect it once, then just *chat*: "list my docs", "change
'draft' to 'ready' in the roadmap", "leave a comment asking about the budget."

## Connect — one command 🚀

```bash
npx @markbase/cli mcp install
```

A browser opens — **click approve**. That's it: it wires up **both Claude Desktop
and Claude Code**. Then **restart your app**.

> No key to copy, no config files to edit — the browser sign-in mints your key and
> sets everything up. Only using one app? Add `--desktop` or `--claude-code`.

✅ Done. Ask: *"List my Markbase docs"* or *"In my roadmap doc, change 'Q3' to 'Q4'."*

---

### 💻 On Claude Code, want the editing etiquette too? (optional)

```bash
npx @markbase/cli skill install --global
```

Adds a short skill so Claude makes **minimal, precise edits** (quote-and-replace,
formatting preserved) instead of rewriting whole documents. Then restart Claude Code.

---

## What you can do, just by asking

| Say… | Markbase does… |
| --- | --- |
| "list my docs" | shows what you can access |
| "change X to Y in <doc>" | a precise edit — **bold, links, lists all preserved** |
| "add a section on pricing" | inserts real markdown structure |
| "comment: is this final?" | leaves an anchored comment for a human |
| "what changed recently?" | version history |
| "restore yesterday's version" | rolls back (history kept) |

---

## Safe by design 🔒

Everything runs as **you** — an agent only ever sees docs you own or are shared on,
never anyone else's. Want to hand an agent *less* than full access? Create its key
with a ceiling of **editor**, **commenter**, or **viewer** in the dashboard → API
keys, and it can never do more than that.

---

Need a hand? Open the dashboard, or ping us. Happy writing ✍️
