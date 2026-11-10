// The documentation sidebar is scoped to one vault at a time — except for this
// sentinel, which stands for "Shared with me": docs shared with you that live in
// someone else's vault. It rides in the same `?vault=` slot and localStorage
// keys as a real vault id (UUIDs never collide with it), so focus, open tabs, and
// linking all work unchanged.
export const SHARED_SCOPE = "shared";

export function isSharedScope(id: string | null): boolean {
  return id === SHARED_SCOPE;
}
