import { createSupabaseBrowserClient } from "@markbase/shared/browser";

type BrowserClient = ReturnType<typeof createSupabaseBrowserClient>;
type Channel = ReturnType<BrowserClient["channel"]>;

/**
 * Call `onChange` whenever a ticket the signed-in person can read changes.
 * Returns the function that stops listening.
 *
 * The socket has to carry the person's token BEFORE the channel is joined.
 * Realtime decides who a table subscription belongs to at the moment of the
 * join; a token that arrives afterwards does not change it. Subscribing
 * straight away joined as the anonymous role, which may read no tickets, so
 * no change was ever delivered and the board only moved on a reload. Hence
 * the wait on `setAuth()` here, which reads the session and hands its token
 * to the socket.
 */
export function onTicketChanges(channelName: string, onChange: () => void): () => void {
  const supabase = createSupabaseBrowserClient();
  let stopped = false;
  let channel: Channel | null = null;

  const join = (): void => {
    if (stopped) return;
    channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, () => onChange())
      .subscribe();
  };
  // A failed token read still joins: anonymous delivery is what there was
  // before, and the board's own reloads cover the rest.
  void supabase.realtime.setAuth().then(join, join);

  return () => {
    stopped = true;
    if (channel) void supabase.removeChannel(channel);
  };
}
