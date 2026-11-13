import type { Metadata } from "next";

// The site's shared social image, and the metadata every public page carries
// about itself. A page's canonical and og:url must be its own address: left to
// the root layout, every page would claim to be the home page.

export const SITE_OG_IMAGE = {
  url: "/markbase-logo.png",
  width: 1024,
  height: 1024,
  alt: "Markbase",
};

/** Title, description, canonical, Open Graph and Twitter tags for one public page. */
export function pageMetadata({
  path,
  title,
  description,
}: {
  path: string;
  title: string;
  description: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      siteName: "Markbase",
      type: "website",
      url: path,
      title,
      description,
      images: [SITE_OG_IMAGE],
    },
    twitter: { card: "summary", title, description },
  };
}
