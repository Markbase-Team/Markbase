import { supabase } from "@markbase/protocol/supabase";
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

// Publish a doc to the web. Assigns a stable public slug on first publish
// (kept for re-publish), then stamps published_at. Owner-gated by the route.
export async function publishDocument(
  docId: string
): Promise<{ slug: string }> {
  const doc = await getDocument(docId);
  if (!doc) throw new Error("Document not found");

  const slug = doc.public_slug ?? publicSlug(doc.title, docId);
  const { error } = await db()
    .from("documents")
    .update({ public_slug: slug, published_at: new Date().toISOString() })
    .eq("id", docId);
  if (error) throw error;
  return { slug };
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
  const tabs = rows.length
    ? rows.map((d) => ({ id: d.id, title: d.title, content: d.content ?? "" }))
    : [{ id: doc.id, title: doc.title, content: doc.content ?? "" }];
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
