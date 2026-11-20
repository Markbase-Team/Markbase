import { supabase } from "@markbase/protocol/supabase";
import type { ProductEvent } from "@markbase/protocol/product-events";

// Product events — the server half. Writes one reported event to
// public.product_events for the account the gate named. See
// @markbase/protocol/product-events for what may be reported.

export interface ProductEventRow {
  user_id: string;
  name: string;
  props: Record<string, string>;
}

/** As much of the database client as this needs, so a test can hand in a stub. */
export interface EventWriter {
  insert(row: ProductEventRow): Promise<{ error: { message: string } | null }>;
}

const tableWriter: EventWriter = {
  insert: async (row) => {
    const { error } = await supabase.from("product_events").insert(row);
    return { error };
  },
};

/** Whether it was written. Never throws: an event is not worth a failed request. */
export async function recordProductEvent(
  userId: string,
  event: ProductEvent,
  writer: EventWriter = tableWriter
): Promise<boolean> {
  try {
    const { error } = await writer.insert({ user_id: userId, name: event.name, props: event.props });
    if (error) {
      console.warn(`[product-events] ${event.name} not recorded: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[product-events] ${event.name} not recorded: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
