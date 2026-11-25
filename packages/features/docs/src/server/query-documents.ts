import { supabase } from "@markbase/server/supabase";
import type { Scalar, ViewDoc } from "@markbase/shared/docs/views";

// The candidates for a view: documents the account can open whose front
// matter contains every value in `contains`, narrowed by the property index
// (docs.query_documents). The view itself is evaluated by the caller.

export async function queryDocuments(input: {
  userId: string;
  contains: Record<string, Scalar>;
  limit: number;
}): Promise<ViewDoc[]> {
  const { data, error } = await supabase.schema("docs").rpc("query_documents", {
    me: input.userId,
    contains: input.contains,
    max_rows: input.limit,
  });
  if (error) throw new Error(`Couldn't query documents: ${error.message}`);
  return (data ?? []) as ViewDoc[];
}
