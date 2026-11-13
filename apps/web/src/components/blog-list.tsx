"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@markbase/ui/utils";
import { blogDay, groupByMonth, type BlogKind, type BlogPost } from "@/lib/blog";

// The blog's list: filter pills, then the posts in sections by month — the
// month in a left column with its count, its posts as wide cards beside it,
// each with the day and kind on the left. The newest post is the lime one.
// Sections are set apart by space and the cards' tint; there are no rules.

type Filter = "All" | BlogKind;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "All", label: "All" },
  { value: "Update", label: "Updates" },
  { value: "Release", label: "Releases" },
];

export function BlogList({ posts }: { posts: BlogPost[] }) {
  const [filter, setFilter] = useState<Filter>("All");
  const shown = filter === "All" ? posts : posts.filter((p) => p.kind === filter);
  const newest = posts[0]?.slug;

  return (
    <>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter posts">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "rounded-full px-4 py-2.5 text-sm font-semibold transition",
              filter === f.value ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-14 space-y-16">
        {shown.length === 0 && <p className="text-zinc-600">No posts of this kind yet.</p>}
        {groupByMonth(shown).map((group) => (
          <section key={group.key} className="flex flex-wrap gap-x-12 gap-y-6">
            <div className="w-full shrink-0 sm:w-48 sm:pt-7">
              <h2 className="text-2xl font-bold tracking-tight">{group.month}</h2>
              <p className="mt-1 text-[15px] text-zinc-600">
                {group.year} · {group.posts.length} {group.posts.length === 1 ? "post" : "posts"}
              </p>
            </div>
            <ul className="min-w-0 flex-[999_1_32rem] space-y-3">
              {group.posts.map((post) => {
                const lime = post.slug === newest;
                return (
                  <li key={post.slug}>
                    <Link
                      href={`/blog/${post.slug}`}
                      className={cn(
                        "flex flex-wrap gap-x-8 gap-y-2 rounded-3xl p-7 transition",
                        lime ? "bg-[#e5ff6e] hover:brightness-95" : "bg-zinc-100 hover:bg-zinc-200"
                      )}
                    >
                      <div className={cn("flex w-24 shrink-0 flex-col gap-1.5 text-sm", lime ? "text-zinc-700" : "text-zinc-600")}>
                        <time dateTime={post.date} className="text-[28px] leading-none font-bold text-zinc-900">
                          {blogDay(post.date)}
                        </time>
                        <span>{post.kind}</span>
                      </div>
                      <div className="min-w-0 flex-[1_1_22rem]">
                        <h3 className="text-[22px] leading-tight font-semibold tracking-tight">{post.title}</h3>
                        <p className={cn("mt-2 leading-relaxed", lime ? "text-zinc-700" : "text-zinc-600")}>
                          {post.summary}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
