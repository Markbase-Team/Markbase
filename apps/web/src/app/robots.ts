import type { MetadataRoute } from "next";

function baseUrl(): string {
  return process.env.APP_URL ?? "https://markbase.so";
}

// Allow crawlers (including AI bots) onto public pages, keep them out of the app
// and private share links, and point them at the sitemap.
export default function robots(): MetadataRoute.Robots {
  const base = baseUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard/", "/api/", "/d/", "/login", "/signup"],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
