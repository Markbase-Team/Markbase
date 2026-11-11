import { redirect } from "next/navigation";
import { FIRST_DOCS_PAGE } from "@/lib/docs-nav";

// /docs opens the first page in the sidebar.
export default function DocsIndex() {
  redirect(`/docs/${FIRST_DOCS_PAGE}`);
}
