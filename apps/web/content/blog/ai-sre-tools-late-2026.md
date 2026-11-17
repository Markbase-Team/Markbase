Most AI SRE comparisons rank who investigates best. This one asks what happens after the incident: where what the agent learned ends up, who can edit it, and what leaves with you if you cancel. I make Markbase, which is on this list as the one entry that is not an investigation agent.

## Where the list comes from

The groups follow a recent r/sre thread, [AI SRE tools in late 2026](https://www.reddit.com/r/sre/comments/1xstulo/ai_sre_tools_in_late_2026_updated_list_plus_what/), and the entries are the vendors as they describe themselves on their own sites and docs as of November 2026. Where a vendor does not say where learned knowledge lives or whether it exports, the entry says so. That means the vendor has not published it, not that the feature is missing. If a line is wrong about your product, write to us and it gets fixed, with the correction dated at the bottom.

## Investigation agents

- **Resolve AI.** Investigates alerts and hands back a root cause and a remediation plan. Its plugin for Claude Code, Cursor and Codex reads the `SKILL.md` runbooks in your repo, so those files stay yours; the investigation history stays in Resolve. Credit-based pricing since September.
- **Traversal.** High-volume triage with LLMs plus causal ML, built around a Production World Model of your environment that lives in Traversal. Harvey built its own incident agent and still bought Traversal, runs both on every SEV, and reports a correct or close root cause on 22 of 24. $120M raised at a $1B valuation; monthly investigations grew from 513 to about 73,000 this year.
- **Cleric.** Calls itself self-learning: it learns from past investigations, and that memory lives in Cleric. Claude Code and other agents can read an investigation by id or start one over MCP. Self-serve pricing, an AWS Marketplace listing, and a published cost per investigation that fell from $3.30 to $2.03. Its new terms let the agent open PRs and change config.
- **Sherlocks AI.** Investigates across cloud, VMs, networks and apps, and keeps a knowledge graph of services, infrastructure and recent changes current. A read-only gateway collects inside your network; results go to Slack, ServiceNow or Jira. SOC 2 Type 2, and one of the few vendors that publishes how its agents run.
- **NeuBird, OpsWorker, DrDroid, Ciroos.** Per-investigation pricing and an in-network proxy that strips personal data (NeuBird). A read-only agent in the Kubernetes cluster with a human approving every action (OpsWorker). Narrow agents sold as alert middleware (DrDroid). An early-stage team out of AppDynamics and Cisco (Ciroos). None of the four say where what the agent learned lives or whether it exports.
- **Acquired this year.** Deductive AI went to Elastic in August. Robusta, and with it HolmesGPT, went to Freshworks. ThinkHive went to Rootly.

## Kubernetes-native

- **HolmesGPT.** Free, open source, a CNCF Sandbox project, and still the first tool most teams try. It reads the runbooks you point it at, so the runbooks and the code are yours. Whether it stays neutral across incident tools after the Freshworks acquisition is an open question.
- **Komodor.** Now an agentic operations platform with more than fifty ready-made agents and an SDK to build your own, with spend caps and approvals for risky actions. What the agents learn lives in Komodor.

## Observability platforms adding AI

- **Datadog Bits AI SRE.** Investigates alerts around the clock and can be started from Slack. Bits Memories learns from investigations, runbooks, postmortems, Slack conversations and prior remediations, and keeps that in Datadog. Investigations read the runbooks linked from Confluence, so those stay yours. More than 10,000 paying customers; cost per investigation down from $25 to about $4; an in-house model, Scout, in closed preview.
- **Elastic, Dynatrace, Grafana Assistant, Groundcover.** Elastic now runs the Deductive agent it bought. The other three shipped no big change this period.

## Incident workflow platforms adding AI

- **PagerDuty.** The agent is now in all four plans. The Claude Code plugin's risk score grades a diff against 90 days of your incidents, and the hosted MCP server reads and writes incidents. Incident records export; the correlations and scores stay in PagerDuty. Revenue grew 0.8% last quarter, with net retention at 98%.
- **incident.io.** An investigation agent plus coordination. Median time to a first accurate update fell from 6.7 to 3 minutes. Its Claude Code plugin is in Anthropic's official marketplace, the MCP server has 32 tools, three of them agents, and every write action needs approval from the person who asked. Incidents and postmortems export.
- **Rootly.** AI SRE plus coordination. The agent correlates alerts, code changes and past incidents, then hands a fix to Claude Code, Codex, Cursor or Devin for a pull request. Offers to buy out up to 12 months of a PagerDuty contract, bought ThinkHive for evidence checks, and removed its ISO 27001 claim.
- **FireHydrant.** Enterprise process, still, after buying Blameless.

## Cloud-provider native

- **AWS DevOps Agent and Azure SRE Agent.** Both are priced by agent time and need no new contract, so single-cloud teams try them first. What they learn lives with the cloud provider.

## Nearby tools using the same pattern

- **Anyshift.** Gives coding agents read-only production context during code review: resources, dependencies, blast radius and recent changes, through six Graph MCP tools. Its methodology skills are open source under Apache 2.0 and run without an account; the graph stays in Anyshift. Closest to Markbase in shape, but it stores system facts, not team experience.
- **Finout and Lightrun.** Finout runs a read-only investigation agent for cloud cost spikes. Lightrun moved away from AI SRE toward enterprise and SAP operations.

## Where Markbase fits

- **It does not investigate.** Markbase is the markdown knowledge base humans and agents write together: the runbooks, what the postmortem taught, the usual fix for each service.
- **The files are yours.** They sit on your disk, synced to a vault, with version history and comments. Any agent that reads files or calls an HTTP API can read and edit them: Claude Code, Codex, Cursor, and every agent above that reads a `SKILL.md` or a runbook.
- **Cancel and keep everything.** The markdown stays where it is, in the format it was written in.
- **Built and bought is the case it is for.** Harvey runs its own agent and Traversal on every SEV. Two agents, two sets of learnings, and nothing merging them into one file the team owns. On this list, the one line that is already yours is the runbook each tool reads. Markbase makes that line the thing humans and agents maintain together.

## Three questions to ask any tool on this list

The r/sre thread says buyers now open with three questions: does the agent write to production, can it run inside our VPC, and can we see why it reached a conclusion. Add three about memory.

1. After an incident, where does what the agent learned live, and in what format?
2. Can a human edit it, and does the agent then read the human's version or its own copy?
3. If we cancel, what leaves with us?
