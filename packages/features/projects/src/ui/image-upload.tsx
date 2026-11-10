"use client";

import { toast } from "sonner";
import { FileText, X } from "lucide-react";
import { Input } from "@markbase/ui/input";
import { Label } from "@markbase/ui/label";

const isPdf = (f: File) => f.type === "application/pdf";
const isImage = (f: File) => f.type.startsWith("image/");

// Controlled attachment picker for tickets: images and PDFs. Shows a file
// input, validated previews (image thumbnails, PDF tiles), and remove buttons.
// The parent owns the `files` state; upload to storage separately (see
// `uploadImages` in lib/upload).
export function ImageUpload({
  files,
  onFilesChange,
  id = "images",
  label = "Screenshots or PDFs (optional)",
  maxFiles = 20,
  maxBytes = 10 * 1024 * 1024,
}: {
  files: File[];
  onFilesChange: (files: File[]) => void;
  id?: string;
  label?: string;
  maxFiles?: number;
  maxBytes?: number;
}) {
  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file
    const valid: File[] = [];
    for (const f of picked) {
      if (!isImage(f) && !isPdf(f)) {
        toast.error(`${f.name} is not an image or PDF`);
        continue;
      }
      if (f.size > maxBytes) {
        toast.error(`${f.name} is larger than ${Math.round(maxBytes / 1024 / 1024)}MB`);
        continue;
      }
      valid.push(f);
    }
    onFilesChange([...files, ...valid].slice(0, maxFiles));
  }

  function remove(i: number) {
    onFilesChange(files.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="file"
        accept="image/*,application/pdf"
        multiple
        onChange={onPick}
        className="cursor-pointer file:mr-2 file:text-sm file:text-muted-foreground"
      />
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {files.map((f, i) => (
            <div key={i} className="relative">
              {isPdf(f) ? (
                <div className="flex size-16 flex-col items-center justify-center gap-1 rounded-md border bg-muted/40 p-1 text-center">
                  <FileText className="size-5 text-muted-foreground" />
                  <span className="w-full truncate text-[9px] text-muted-foreground">
                    {f.name}
                  </span>
                </div>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={URL.createObjectURL(f)}
                  alt={f.name}
                  className="size-16 rounded-md border object-cover"
                />
              )}
              <button
                type="button"
                onClick={() => remove(i)}
                className="absolute -top-1.5 -right-1.5 rounded-full border bg-background p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Remove attachment"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Up to {maxFiles} files (images or PDFs), {Math.round(maxBytes / 1024 / 1024)}MB each.
      </p>
    </div>
  );
}
