// HTML imported as a string, via tsup's `.html: "text"` loader (tsup.config.ts).
// Lets the onboarding screen live in a real .html file — with editor support and
// syntax highlighting — while still being inlined into the built main.js, so the
// app bundle has no separate asset to copy or lose.
declare module "*.html" {
  const content: string;
  export default content;
}

// PNGs imported as data URLs, via tsup's `.png: "dataurl"` loader. The tray
// icon travels inside main.js for the same reason the onboarding page does: the
// packaged app has no asset folder to find it in.
declare module "*.png" {
  const dataUrl: string;
  export default dataUrl;
}
