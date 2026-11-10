import { headers } from "next/headers";

/**
 * This instance's own address: what the join page tells the app to join, and
 * what Settings shows an admin to share. APP_URL when the deployment says so;
 * otherwise the host the request came in on, which is right for an instance
 * tried out at localhost:<port> before APP_URL is set.
 */
export async function instanceUrl(): Promise<string> {
  const fromEnv = process.env.APP_URL?.replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
