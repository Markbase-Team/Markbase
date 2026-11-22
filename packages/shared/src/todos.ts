// One task on the admin "Today!" page. `day` is a calendar date (YYYY-MM-DD)
// the task belongs to; `details` is optional markdown.
export interface Todo {
  id: string;
  day: string;
  text: string;
  done: boolean;
  details: string;
  position: number;
  created_at: string;
}

// A YYYY-MM-DD calendar date. Validated so an untrusted query param can't reach
// the date filter as something other than a plain date.
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(v: string | null | undefined): v is string {
  return typeof v === "string" && DAY_RE.test(v);
}
