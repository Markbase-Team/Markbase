"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@markbase/ui/button";
import { Input } from "@markbase/ui/input";
import { Label } from "@markbase/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@markbase/ui/dialog";
import { cn } from "@markbase/ui/utils";
import { InlineSelect } from "./inline-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@markbase/ui/select";
import { propertyValueColor } from "./property-color";
import type { ProjectProperty, Ticket } from "@markbase/protocol/types";
import { submitKeys } from "@markbase/ui/keys";

// Sentinel for the "no default value" option in the default-value picker
// (Radix Select can't hold an empty string item value).
const NO_DEFAULT = "__no_default__";

// A Radix Select can't hold an empty string item value, so use a sentinel for
// "no value" and map it back to "" when saving.
const CLEAR = "__clear__";

// Parse a comma-separated options field into a clean string[].
function parseOptions(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Manage the property definitions for a project (add / rename / set allowed
// values / delete). Changes are pushed up via onChange so the board can react.
// ---------------------------------------------------------------------------
export function ManagePropertiesDialog({
  project,
  open,
  onOpenChange,
  properties,
  onChange,
}: {
  project: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  properties: ProjectProperty[];
  onChange: (properties: ProjectProperty[]) => void;
}) {
  const [newName, setNewName] = useState("");
  const [newOptions, setNewOptions] = useState("");
  const [adding, setAdding] = useState(false);

  async function addProperty(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    const res = await fetch(`/api/admin/projects/${project}/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, options: parseOptions(newOptions) }),
    });
    setAdding(false);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Failed" }));
      toast.error(error ?? "Failed to add property");
      return;
    }
    const { property } = await res.json();
    onChange([...properties, property]);
    setNewName("");
    setNewOptions("");
    toast.success(`Property "${property.name}" added`);
  }

  async function deleteProperty(id: string) {
    if (!confirm("Delete this property? Existing values will be hidden.")) return;
    const res = await fetch(
      `/api/admin/projects/${project}/properties/${id}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      toast.error("Failed to delete property");
      return;
    }
    onChange(properties.filter((p) => p.id !== id));
    toast.success("Property deleted");
  }

  function applyUpdated(updated: ProjectProperty) {
    onChange(properties.map((p) => (p.id === updated.id ? updated : p)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Properties</DialogTitle>
          <DialogDescription>
            Define fields for every ticket in this project. Leave allowed values
            empty for free text, or list them (comma-separated) for a dropdown.
            Pick a default to pre-fill new tickets.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {properties.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No properties yet. Add one below.
            </p>
          ) : (
            properties.map((p) => (
              <PropertyRow
                key={p.id}
                project={project}
                property={p}
                onSaved={applyUpdated}
                onDelete={() => deleteProperty(p.id)}
              />
            ))
          )}
        </div>

        <form
          onSubmit={addProperty}
          className="space-y-3 border-t pt-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="np-prop-name">New property</Label>
              <Input
                id="np-prop-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Priority"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-prop-options">Allowed values (optional)</Label>
              <Input
                id="np-prop-options"
                value={newOptions}
                onChange={(e) => setNewOptions(e.target.value)}
                placeholder="Low, Medium, High"
              />
            </div>
          </div>
          <Button type="submit" disabled={adding || !newName.trim()} className="w-full">
            {adding ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Add property
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// One editable row in the manage dialog: rename + edit allowed values.
function PropertyRow({
  project,
  property,
  onSaved,
  onDelete,
}: {
  project: string;
  property: ProjectProperty;
  onSaved: (property: ProjectProperty) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(property.name);
  const [options, setOptions] = useState(property.options.join(", "));
  const [def, setDef] = useState(property.default_value);
  const [saving, setSaving] = useState(false);

  const opts = parseOptions(options);
  const dirty =
    name.trim() !== property.name ||
    opts.join(",") !== property.options.join(",") ||
    def !== property.default_value;

  async function save() {
    if (!name.trim()) {
      toast.error("Name cannot be empty");
      return;
    }
    setSaving(true);
    const res = await fetch(
      `/api/admin/projects/${project}/properties/${property.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          options: opts,
          default_value: opts.includes(def) ? def : "",
        }),
      }
    );
    setSaving(false);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Failed" }));
      toast.error(error ?? "Failed to save property");
      return;
    }
    const { property: updated } = await res.json();
    setDef(updated.default_value);
    onSaved(updated);
    toast.success("Property saved");
  }

  return (
    <div className="flex items-end gap-2">
      <div className="grid flex-1 gap-2 sm:grid-cols-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
        />
        <Input
          value={options}
          onChange={(e) => setOptions(e.target.value)}
          placeholder="Free text"
        />
        <Select
          value={opts.includes(def) ? def : NO_DEFAULT}
          onValueChange={(v) => setDef(v === NO_DEFAULT ? "" : v)}
          disabled={opts.length === 0}
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue placeholder="Default…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_DEFAULT} className="text-muted-foreground">
              No default
            </SelectItem>
            {opts.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={!dirty || saving}
        onClick={save}
      >
        {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="text-muted-foreground hover:text-destructive"
        onClick={onDelete}
        aria-label="Delete property"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline editor for one property's value on one ticket. A property with a fixed
// option set renders a dropdown; otherwise a free-text input saved on blur.
// ---------------------------------------------------------------------------
export function PropertyValueEditor({
  ticket,
  property,
  onSaved,
  valueColors,
  compact = false,
}: {
  ticket: Ticket;
  property: ProjectProperty;
  onSaved: (ticket: Ticket) => void;
  // Optional explicit color per value (e.g. Priority: High=red). When omitted,
  // each value gets a distinct color by its position among the options.
  valueColors?: Record<string, string>;
  // A smaller control for tight spots (e.g. inline on a card meta row).
  compact?: boolean;
}) {
  const current = ticket.properties?.[property.id] ?? "";
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);

  // A distinct, readable color per value: explicit map first (Priority), then a
  // per-option palette so each value in a property stands apart. Unset = neutral.
  const colorFor = (v: string) =>
    !v
      ? ""
      : valueColors?.[v] ?? propertyValueColor(v, property.options.indexOf(v));
  const colorClass = colorFor(current);

  async function save(next: string) {
    if (next.trim() === current.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/v1/tickets/${ticket.id}/properties`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_id: property.id, value: next }),
    });
    setSaving(false);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Failed" }));
      toast.error(error ?? "Failed to save value");
      setValue(current); // revert
      return;
    }
    const { ticket: updated } = await res.json();
    onSaved(updated);
  }

  if (property.options.length > 0) {
    // Reuse the same inline dropdown as the status/assignee selects so every
    // control on the card reads identically. The property name shows while
    // unset; the chosen value replaces it once set.
    return (
      <InlineSelect
        value={current}
        onChange={(v) => save(v === CLEAR ? "" : v)}
        placeholder={property.name}
        ariaLabel={property.name}
        size={compact ? "sm" : "default"}
        triggerClassName={cn(
          compact && "text-xs",
          colorClass && "border-transparent font-medium",
          colorClass
        )}
        options={[
          { value: CLEAR, label: "—", className: "text-muted-foreground" },
          ...property.options.map((o) => ({ value: o, label: o })),
        ]}
      />
    );
  }

  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => save(value)}
      // Blur is what saves this field, so an IME confirm must not reach it.
      onKeyDown={(e) => {
        const el = e.currentTarget;
        submitKeys({ onSubmit: () => el.blur() })(e);
      }}
      disabled={saving}
      placeholder={property.name}
      className={cn(
        compact && "h-7 text-xs",
        colorClass && "border-transparent font-medium",
        colorClass
      )}
      aria-label={property.name}
    />
  );
}
