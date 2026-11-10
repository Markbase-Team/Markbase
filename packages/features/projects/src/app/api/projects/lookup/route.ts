import { supabase } from "@markbase/protocol/supabase";

// GET /api/projects/lookup?q=... — resolve a project by slug or name.
// Returns { slug, name } if found, 404 otherwise. Only public fields.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q) {
    return Response.json({ error: "Enter a project name" }, { status: 400 });
  }

  // Try exact slug match first (values are safely parameterized), then name.
  let { data } = await supabase
    .from("projects")
    .select("slug, name")
    .eq("slug", q.toLowerCase())
    .maybeSingle();

  if (!data) {
    ({ data } = await supabase
      .from("projects")
      .select("slug, name")
      .ilike("name", q)
      .maybeSingle());
  }

  if (!data) {
    return Response.json({ error: "No project found" }, { status: 404 });
  }
  return Response.json({ slug: data.slug, name: data.name });
}
