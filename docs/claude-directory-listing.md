# Claude Connectors Directory listing

What to enter in Anthropic's developer portal
([claude.ai/directory/manage](https://claude.ai/directory/manage), **Submit
new**, **MCP connector**) to list the hosted MCP server, so a person can add
Markbase from inside Claude with one click. Kept here so the listing can be
checked against the product and resubmitted after a change.

Requirements: [Submit a connector](https://claude.com/docs/connectors/building/submission),
[review criteria](https://claude.com/docs/connectors/building/review-criteria).
Anyone on a paid Claude plan can submit.

## Before submitting

- [ ] The server is deployed with every tool titled and annotated
      (`toolAnnotations` in `@markbase/shared/endpoint-tools`; the test in
      `packages/features/docs/test/tool-annotations.test.ts` checks it).
- [ ] Added `https://markbase.so/mcp` as a custom connector in Claude and called
      every tool from a conversation. The **Test & launch** step asks you to
      confirm this.
- [ ] The privacy policy at https://markbase.so/privacy-policy is current.

## 1. Connection

- **URL:** `https://markbase.so/mcp`
- **Users connect to different URLs:** no. (A self-hosted instance is added as
  a custom connector, not through the listing.)

## 2. Tools

Synced from the server. 30 tools: 14 read-only, 16 write. None should be
flagged; if one is, fix it on the server, not in the portal.

## 3. Listing

- **Server name:** Markbase
- **One-liner** (≤200): Read, edit and comment on your team's markdown documents, with every change in the version history under the agent's name.
- **Description** (≤2,000):

  > Markbase is one markdown folder for a team and its agents. People write in a
  > web and desktop editor; the same documents sync to a folder on their Mac as
  > plain .md files.
  >
  > With this connector Claude can find, read and search your documents, edit a
  > passage by quoting it, create documents and vaults, comment and resolve
  > comments, read version history and compare versions, restore an earlier
  > version, manage share links, and publish a document to the web.
  >
  > Every change Claude makes is recorded in the document's history under its
  > own name, so you can see exactly what it changed and undo it. When you
  > connect, you choose how much it may do: view, comment, edit, or everything.
  > It gets a key of its own, which you can revoke in Markbase at any time.

- **Categories:** Productivity, Documents (or the closest the portal offers), Knowledge management
- **Documentation URL:** https://markbase.so/docs/agents
- **Privacy policy URL:** https://markbase.so/privacy-policy
- **Support contact:** hello@markbase.so
- **Icon:** `apps/web/public/markbase-logo.png`
- **Slug:** `markbase` (permanent once published)

## 4. Use cases

- **Primary use cases:** draft and edit documents with Claude in the team's own
  docs; answer questions from them; review a document and leave comments;
  check what changed between versions and restore one.
- **What users need first:** a free Markbase account at markbase.so.
- **Reads, writes or both:** both.

## 5. Company

- **Name:** Markbase
- **Website:** https://markbase.so
- **Primary contact:** the person submitting.

## 6. Authentication

- **Authentication requirement:** Required.
- **Method:** OAuth, with dynamic client registration. Leave the client ID and
  secret empty: Claude registers itself (`/oauth/register`), and Markbase's
  own sign-in page issues it a key. Claude's callback,
  `https://claude.ai/api/mcp/auth_callback`, is accepted as an https address.

## 7. Data handling

- **Underlying API:** our own (`https://markbase.so/api/v1`).
- **Personal health data:** no. **Sponsored content:** no.

## 8. Test & launch

Confirm after running every tool as a custom connector. Put no credentials in
the portal. For a Verified review, a reviewer asks for test access by email:
give them a separate test account, never a real one.

## 9. Compliance

Seven acknowledgments. Nothing in Markbase conflicts with them: it moves no
money, generates no images, video or audio, and does not collect the
conversation.

## Tools that ask before running

Claude runs read-only tools without asking. A tool that changes or removes
something (an edit, a rename, a publish, a delete) is marked destructive, as
MCP defines it, so Claude asks first unless the person allows it always. Only
creating something new (a document, a vault, a comment, a share link) is not.
