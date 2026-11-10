# Phase 1 · Core, plugins, and content

Status: draft · 2026-09-18 · not started
Supersedes the workflow contract in
[`plugin-system-plan.md`](./plugin-system-plan.md) and the sequencing in
[`workspace-layout.md`](./workspace-layout.md) and
[`model-view-command.md`](./model-view-command.md).

Two questions decide the product: **how does a company get a workflow running**,
and **where does it see the results**. Everything else is downstream, including
what the plugin system is for.

The answer that makes both easy is a boundary that most plugin systems get
wrong by lumping two things together.

---

## Three tiers, not two

| Tier | Who writes it | What | Code? |
|---|---|---|---|
| **Core** | us | the contracts | — |
| **Plugins** | us, vendors, a company's platform team | triggers, commands, record types, views | yes |
| **Content** | anyone at the company, and the agent | workflows, records, view configs, dashboards | **no** |

**A company is not going to write plugins. It is going to write content.**

The plugin surface exists to connect *systems* — Gmail, GitHub, Linear, a
company's own CRM. Everything a company actually does day to day — the triage
workflow, the review board, the morning dashboard — is content, written by the
agent or by a person, in the app, without a build step.

This is Zapier's split (apps are plugins, zaps are content) and Home
Assistant's (integrations are plugins, automations are content), and it is the
reason both are usable by people who will never open an editor.

It also shrinks the plugin system's promise to something achievable: **not
"build the app", but "connect your systems"**. The target to hold ourselves
to: a company does 90% of what it needs with content alone.

---

## Core

Few, boring, and stable, because everything is written in terms of them. The
test for inclusion is **could there be two of these, or zero?** If yes, it is a
plugin.

1. **Records** — schema, properties, rows, identity. The data primitive.
2. **View binding** — the mechanism by which a view declares which record
   types it renders. Not the view types themselves.
3. **Commands** — the declaration format, the dispatcher, the permission
   check, provenance, undo. One path for a click and for the agent.
4. **Workflow and Run records** — the shapes, and the run status enum. In core
   because the run list, notifications, billing, the agent and any replacement
   engine all read them.
5. **Trigger interface** — what a trigger kind must satisfy: id, cardinality,
   config schema, payload schema, `dedupeKey`.
6. **Execution semantics** — overlap, catch-up, budget ceiling, retry. Declared
   per workflow, enforced by core, so a replacement engine cannot quietly
   change what happens when the worker was off at 8am.
7. **Emit identity** — how a produced record is recognised across runs, and the
   rule that follows: the agent owns what it can regenerate, the human owns
   what it can't. Reruns replace output and re-join human marks.
8. **Permissions and provenance** — every record and command carries the run
   and workflow that produced it.
9. **The surface contract** — what a panel offers the agent, and what commands
   it accepts. See [`surface-contract.md`](./surface-contract.md).

Nine things. Note what is *not* there: the workflow engine, any trigger kind,
any command, any view type, any record type.

**Core ships the base views as first-party plugins** — list, table, board,
calendar — through the same contribution point everyone else uses. They arrive
in the box, so the app works on day one, but they are not privileged. That is
the "first-party goes through the same door" rule doing real work: if the base
views need an escape hatch, the contract is wrong.

## Plugins

Anything with a domain in it:

- **Trigger kinds** — `cron`, `email.received`, `pr.opened`, and
  `record.aged` (the relative-time one: N days after something, anchored to a
  record — sales cadences, onboarding day 1/7/30, renewals). `email.received`
  belongs to the email plugin, never to core and never to the workflow engine.
- **Commands** — `email.draft`, `email.send`, `pr.comment`, `doc.insert`.
- **Record types** — `triage.result`, `review.finding`.
- **Views** — PDF reader, canvas, Gantt, chart, map. But see *Views are
  content* below: most views should not be plugins at all.
- **Integrations** — Gmail, GitHub, Slack, and a company's internal systems.
- **The workflow engine itself**, replaceable, as the plan already says.
- **Importers** — including the runbook importer below.

The dependency rule that keeps this from collapsing: **the engine knows no
trigger kinds.** It composes what is declared. The moment `email.received` is
an enum member anywhere central, every new integration becomes a core change.

## Views are content, because the data layer is out of reach

A view does not need to be code we review and ship. It can be a sandboxed page
we hand data to.

```
host → view:   records (already filtered and permissioned), theme tokens, locus
view → host:   command dispatches, selection and context, resize hints
```

The view gets **data, not access**: no database client, no credentials, no
network (`connect-src 'none'`). Which is the important upgrade on "just ask
authors to leave the data layer alone" —

> **Don't request it; make it impossible.** A sandboxed page with no network
> cannot reach the data layer even if the code tries.

That also makes the surface contract enforceable rather than conventional. A
view that cannot reach the database cannot invent its own mutation path, so
every change really does go through a declared command. It is
[`model-view-command.md`](./model-view-command.md) with a wall around it.

### Two tiers, and most things are the first one

| | Declarative blocks | Sandboxed page |
|---|---|---|
| Shape | a UI spec the host renders natively | an HTML file in an iframe |
| Theme | exact, by construction | drifts; tokens have to be passed in |
| Cost | a component | a whole document |
| Agent generating it | **a constrained schema — reliably** | arbitrary HTML and JS |
| Expressiveness | bounded | anything |
| Prior art | Slack Block Kit, Adaptive Cards | Figma plugins, Claude Artifacts |

**Blocks for roughly nine views in ten.** The agent emits a spec, the host
renders it: fast, coherent, and far more reliable to generate than a page,
because a schema constrains the model where free-form markup does not.

**The sandboxed page as the escape hatch** for what blocks cannot express — a
chart library, a diagram, something genuinely interactive. Opt-in, and visibly
marked as custom so nobody mistakes a generated view for a shipped one.

### Why this matters more than it sounds

**A view stops being a plugin and becomes content.** One file, no build step,
no review, no publish — which means the agent can produce one on request, for
one workflow, and nobody has to maintain it. The "who builds the views?"
problem in [`ecosystem-supply.md`](./ecosystem-supply.md) largely dissolves:
the answer is *the agent, per request*, and the plugin tier shrinks to
triggers, commands and record types.

It also settles the isolation worry from
[`workspace-layout.md`](./workspace-layout.md). Third-party code rendering
into our own DOM is Atom's mistake; a sandbox avoids it without having to keep
the layout constrained forever.

### What it costs

- **A document per panel.** Six sandboxed panels in one workspace is heavy, so
  first-party views stay in-process and only custom ones are sandboxed.
- **Theme drift.** Tokens have to be pushed in, and generated views will still
  look slightly foreign. This is why Figma plugins never quite match Figma.
- **Interaction paper cuts** — drag across the boundary, keyboard shortcuts,
  focus, context menus, scroll chaining. A long tail, and it is what makes
  embedded UI feel wrong when it feels wrong.
- **Volume.** Passing records over a message bridge is fine for hundreds and
  bad for a hundred thousand, so the bridge needs windowing.
- **Provenance in the UI.** A person should be able to see that a view is
  generated, and what data it was handed.

## Content

Written in the app, by a person or the agent, with no build step:

- workflows (a record: trigger, `can`, `emits`, view, brief)
- record type instances, and inline record types a workflow defines for itself
- view configurations — filters, grouping, sort, which columns
- **views themselves** — a block spec, or a sandboxed page, generated on request
- dashboards and saved layouts

---

## Making a workflow easy to create

Three paths, in the order companies will actually use them.

### 1. Import the runbook

Every company already has hundreds of these: incident runbooks, month-end
close checklists, onboarding lists, review SOPs, sitting in Confluence and
Notion and Google Docs, rotting. They stayed prose because turning one into an
executable workflow demanded a precision nobody had time to supply — "check
whether the customer is strategic" means something to a person and nothing to
Zapier.

An agent reads the doc. That barrier is gone, and it is the single best way in:
**point us at your runbooks.** No blank page, instant recognition, and the
conversion — prose to a structured record — is exactly what a model is good
at. What the importer produces is a *draft* workflow: trigger inferred from
the "when to use this" section, steps as the brief, owner and escalation
carried across as properties.

### 2. Fork a template

Nobody starts from blank. A gallery of working workflows to copy and tweak is
how Zapier and n8n actually get adoption, and a fork already has its trigger,
`emits` and view chosen.

### 3. Say it

Describe it; the agent drafts the record. This is the demo, and the third-most
used path in practice — but it is the one that has to work, because it is what
people try first.

### What makes all three work

- **Enumerable choices.** Trigger kinds, commands, record types and views are
  declared, so the agent picks from sets rather than inventing. Prose is the
  only free-form part.
- **It is a normal record.** The draft is edited in the ordinary properties
  panel, not a bespoke builder. No second editing model to learn or maintain.
- **Validation before enable.** A workflow naming a view that cannot bind its
  record type, or a command it was not granted, is rejected at authoring time.
- **A dry run against real recent data.** Run it over the last five emails and
  show what it *would* have produced. This is the trust mechanism, and it is
  cheap because the output is records you already have views for. It must be
  honest — every write becomes a proposal — or it is worse than nothing.

Two things to carry over from how companies already write process: every
workflow has an **owner** and a **review date** (unowned SOPs rot), and a
declared **escalation path** — what to do when the agent cannot decide: ask,
skip, or stop. A `failed` status is not the same thing.

## Making results easy to see

**Results are records, and records have views.** Not logs, not transcripts,
not an email with a wall of text. This is the whole reason `emits` is
non-negotiable: without a schema the judgment stays in prose, and prose cannot
be grouped, filtered or counted.

Four surfaces, each answering a question people actually ask:

| Question | Surface |
|---|---|
| *What needs me?* | **The output view** — a board or table of what the workflow produced. Where you live. |
| *Is it healthy?* | **The run list** — did it run, did it work, what did it cost. |
| *Why did it say that?* | **The run trace** — what the agent did, with evidence links. |
| *What is this thing?* | **The workflow page** — definition, last and next run, Run now. |

Two properties borrowed from how companies already audit process:

- **Evidence per item.** Each produced record links to what it came from — the
  email, the PR, the paragraph. The accounting close works this way, and it is
  what makes a result checkable in seconds instead of by reading a transcript.
- **The board is the workflow.** Companies already express process as columns,
  not graphs. Grouping the output view by the agent's verdict *is* the process
  view; no separate diagram is needed.

And one thing that is not in the app: **a digest.** Results have to reach
people where they already are — a daily summary into Slack or email that links
back. A notification is a view with a different renderer, and it should be
built as one.

---

## Sequencing

The reordering that follows from all of this: **the plugin system is not a
prerequisite.** It is what we open once the core is settled.

| # | Step | Needs plugins? |
|---|---|---|
| 1 | Records, properties, and first-party list / table / board views | no |
| 2 | Commands, dispatcher, provenance | no |
| 3 | Trigger interface, `cron` + one event kind, Run records | no |
| 4 | Agent authoring: import a runbook, fork a template, say it | no |
| 5 | Dry run | no |
| 6 | Output view, run list, run trace, digest | no |
| 7 | Open the surface: third-party trigger kinds, commands, record types, views | **yes** |
| 8 | Free layout, the reader as a panel, the browser panel | yes |

Steps 1–6 are a working product for a company that uses email, a calendar and
GitHub. Step 7 is what makes it a platform.

## Risks

- **Core creep.** With one email integration, putting `email.received` in core
  looks harmless. It is the god-plugin failure, and it is invisible until the
  fourth integration.
- **The opposite.** Making the base views plugins on day one means nothing
  works out of the box. Ship them first-party, through the public contribution
  point.
- **A dishonest dry run.** If it writes anything, trust is gone the first time
  someone notices, and it will not come back.
- **Content sprawl.** Two hundred workflows nobody owns is the SOP graveyard
  again, with a compute bill. Owner and review date are the cheap defence;
  a "not run in 90 days" filter is the rest of it.
- **`dedupeKey` treated as an optimisation.** It is the difference between
  triaging an email once and drafting forty replies at 3am after a restart.

## Open questions

1. **Who at a company owns the plugin tier?** Vendors and a platform team, in
   theory. In practice a mid-size company has neither, which puts more weight
   on the built-in integrations than a platform story usually admits.
2. **Can content reference a plugin that is not installed?** A forked template
   naming `github.pr_opened` on a workspace with no GitHub — offer to install,
   degrade, or refuse.
3. **Does a runbook importer belong in the box?** It is the strongest way in,
   which argues for first-party; it is also per-source (Confluence, Notion,
   Google Docs), which argues for plugins.
4. **How much view configuration is content before it needs code?** Filters,
   grouping and columns are clearly content. Conditional formatting and
   computed properties are the slope toward a formula language, which is a
   product of its own.
