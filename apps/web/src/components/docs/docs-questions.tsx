import { Mail } from "lucide-react";

// The way to a person, at the side of every docs page and at its foot on a
// narrow screen.
export const DOCS_CONTACT = "hello@markbase.so";

export function DocsQuestions({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-xl border border-zinc-200 bg-white p-4 ${className}`}>
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-[#e5ff6e]">
          <Mail className="size-4 text-zinc-900" />
        </span>
        <span className="font-semibold text-zinc-900">Got questions?</span>
      </div>
      <p className="mt-2 text-sm text-zinc-600">
        Email{" "}
        <a href={`mailto:${DOCS_CONTACT}`} className="font-medium text-zinc-900 underline decoration-[#c7e600] decoration-2 underline-offset-4 hover:decoration-zinc-900">
          {DOCS_CONTACT}
        </a>
        .
      </p>
    </div>
  );
}
