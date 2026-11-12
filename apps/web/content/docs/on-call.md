# On-call with agents

An incident is where an agent helps most and where its work most needs a
second pair of eyes. The agent can read logs faster than anyone; a person
still has to agree with what it found and with the fix before it ships.
Markbase gives both of them one document to work in.

## The incident is a document

Keep the runbooks and the incident notes in a vault, next to the service's
code. When something breaks, the on-call engineer opens a note for it, or asks
the agent to: what is failing, since when, and what has been tried.

## The agent reads the logs and writes down what it sees

The agent works where the logs and the code are. It pulls the relevant lines,
quotes them in the incident note, and writes what it thinks they mean: the
error, the request that triggered it, the commit that introduced it. Because
the note is a file in the vault, it appears live in the browser and the app
as the agent writes it, with no copying into a chat.

## People check the findings on the line

Whoever is on call reads the note as it fills in. A doubtful conclusion gets a
comment on the exact log line it rests on: "this timeout is upstream, not
ours", "check the deploy at 14:02". An agent with the Markbase skill reads
those comments and answers or revises in the same place, so the reasoning and the challenge
to it stay together.

## The fix is proposed before it is applied

The agent writes the fix it proposes into the note: the change, why it
addresses what the logs show, and how to confirm it worked. A person reviews
it there and approves, asks for changes, or rejects it, before anything
reaches production. After the fix ships, the agent adds what the logs show
now, and the person who approved it confirms the incident is over.

## The record writes itself

Every edit is in the document's history, attributed to the person or agent
who made it. The postmortem starts from a timeline that already exists: what
the agent saw, what people questioned, which fix was approved and by whom.
When the same failure comes back, the agent finds the earlier note in the
vault and starts from it, and the runbook it updated is the one the next
person on call reads.
