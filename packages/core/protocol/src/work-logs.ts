export interface WorkLog {
  id: string;
  /** The project (slug) this log belongs to. */
  project: string;
  /** YYYY-MM-DD, or null when the log is undated. */
  entry_date: string | null;
  title: string;
  content: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface CreateWorkLogInput {
  project: string;
  /** YYYY-MM-DD, or null/omitted for an undated log. */
  entry_date?: string | null;
  title?: string;
  content?: string;
}

export interface UpdateWorkLogInput {
  /** Pass a string to date it, or null to make it undated. */
  entry_date?: string | null;
  title?: string;
  content?: string;
}
