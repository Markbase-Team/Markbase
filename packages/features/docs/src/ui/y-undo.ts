import { Extension } from "@tiptap/core";
import type * as Y from "yjs";

// Route the editor's ⌘Z / ⌘⇧Z / ⌘Y to the doc's Y.UndoManager instead of
// ProseMirror's own history (which StarterKit's `undoRedo` is disabled to make
// room for — see docExtensions).
//
// Why not PM history: the undo stack has to live on the Y.Doc, not the editor,
// so it survives the editor rebinding to a different doc and back (warm-pool tab
// switching). It's also CRDT-aware — the manager tracks only the local "editor"
// origin, so undo reverts YOUR edits and steps over remote/file edits even when
// they're interleaved.
//
// The active manager comes from a getter (not a fixed value) because the same
// editor instance rebinds to different docs over its life; on each bind
// useCrdtSync points the ref at that doc's manager.

export interface YUndoOptions {
  getManager: () => Y.UndoManager | null;
}

export const YUndo = Extension.create<YUndoOptions>({
  name: "yUndo",

  addOptions() {
    return { getManager: () => null };
  },

  addKeyboardShortcuts() {
    const undo = (): boolean => {
      const m = this.options.getManager();
      if (m && m.canUndo()) m.undo();
      // Always consume the key: even with nothing to undo, we must not let the
      // browser's native contenteditable undo fire and desync the CRDT.
      return true;
    };
    const redo = (): boolean => {
      const m = this.options.getManager();
      if (m && m.canRedo()) m.redo();
      return true;
    };
    return {
      "Mod-z": undo,
      "Mod-y": redo,
      "Mod-Shift-z": redo,
    };
  },
});
