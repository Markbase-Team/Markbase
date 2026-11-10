import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import Script from "next/script";
import { connection } from "next/server";
import { instanceConfigScript } from "@markbase/protocol/instance-config";
import { Toaster } from "@markbase/ui/sonner";
import { serverInstanceConfig } from "@/lib/instance-info";
import "./globals.css";

// Google Analytics (gtag.js) measurement ID.
const GA_MEASUREMENT_ID = "G-0BYMHHF3LY";

// Single brand font for the whole app (loaded from Google, not local).
const dmSans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://markbase.so"),
  title: "Markbase",
  description: "One markdown folder for your team and its agents.",
  // Explicit favicon/logo so Google shows the current mark next to results.
  icons: {
    icon: [{ url: "/icon.png", type: "image/png" }],
    shortcut: ["/icon.png"],
    apple: [{ url: "/logo.png" }],
  },
  openGraph: {
    siteName: "Markbase",
    type: "website",
    url: "https://markbase.so",
    images: [{ url: "/logo.png", width: 1024, height: 1024, alt: "Markbase" }],
  },
  twitter: { card: "summary" },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // A build made with no Supabase project (the self-hosted image) learns it from
  // the environment it is STARTED in, so no page of it may be rendered at build
  // time: a prerendered page would carry the build's answer — nothing — for ever.
  // The hosted app's build has the project and keeps its static pages.
  if (process.env.MARKBASE_INSTANCE_AT_RUNTIME === "1") await connection();
  const instance = serverInstanceConfig();
  return (
    <html lang="en" className={`${dmSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        {/* Which Supabase project this server runs on, for the browser code
            that signs in and joins live channels (instancePublicConfig() in
            @markbase/protocol). beforeInteractive: the server queues it in the
            page and Next's bootstrap runs the queue before it hydrates anything
            (next/dist/client/app-bootstrap.js), so it is there whenever the
            first client is created. (A raw <script> would run even earlier, at
            parse time, but React refuses one in a component on the client.)
            Absent only when the server itself has no project; the browser then
            falls back to the build's. */}
        {instance && (
          <Script id="markbase-instance" strategy="beforeInteractive">
            {instanceConfigScript(instance)}
          </Script>
        )}
        {children}
        {/* All toasts share one bottom-right stack; collapsed until hover. */}
        <Toaster richColors position="bottom-right" />
        {/* Google Analytics (gtag.js). lazyOnload (not afterInteractive) so the
            ~160KB script loads during browser idle and Next doesn't emit a
            <link rel=preload> that competes with the LCP hero image for early
            bandwidth. Config still buffers via dataLayer and fires on load. */}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="lazyOnload"
        />
        <Script id="gtag-init" strategy="lazyOnload">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
          `}
        </Script>
      </body>
    </html>
  );
}
