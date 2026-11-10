// Markdown files import as their raw text (tsup/esbuild `.md` text loader).
declare module "*.md" {
  const content: string;
  export default content;
}
