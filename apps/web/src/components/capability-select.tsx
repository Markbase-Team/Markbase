import { CAPABILITIES, CAPABILITY_HELP, type Capability } from "@/lib/capabilities";

// The "Document access" picker on a page that approves a key. `subject` is who
// the ceiling applies to, as the hint under it says it.
export function CapabilitySelect({ defaultValue, subject }: { defaultValue: Capability; subject: string }) {
  return (
    <div className="text-left">
      <label htmlFor="capability" className="text-sm font-medium">
        Document access
      </label>
      <select
        id="capability"
        name="capability"
        defaultValue={defaultValue}
        className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm"
      >
        {CAPABILITIES.map((c) => (
          <option key={c} value={c}>
            {CAPABILITY_HELP[c]}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-xs text-muted-foreground">
        The most {subject} can do to your documents. Nothing an agent does can exceed it. Change it later under API
        keys.
      </p>
    </div>
  );
}
