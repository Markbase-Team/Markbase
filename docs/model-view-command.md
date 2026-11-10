# Phase 1 · Model, view, command

Status: draft · 2026-09-18 · not started · **sequencing superseded** by
[`core-plugins-and-content.md`](./core-plugins-and-content.md), which sorts the
same pieces into core, plugins and content, and puts the plugin surface last.
The keystone for [`workspace-layout.md`](./workspace-layout.md),
[`surface-contract.md`](./surface-contract.md) and
[`plugin-system-plan.md`](./plugin-system-plan.md).

Yes — it's MVC-shaped. A data shape, something that renders it, something that
changes it. But three corrections separate the version that works here from the
one that collapses, and all three come from the same two facts: **there are two
actors, and the parts are third-party.**

1. **The controller is a vocabulary, not a component.** If a plugin ships
   control logic as code with its own handlers, the agent can't drive it, and
   human and agent end up on different paths that drift. Plugins contribute
   *declared commands* and a pure reducer instead. This is the important one.
2. **There are two models, not one.** The workflow *definition* (what should
   happen) and the *records* it produces (what happened) have different
   owners, different lifecycles and different merge rules. MVC conflates them
   and it hurts here.
3. **View state belongs to neither.** One model has many views, so sort order,
   collapse and canvas position can't live in "the view" — they need their own
   namespace, which is `views.*` in the
   [workflow sketch](./examples/workflow-contract.html).

The closest well-known shape isn't Smalltalk MVC but the message-passing
variant — Elm's model/message/update, or CQRS's split between commands and read
models. The reason is exactly the two actors: **what the human and the agent
share is the message log, not the screen.**

---

## What a plugin contributes

Four things, and the split between *code* and *data* is the whole design.

| | Contribution | Form | Who writes it | What the agent does |
|---|---|---|---|---|
| Model | **Record types** | JSON Schema + identity | plugin, or a workflow inline | fills them |
| View | **Panels** | component, bound to record types | plugin | picks one |
| Controller | **Commands** | declared signature + pure reducer | plugin | dispatches them |
| — | **Triggers** | declared kinds | plugin | names one |

Only panels and reducers are code. Everything the agent has to understand —
record types, command signatures, trigger kinds, which panels bind which
records — is static data, readable without running anything. That is the
plugin plan's "declare before you run" doing the work it was meant for.

### Commands, not handlers

```ts
contributes: {
  commands: [{
    id: "review.dismiss",
    title: "Dismiss finding",
    input: { findingId: "string", reason: "string?" },
    permission: "records:write",
    undoable: true,
  }],
}
```

A plugin also provides `reduce(state, command) -> state`, pure. That's all.

What falls out of making the controller declarative:

- **The agent gets a tool per command, generated**, with a JSON input schema —
  no separate agent API to write, and none to drift.
- **A human's button dispatches the same command.** One path, so nothing can
  be done by one actor and not the other, and nothing can be done by clicking
  that isn't in the log.
- **Undo, replay, audit and permissions are implemented once**, on the
  dispatcher, rather than per plugin.

This is not a new mechanism for this repo; it is `endpoints.ts` pointed at UI
actions. That registry already generates the route, the auth check, the MCP
tool, the CLI command and the SKILL.md section from one declaration, so a
change to it moves every driver together. A command registry is the same trade
applied to what a panel can do, and it is the reason an agent can drive a
third-party panel it has never seen.

The alternative — a panel exposing behaviour as code — leaves the agent
synthesising clicks. That's computer use: slow, brittle, unreviewable, and
impossible to permission properly.

---

## Two actors, one path

**Mechanism is shared; policy is what differs.**

Both a click and an agent decision produce the same command. The difference is
what happens on the way through: a human's dispatch is self-approving, an
agent's runs the plugin plan's existing pipeline — `tools/pre-execute` →
approval → `tools/execute` → `tools/post-execute`. Same command, different
gate. A workflow's frontmatter says which commands it may dispatch unattended,
and that list is reviewable before 8am rather than discovered at 8am.

**Every write carries provenance.** The plan already tags what a run writes
with "by *workflow* · run #n"; extend that to every command — who dispatched
it, under which run. Without it, co-control is confusing rather than useful:
you can't tell what you did from what the 8am run did, and you can't undo one
without the other.

## Three kinds of state, three owners

Conflating these is the bug that makes a co-controlled app feel unreliable.

| State | Example | Owner | On a rerun |
|---|---|---|---|
| **Definition** | the workflow document | both, co-edited | untouched |
| **Records** | this morning's findings | agent produces | replaced |
| **Marks** | dismissed, snoozed, starred, moved | human | **kept** |
| **View** | sort, collapse, canvas position | human | kept |

The rule that makes reruns safe:

> **The agent owns what it can regenerate. The human owns what it can't.**

So human marks are never fields the agent rewrites. They're a separate layer
keyed by record id, joined back after each run. The 8am run replaces the
findings and the finding you dismissed at 8:05 stays dismissed — which is the
difference between a report you trust and one you re-triage every morning.

Records are a **replaceable projection**; marks are durable and point at it. A
record that vanishes from a later run leaves an orphaned mark, which is
information ("this stopped being a problem"), not an error.

---

## Why this makes a workflow easy to write

A workflow is not a fifth contribution. It's a **binding**: trigger → brief →
record type → panel.

```yaml
---
trigger: cron 0 8 * * 1-5
emits:  review.finding[]
panel:  board
tools:  [github]
can:    [review.dismiss, review.snooze]
---
Review the PRs open on my repos. For each one, link it, quote the comments
that actually need an answer, and say what's worth addressing and why.
```

For the agent, authoring that is **four choices from enumerable sets, plus
prose**. Not writing a component, not writing control flow. Generating data
against a declared schema is the thing models are reliable at; generating UI
is where they aren't.

And it's **checkable before it runs**. A workflow naming a panel that can't
bind its record type, or a command it wasn't granted, is rejected at authoring
time. That's what makes agent-written workflows safe to accept — you're
validating a binding, not reviewing code.

### The escape hatch: record types are data too

If nothing fits, the agent defines a record type inline, in the workflow:

```yaml
emits:
  news.item:
    headline: string
    url: string
    source: string
    why_it_matters: string?
```

Still data, still schema-checked, still renderable by any generic panel. A
plugin can later contribute a specialised panel for that shape and the workflow
doesn't change. This is what keeps the agent from being blocked on whether
someone happened to publish the right plugin.

Generic panels — list, board, table, agenda — should bind a base `item`
(title, url, body, when, tags) so *any* record that carries those fields
renders somewhere useful on day one, and specialised panels are an upgrade
rather than a prerequisite.

---

## The morning, worked through

Four workflows, four record types, four panels — and one workspace.

| At | Emits | Panel | Brief |
|---|---|---|---|
| 07:00 | `news.item[]` | list | Overnight headlines from my sources, one item per story |
| 08:00 | `review.finding[]` | board, grouped by severity | PR links, the comments that need an answer, what's worth addressing |
| 09:00 | `followup.item[]` | agenda | Projects that have gone quiet, and who's waiting on what |
| 10:00 | `contact.item[]` | agenda | Customers to talk to today, with the last thing each said |

Each is a document like the one above. None of them is a screen, and none
needed a component written.

The layout doc's point lands here: **the morning isn't four workflows, it's a
workspace with four panels, each fed by a scheduled run.** The workflows put
the panels up; the panels are where you then work, dismissing a finding or
snoozing a follow-up — commands, logged, that the next run respects.

Worth being plain about the shape this reveals: most of what you described is
**scheduled run → structured output → panel**, which is the *simple* case. The
durable multi-step DAG in the plugin plan is the general case. Both are the
same document; the simple one just has a single step. Building the simple case
first is right, and the format shouldn't be designed as though everything is a
pipeline.

---

## Phasing

| # | Step | Why here |
|---|---|---|
| C1 | Command registry: `contributes.commands`, a dispatcher, provenance on every dispatch | Nothing else works without one path |
| C2 | Move today's hardcoded actions onto it — comments, history, doc actions | First-party through the same door; proves the vocabulary |
| C3 | Generated agent tools from command declarations, through the tool pipeline | The agent becomes a peer of the click, with a gate |
| C4 | Record types + the base `item`; generic list / board / table / agenda panels | Somewhere for output to land |
| C5 | Marks as a layer keyed by record id; rerun joins rather than overwrites | Makes a daily run trustworthy |
| C6 | Workflow bindings (`emits`, `panel`, `can`) + authoring-time validation | Agent-written workflows |
| C7 | Inline record types | Removes the plugin prerequisite |

C1 and C2 have no dependency on workflows or the agent. They're worth doing
alone: a command registry is what gives the app a palette, keybindings and an
undo stack, none of which exist today.

## Risks

- **A command vocabulary that's too fine-grained.** One command per button
  produces hundreds and the agent can't choose. Commands should be at the
  altitude of "what a person would ask for", not "what a widget does".
- **Reducers that aren't pure.** The moment one fetches, undo and replay stop
  working, and the failure is silent. This needs to be enforced, not asked for.
- **Schema drift on record types.** A plugin changing `review.finding` breaks
  every workflow that emits it and every panel that binds it. Record types
  need versioning from the start — more than commands do, because workflows
  written by an agent will outnumber the plugins.
- **The agent generating plausible-but-wrong bindings.** Validation catches a
  panel that can't bind a type; it can't catch a brief that produces useless
  findings. The fix is a dry run at authoring time, not more schema.

## Open questions

1. **Are marks per-user or per-workspace?** Dismissing a finding for yourself
   and dismissing it for the team are different acts, and a shared morning
   board needs both.
2. **Can a command be dispatched against a record that no longer exists?**
   Reruns make this routine rather than exceptional, and "fails cleanly" needs
   to mean something specific.
3. **Who owns the base `item` schema?** Core, presumably — but then extending
   it is a core change, which is the kind of bottleneck the plugin system
   exists to avoid.
4. **Does a workflow's `panel` choice bind an instance or a type?** Two
   workflows both emitting `item[]` into "a list" either share one panel or get
   one each, and the answer decides what a workspace of eight workflows looks
   like.
