import { createSupabaseBrowserClient } from "./browser";

// Upload image files to a Supabase Storage bucket and return their public URLs.
// `prefix` namespaces the objects (e.g. the project slug).
export async function uploadImages(
  files: File[],
  prefix: string,
  bucket = "ticket-images"
): Promise<string[]> {
  if (files.length === 0) return [];
  const supabase = createSupabaseBrowserClient();
  const urls: string[] = [];
  for (const f of files) {
    const ext = f.name.includes(".") ? f.name.split(".").pop() : "png";
    const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, f, { contentType: f.type, upsert: false });
    if (error) throw error;
    urls.push(
      supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
    );
  }
  return urls;
}

// Upload a PDF to the reader-pdfs bucket. Returns both the object path (kept on
// the document row) and the public URL react-pdf loads.
export async function uploadPdf(
  file: File
): Promise<{ path: string; url: string }> {
  const supabase = createSupabaseBrowserClient();
  const path = `${crypto.randomUUID()}.pdf`;
  const { error } = await supabase.storage
    .from("reader-pdfs")
    .upload(path, file, { contentType: "application/pdf", upsert: false });
  if (error) throw error;
  const url = supabase.storage.from("reader-pdfs").getPublicUrl(path).data
    .publicUrl;
  return { path, url };
}
