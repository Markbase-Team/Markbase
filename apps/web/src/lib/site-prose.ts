// Long-form prose in the brand, for the public pages that render markdown (the
// docs, the blog): headings set firmly, links underlined in lime, code blocks
// dark. Passed to <Markdown className=…>.
export const SITE_PROSE = [
  "prose-zinc max-w-none",
  "prose-headings:scroll-mt-8 prose-headings:font-semibold prose-headings:tracking-tight",
  "prose-h1:text-4xl prose-h1:font-bold prose-h1:mb-6",
  "prose-h2:mt-14",
  "prose-a:font-medium prose-a:text-zinc-900 prose-a:underline prose-a:decoration-[#c7e600] prose-a:decoration-2 prose-a:underline-offset-4 hover:prose-a:decoration-zinc-900",
  "prose-code:rounded prose-code:bg-zinc-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:font-medium prose-code:text-zinc-900",
  "prose-pre:rounded-xl prose-pre:bg-zinc-950 prose-pre:text-zinc-100",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:font-normal [&_pre_code]:text-zinc-100",
  "prose-strong:text-zinc-900 prose-li:marker:text-zinc-400",
].join(" ");
