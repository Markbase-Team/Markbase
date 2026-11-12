"use client";

import { useEffect, useState } from "react";
import { api } from "@markbase/protocol/api-client";
import { Button } from "./button";
import { Input } from "./input";
import { cn } from "./utils";

// The name others see — on a page you publish, on the versions you write, in
// an invitation you send. In Settings in both shells. Whatever is set here
// wins; with nothing set, the name your sign-in brought along (a Google
// account's) is used, and the placeholder shows it.

/** GET/PUT /api/v1/me/profile. */
interface Profile {
  email: string | null;
  display_name: string | null;
  fallback_name: string | null;
}

export function DisplayNameField({ className }: { className?: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    api.json<Profile>("/api/v1/me/profile").then(
      (p) => {
        if (!live) return;
        setProfile(p);
        setValue(p.display_name ?? "");
      },
      (e: Error) => live && setMessage({ text: e.message, error: true })
    );
    return () => {
      live = false;
    };
  }, []);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    await api
      .json<Profile>("/api/v1/me/profile", {
        method: "PUT",
        body: JSON.stringify({ display_name: value.trim() }),
      })
      .then(
        (p) => {
          setProfile(p);
          setValue(p.display_name ?? "");
          setMessage({ text: "Saved", error: false });
        },
        (err: Error) => setMessage({ text: err.message, error: true })
      );
    setSaving(false);
  }

  const unchanged = value.trim() === (profile?.display_name ?? "");
  return (
    <section className={cn("space-y-2", className)}>
      <h3 className="text-sm font-semibold">Display name</h3>
      <p className="text-sm text-muted-foreground">
        The name others see on pages you publish and edits you make.
      </p>
      <form onSubmit={save} className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={profile?.fallback_name ?? "Your name"}
          maxLength={80}
          autoComplete="name"
          disabled={saving || profile === null}
          aria-label="Display name"
        />
        <Button type="submit" variant="outline" disabled={saving || profile === null || unchanged}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
      {message && (
        <p className={cn("text-xs", message.error ? "text-destructive" : "text-muted-foreground")}>
          {message.text}
        </p>
      )}
    </section>
  );
}
