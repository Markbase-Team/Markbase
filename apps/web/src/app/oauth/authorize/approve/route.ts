import { NextResponse } from "next/server";
import { createApiKey } from "@markbase/server/api-keys";
import { checkAuthorize, sealCode } from "@markbase/server/mcp-oauth";
import { pickedCapability } from "@/lib/capabilities";
import { instanceUrl } from "@/lib/instance-url";
import { oauthSecret } from "@/lib/mcp-oauth";
import { getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

function text(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Was this form sent by our own page? The approve button mints a key for
 * whoever is signed in, so a form on another site must not be able to press
 * it for them. A browser says where a POST came from; one that says nothing
 * is refused.
 */
async function fromThisSite(req: Request): Promise<boolean> {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = req.headers.get("origin");
  return origin !== null && origin === new URL(await instanceUrl()).origin;
}

// POST target of the /oauth/authorize form. Mints an API key for the signed-in
// person, inert until the client exchanges the code for it (see
// @markbase/server/mcp-oauth), and sends the client back to the address it
// registered with that code.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await fromThisSite(req))) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });

  const form = await req.formData();
  const secret = oauthSecret();
  // Checked again: the form's fields came back through the browser.
  const checked = checkAuthorize(
    {
      response_type: text(form, "response_type"),
      client_id: text(form, "client_id"),
      redirect_uri: text(form, "redirect_uri"),
      code_challenge: text(form, "code_challenge"),
      code_challenge_method: text(form, "code_challenge_method"),
    },
    secret
  );
  if (!checked.ok) return NextResponse.json({ error: checked.reason }, { status: 400 });

  const back = new URL(checked.redirectUri);
  const state = text(form, "state");
  if (state) back.searchParams.set("state", state);

  if (form.get("decision") !== "allow") {
    back.searchParams.set("error", "access_denied");
  } else {
    const capability = pickedCapability(form.get("capability"));
    const { token } = await createApiKey({
      name: `${checked.client.name} · ${new Date().toISOString().slice(0, 10)}`,
      ownerId: user.id,
      ownerEmail: user.email ?? null,
      capability: capability === "owner" ? null : capability,
      requiresConfirmation: true,
    });
    back.searchParams.set(
      "code",
      sealCode({ token, clientId: checked.clientId, redirectUri: checked.redirectUri, challenge: checked.challenge }, secret)
    );
  }
  // 303: the client's address is fetched with GET. Built by hand because the
  // address may be an app's own scheme.
  return new NextResponse(null, { status: 303, headers: { Location: back.toString(), "Cache-Control": "no-store" } });
}
