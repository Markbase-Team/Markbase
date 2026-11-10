# Phase 2 · The environment around the agent

Status: draft · 2026-09-18 · not started · **starts after Phase 1**
Phase 1 lays out the plugin system and the workflow core — see
[`README.md`](./README.md). This is what we build on top of it, and it is where
the product stops resembling anything Zapier could become.

## The inversion

| | Automation-centered (Zapier, n8n) | Agent-centered (us) |
|---|---|---|
| The noun | the pipeline | **the agent** |
| A workflow is | a program | a standing instruction to a colleague |
| A trigger is | when to execute | **a reminder for the agent** |
| The UI is | absent — output goes to another app | **the agent's presentation tool** |
| The agent is | a step inside the pipeline | the teammate the pipeline was standing in for |

The assumption underneath, and it is load-bearing: **the user works in this
environment all day, alongside several agents.** If that holds, the agent has
context nobody else can get. If it doesn't, all of this degrades into a worse
Zapier with a nicer board.

Which reorders the roadmap in one important way: the documents, the vault, the
reader and the workspace are not adjacent features. **The workspace is the
moat; the agent is the product.**

---

## What changes in the model

### An agent is a record type

Not one assistant — several colleagues, addressable, each with a speciality.

```ts
Agent {
  id, name, avatar
  brief: string          // standing instructions: who this one is, what it cares about
  can: CommandId[]       // its standing grant, per command
  trust: Record<CommandId, "propose" | "ask" | "act">
  memory: MemoryScope    // what it is allowed to remember and read
  owner, workspace
}
```

And then **a workflow is a duty belonging to an agent**, not a free-floating
record. That fixes the data model and a UI question at once: the agent's page
is where you see everything it does — its duties, its runs, what it asked you,
what it learned — which is a more natural home than a list of workflows.

### Memory is the compounding moat

An automation is stateless by design. A teammate is *defined* by accumulated
context: what you dismissed last week, what you mean by "strategic customer,"
which PRs you always skip, how you write when you're saying no.

This is absent from every Phase 1 doc and it is probably more defensible than
the view. **Zapier has nowhere to put it** — no workspace, no documents, no
record of what you decided. We have all three, and the user is in them all day.

What has to be defined:

- **Where memory lives.** Preference: a document the user can read and edit, not
  an opaque embedding store. A teammate whose notes you can correct beats one
  you have to retrain.
- **How it is written.** Mostly from marks: what you dismissed, corrected,
  snoozed, rewrote. Corrections are the highest-signal thing a user produces
  and they are free — they are already happening in the board.
- **Scope.** Per agent, per workspace, or shared? A shared "what this company
  means by X" is valuable and is also the thing that leaks between people who
  should not see each other's work.
- **Forgetting.** A memory that only grows becomes a wrong one nobody can find.

### Triggers become attention

"A reminder for the agent" is the right reading, and it opens something the
pipeline model cannot express: **standing attention.** "Keep an eye on the
inbox and tell me when something needs me" rather than "at 08:00 run this."

Discrete triggers are the degenerate case. Phase 1 builds them; Phase 2 adds
the continuous one, which needs a budget ceiling more than anything else does.

### The agent chooses the presentation

If the UI is the agent's presentation tool, **view selection is an output, not
only a workflow property.** These cluster — show a list. These conflict — show
them side by side. Nothing happened — say so in a line instead of drawing an
empty board.

So `emits` declares a *set* of compatible views and the agent picks per run.
The user can pin one when they want it stable. This is a change to what Phase 1
specifies, and it should not land before the base views are boring and solid.

### Asking is a success state

A teammate asks when unsure; an automation guesses or fails. "The agent asked
me three things this morning" should be a good outcome with a real place in the
UI — its own surface, answerable in one click, and the answer goes to memory so
it is asked once.

This promotes the escalation path from housekeeping to a core interaction, and
it is a large part of why an agent is more useful than a script for judgment
work.

### Trust graduates

A new colleague does not get admin on day one. Per command, per agent:

```
propose  →  ask first  →  act freely
```

Promotion is earned from the record: *"drafted 40 replies, you sent 38
unedited — let it send?"* Demotion on correction. Zapier has no analogue; a zap
is on or off.

---

## Letting a non-coder build an agent

The goal: **someone who does not write code builds a working agent, even though
a working agent means talking to APIs.** Those are two different problems and
conflating them is how this promise gets broken.

### The agent removes the programming, not the connection

| Hard part of "connect to an API" | Does an agent fix it? |
|---|---|
| Field mapping — what goes where | **Yes, entirely.** Zapier's main tax, gone |
| Pagination, retries, error shapes | Mostly |
| Knowing what the API can do | Partly — it can read a spec |
| **Auth: OAuth apps, client ids, callbacks, refresh, scopes** | **No** |

Auth stays engineering work per integration, and it is most of why a catalogue
of thousands is a moat. `packages/email/src/server/oauth.ts` is one
integration, with crypto and token storage beside it.

So the line is: **a non-coder builds an agent; someone else builds the
connection.** When they name a system we do not support, the answer is never
"write a plugin."

### Three levers

1. **MCP.** Increasingly, connecting to a service means installing a server
   that already handles auth and declares its tools. The repo already has
   `.mcp.json`. This is the only realistic route to breadth without building
   thousands of connectors, and it did not exist when Zapier's moat was built.
2. **Thin plugins: auth plus declaration.** Because the agent handles *usage*,
   an integration is "here is how to authenticate, here are the commands, here
   is the trigger" — no per-endpoint nodes, no field mapping, no UI. An order
   of magnitude less work than a Zapier connector, which is why **fifty good
   integrations can compete with seven thousand shallow ones.** That is the
   only version of this fight that is winnable.
3. **The browser as the bottom of the stack.** No API and no MCP server: the
   agent does what a person would and opens the site. Slow and fragile, and the
   long tail is exactly where that is acceptable. This makes the browser plugin
   in the Phase 1 plan the universal fallback integration rather than a side
   quest — and it is something Zapier structurally cannot offer.

### What "easily" has to mean

- **Easy to start** — import your runbook, fork a template. Never a blank page.
- **Easy to check** — dry run against last week's real data, evidence per item.
- **Easy to correct** — edit a sentence, not rewire nodes.

Not "zero thought." Two things stay genuinely hard and should not be papered
over: saying what you want precisely enough ("review PRs" means five different
things), and deciding when to grant write access. Those are the trust ramp, not
the authoring problem.

### Who the non-coder is

Not "anyone, no concepts required." Zapier's users are ops, RevOps, EAs and
support leads — people who think in systems and do not write code. They are
comfortable with triggers, conditions and fields. **The win is removing the
mechanical layer while leaving them in charge of the logic.** Aiming lower
builds something weaker for the people who would actually pay.

For the first release this is smaller than it looks: email, calendar, GitHub,
Slack and the documents already in the workspace is about five connections, all
first-party. The long tail is the growth ceiling, not the launch blocker.

---

## What a competitor structurally cannot do

Not "has not built yet" — cannot, without becoming a different product:

- Accumulate context about you — no workspace to accumulate it in
- Watch continuously instead of firing discretely
- Ask a question mid-task and carry on
- Be interrupted and redirected
- Show you its findings
- Graduate in trust
- Be several colleagues with different specialities and shared context
- **Work on the thing you are currently looking at** — they have no concept of
  "you, looking at something." That is the surface contract, and it exists only
  because of the workspace assumption

## Risks

- **"Agent-centered" read as "contract-free."** The temptation is to drop
  `emits`, `dedupeKey` and `can` because it is a teammate now. The opposite: a
  colleague with no job description and no boundaries is worse than a script,
  because you can neither predict it nor audit it. The contracts are what make
  it trustworthy rather than merely autonomous.
- **The agent as bottleneck.** A teammate is expensive. If every action routes
  through a model, simple things cost 100× and take 100× longer. Direct command
  dispatch — a click, a rule — stays first-class. The agent is the centre, not
  the only path.
- **Memory that is wrong and invisible.** The failure mode is an agent
  confidently applying a preference you never held and cannot find. Hence
  memory as a readable, editable document.
- **Standing attention with no ceiling.** Continuous watching plus a model is
  an unbounded bill. Budget is a Phase 1 contract for a reason.
- **The assumption not holding.** If users do not live in the environment, none
  of this compounds. That is the thing to validate with design partners before
  building the rest of it.

## What Phase 2 ships

An agent you hired, that knows your work, that you can see and correct:

- [ ] `Agent` as a record type; workflows become duties under an agent
- [ ] The agent's page: duties, runs, questions, what it learned
- [ ] Memory: a readable document, written from marks and corrections
- [ ] Trust levels per command, with promotion from the record
- [ ] Questions as a first-class surface
- [ ] Standing attention as a trigger cardinality, with budgets
- [ ] Agent-chosen presentation from a declared set of views
- [ ] MCP as an install path; thin auth-plus-declaration integrations
- [ ] The browser as the fallback integration

**Exit:** someone who does not write code hires an agent, points it at a system
we do not ship an integration for, and has it working and trusted within a
week.

## Open questions

1. **Is memory per agent, per user, or per workspace?** Shared company context
   is the valuable kind and the leaky kind.
2. **Can agents delegate to each other?** The plan already has an agent
   directory and cross-workspace mentions, which makes this cheap to allow and
   hard to reason about.
3. **What does an agent cost, and who sees it?** Per-agent budgets make
   trust concrete but also make the product feel metered.
4. **Does trust promotion need a human decision every time,** or can it
   auto-promote on a threshold? Auto-promotion is the feature and also the
   thing that will eventually send the wrong email.
5. **What happens when an agent is deleted?** Its memory, its duties and its
   past decisions outlive it, and "who wrote this" must still answer.
