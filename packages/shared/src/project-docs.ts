// Per-project documentation: editable markdown docs scoped to a project (and its
// owner). Mirrors the work-logs data layer; docs are ordered oldest-first
// (creation order) so a project's docs read top-to-bottom.

export interface ProjectDoc {
  id: string;
  /** The project (slug) this doc belongs to. */
  project: string;
  title: string;
  content: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectDocInput {
  project: string;
  title?: string;
  content?: string;
}

export interface UpdateProjectDocInput {
  title?: string;
  content?: string;
}
