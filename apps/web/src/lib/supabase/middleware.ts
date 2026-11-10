import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the auth session cookie and gates the /dashboard area: signed-out
// visitors are sent to /login, signed-in visitors skip the login page.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isLoginPage = path === "/login";

  // Signed-out visitors to the app are sent to the top-level /login (with the
  // intended destination preserved).
  if (!user && path.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // Signed-in visitors don't need the login page — but WHERE they were going
  // still matters, and this used to throw it away.
  //
  // The desktop sign-in always routes through here: it loads
  // /login?next=/cli-auth?callback=http://127.0.0.1:<port>… so that Google can
  // bounce back to the app's loopback. Dropping the query turned that into a
  // plain trip to the dashboard — the loopback was never called, the app waited
  // for a key that would never arrive, and the person was left looking at the
  // dashboard in whichever browser got there, with nothing saying why.
  //
  // Same-site paths only, as ever: an absolute URL here would be an open
  // redirect carrying our sign-in flow to somebody else's site.
  if (user && isLoginPage) {
    const next = request.nextUrl.searchParams.get("next");
    const dest =
      next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
    // `new URL(dest, …)` rather than setting pathname: `next` carries a query
    // string of its own, and that query IS the sign-in flow.
    return NextResponse.redirect(new URL(dest, request.url));
  }

  return response;
}
