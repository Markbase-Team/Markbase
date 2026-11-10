import type { Operator } from "@markbase/flows";

// The desktop's operator: the same questions, asked with dialogs.
//
// It lives here rather than in @markbase/flows because it needs electron, and
// that package is imported by the CLI and (for its types) the browser. The two
// dialog functions arrive as arguments rather than as imports, so this stays
// glue — and so it can be driven by a fake the day apps/app gains a test runner.

export interface MessageBoxRequest {
  type: "none" | "info" | "error" | "question" | "warning";
  message: string;
  detail?: string;
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
}

export interface OpenDialogRequest {
  title?: string;
  defaultPath?: string;
  properties?: ("openDirectory" | "createDirectory")[];
}

export interface DialogOperatorOptions {
  showMessageBox: (req: MessageBoxRequest) => Promise<{ response: number }>;
  showOpenDialog: (
    req: OpenDialogRequest
  ) => Promise<{ canceled: boolean; filePaths: string[] }>;
  /** Where a failed or unanswered question goes. The dialog is the answer; this is the record. */
  log?: (line: string) => void;
}

export function dialogOperator(opts: DialogOperatorOptions): Operator {
  const { showMessageBox, showOpenDialog, log = () => {} } = opts;

  return {
    async approve(req): Promise<boolean> {
      // Cancel is first and is the default, so Escape and Return both decline.
      // Mounting a large folder and deleting a local copy are both irreversible;
      // neither should be one stray keystroke away.
      const { response } = await showMessageBox({
        type: "warning",
        message: req.action,
        detail: req.detail,
        buttons: ["Cancel", req.confirmLabel ?? "Continue"],
        defaultId: 0,
        cancelId: 0,
      });
      return response === 1;
    },

    async chooseOption<T>(req: {
      question: string;
      options: { label: string; value: T }[];
    }): Promise<T | null> {
      const { response } = await showMessageBox({
        type: "question",
        message: req.question,
        buttons: [...req.options.map((o) => o.label), "Cancel"],
        cancelId: req.options.length,
      });
      const picked = req.options[response];
      return picked ? picked.value : null;
    },

    async chooseFolder(req): Promise<string | null> {
      const res = await showOpenDialog({
        title: req.purpose,
        defaultPath: req.startAt,
        // createDirectory: the folder for a new vault often does not exist yet.
        properties: ["openDirectory", "createDirectory"],
      });
      const dir = res.filePaths[0];
      if (res.canceled || !dir) return null;
      return dir;
    },

    reportEvent(e): void {
      log(`[${e.level}] ${e.message}`);
      // Info is for the log; a dialog for every routine step would be noise.
      if (e.level === "info") return;
      void showMessageBox({
        type: e.level === "warn" ? "warning" : "error",
        message: e.message,
      });
    },

    reportProgress(p): void {
      // The window renders progress from its own IPC feed; duplicating it in a
      // modal would interrupt the thing it is reporting on.
      log(`[progress] ${p.task}: ${p.done}/${p.total}`);
    },
  };
}
