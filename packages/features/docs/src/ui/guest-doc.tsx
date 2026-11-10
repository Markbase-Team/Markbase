"use client";

import { useState } from "react";
import type { Capability } from "@markbase/docs/server";
import { DocView, type TabDoc } from "./doc-view";
import { DocActionSet } from "./doc-action-set";
import { DocClientProvider } from "./doc-client";

// Includes "claude" to match DocView's panel; the guest page has no vault, so the
// Claude Code tab is never shown — this just keeps the prop types aligned.
type PanelTab = "tabs" | "comments" | "history" | "claude";

/**
 * A shared document opened through a link (guest or member), as a standalone
 * full-height page. Reuses the same DocSurface + DocActionSet as the dashboard,
 * minus the tab strip and vault chrome — the actions sit in a slim top bar since
 * there's no tab row here. The link's capability decides read/comment/edit.
 */
export function GuestDoc({
  docId,
  capability,
  shareToken,
  tabDocs,
}: {
  docId: string;
  capability: Capability;
  shareToken: string;
  tabDocs: TabDoc[];
}) {
  const editable = capability === "owner" || capability === "editor";
  const canComment = editable || capability === "commenter";
  const [panelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<PanelTab>("comments");

  return (
    <DocClientProvider docId={docId} shareToken={shareToken}>
      <div className="flex h-svh w-full min-w-0 flex-col">
        <div className="flex h-11 shrink-0 items-center justify-end border-b px-3">
          <DocActionSet
            isOwner={false}
            docId={docId}
            tabDocs={tabDocs}
            title={tabDocs[0]?.title ?? ""}
            editable={editable}
            canComment={canComment}
            onOpenShare={() => {}}
          />
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <DocView
            docId={docId}
            capability={capability}
            tabDocs={tabDocs}
            shareToken={shareToken}
            panelOpen={panelOpen}
            panelTab={panelTab}
            onPanelTabChange={setPanelTab}
          />
        </div>
      </div>
    </DocClientProvider>
  );
}
