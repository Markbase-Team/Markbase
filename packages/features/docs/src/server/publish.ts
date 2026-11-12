import { supabase } from "@markbase/protocol/supabase";
import {
  behindPublished,
  checkpoint,
  listVersions,
  pinVersion,
  pinnedVersion,
  publishedMarkdown,
  versionCount,
  type VersionMeta,
} from "@markbase/docs";
import { editDocCrdt, readDocCrdt } from "./doc-crdt";
import { getDocument, type DocumentRow } from "./documents";

const db = () => supabase.schema("docs");

function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents
    .replace(/[^a-z0-9\s-]/g, "") // drop emoji/punct
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return base || "doc";
}

// The stable public slug assigned on first publish: a kebab-case title plus a
// short id suffix so two docs with the same title never collide.
export function publicSlug(title: string, docId: string): string {
  return `${slugify(title)}-${docId.slice(0, 8)}`;
}

/** The label a version gets when publishing records it. */
const PUBLISHED_LABEL = "Published";

/**
 * Pin a version of one document as its published one, and say which.
 *
 * With no `version`, the text as it stands is published: it is recorded as a
 * version first (a no-op when the latest version already is that text), and
 * that one is pinned. With a `version`, that existing one is pinned.
 */
async function pinPublished(
  docId: string,
  rowContent: string | null,
  version?: number
): Promise<number> {
  const { result } = await editDocCrdt(docId, rowContent ?? "", (y) => {
    let index = version;
    if (index === undefined) {
      checkpoint(y, { label: PUBLISHED_LABEL });
      index = versionCount(y) - 1;
    }
    pinVersion(y, index);
    return index;
  });
  return result;
}

// Publish a doc to the web. Assigns a stable public slug on first publish
// (kept for re-publish), pins the version to show (see pinPublished) on the
// document and the current text on every other tab of its group, then stamps
// published_at. Owner-gated by the route.
export async function publishDocument(
  docId: string,
  version?: number
): Promise<{ slug: string; version: number }> {
  const doc = await getDocument(docId);
  if (!doc) throw new Error("Document not found");

  const pinned = await pinPublished(docId, doc.content, version);
  const { data: siblings } = await db()
    .from("documents")
    .select("id, content")
    .eq("tab_group_id", doc.tab_group_id);
  const others = ((siblings ?? []) as { id: string; content: string | null }[]).filter(
    (d) => d.id !== docId
  );
  await Promise.all(others.map((d) => pinPublished(d.id, d.content)));

  const slug = doc.public_slug ?? publicSlug(doc.title, docId);
  const { error } = await db()
    .from("documents")
    .update({ public_slug: slug, published_at: new Date().toISOString() })
    .eq("id", docId);
  if (error) throw error;
  return { slug, version: pinned };
}

/** What the publish dialog needs to know about a document's versions. */
export interface PublishVersions {
  /** The pinned version's index; null when unpinned (published before pins, or never). */
  version: number | null;
  /** The document has changed since the pinned version. */
  behind: boolean;
  /** Every version, oldest first. */
  versions: VersionMeta[];
}

export async function publishVersions(docId: string, rowContent: string | null): Promise<PublishVersions> {
  return readDocCrdt(docId, rowContent ?? "", (y) => ({
    version: pinnedVersion(y),
    behind: behindPublished(y),
    versions: listVersions(y),
  }));
}

// Take a doc offline (keeps the slug so re-publishing restores the same URL).
export async function unpublishDocument(docId: string): Promise<void> {
  const { error } = await db()
    .from("documents")
    .update({ published_at: null })
    .eq("id", docId);
  if (error) throw error;
}

// The published doc for a public slug, or null if unknown / not published.
export async function getPublishedDoc(
  slug: string
): Promise<DocumentRow | null> {
  const { data, error } = await db()
    .from("documents")
    .select("*")
    .eq("public_slug", slug)
    .not("published_at", "is", null)
    .maybeSingle();
  if (error) throw error;
  return (data as DocumentRow | null) ?? null;
}

/**
 * The text a document is published as: its pinned version, or — published
 * before pins existed — the text as it stands.
 *
 * Read from the CRDT, never the row. The row's `content` is a mirror that only
 * some writers keep in step: an agent's edit through the API updates it;
 * typing in the editor or a file synced by the vault daemon does not. A page
 * published from the row showed whatever the row was created with — a document
 * written in the editor published as its title and nothing else (the launch
 * post, 2026-11-12). The row is only the seed for a document that has never
 * been opened and so has no CRDT yet.
 */
function liveMarkdown(docId: string, rowContent: string | null): Promise<string> {
  return readDocCrdt(docId, rowContent ?? "", publishedMarkdown);
}

// A published doc plus all tabs in its group (ordered left→right), so the public
// page can render the whole tabbed document, not just the published tab.
export async function getPublishedTabs(slug: string): Promise<{
  publishedAt: string | null;
  updatedAt: string;
  ownerId: string;
  tabs: { id: string; title: string; content: string }[];
} | null> {
  const doc = await getPublishedDoc(slug);
  if (!doc) return null;
  const { data } = await db()
    .from("documents")
    .select("id, title, content, position")
    .eq("tab_group_id", doc.tab_group_id)
    .order("position", { ascending: true });
  const rows = (data ?? []) as { id: string; title: string; content: string | null }[];
  const sources = rows.length ? rows : [{ id: doc.id, title: doc.title, content: doc.content }];
  const tabs = await Promise.all(
    sources.map(async (d) => ({
      id: d.id,
      title: d.title,
      content: await liveMarkdown(d.id, d.content),
    }))
  );
  return {
    publishedAt: doc.published_at,
    updatedAt: doc.updated_at,
    ownerId: doc.owner_id,
    tabs,
  };
}

// Every currently-published doc (for the sitemap).
export async function listPublishedDocs(): Promise<
  { slug: string; updatedAt: string }[]
> {
  const { data, error } = await db()
    .from("documents")
    .select("public_slug, updated_at")
    .not("published_at", "is", null);
  if (error) throw error;
  return (data ?? [])
    .filter((d): d is { public_slug: string; updated_at: string } =>
      Boolean(d.public_slug)
    )
    .map((d) => ({ slug: d.public_slug, updatedAt: d.updated_at }));
}
