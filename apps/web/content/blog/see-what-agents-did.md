Your agents read and edit your docs all day, and until now you couldn't see any of it. Each document now has an **Analytics** panel. It shows which agents read the document and for whom, and which lines in it an agent wrote.

## What you see

- **Who read it.** Each agent that opened the document, whose agent it is ("Sam's Claude", "Priya's Codex"), how many times it read it, and when it last did.
- **Who wrote each line.** Every line in the document is credited to the person or agent that last changed it. Agent lines are marked in lime and people's in grey, so you can see at a glance which parts of a runbook a person wrote and which an agent added.
- **Agents can ask too.** The same answer comes from `GET /docs/:id/analytics` and the `docs_analytics` MCP tool, so an agent can check who wrote a section before it trusts it.

## When it helps

- **On call.** An agent's fix went wrong at 3am. Open the runbook it worked from: was it read just before the change, and did an agent rewrite the step it followed last week?
- **Investigations.** Afterwards, see which postmortems and service docs the agents actually opened, and which they skipped.
- **Design and roadmaps.** Before you rely on a design doc, see which sections a person wrote and which an agent drafted, and which agents keep returning to it.

## How it works

Claude Code, Codex and Cursor can each run a small command around every file read and edit. Markbase uses those hooks to note which agent touched which file. The log stays on your machine; the sync daemon adds only the read counts to the document, and line credit comes from the version history Markbase already keeps.

1. Run `markbase mcp install`, or open the desktop app. The hooks are added for every agent on your machine.
2. Let your agents work in a synced vault as they normally do.
3. Open any document and choose **Analytics** in the side panel.
