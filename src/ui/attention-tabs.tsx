"use client";

import { useState } from "react";
import { AttentionView } from "./attention-view";
import { InboxView, UnsubscribeButton } from "@markbase/email/ui";
// Type-only, so nothing from the server entry reaches the client bundle.
import type { UnsubscribeInfo } from "@markbase/email/server";
import { cn } from "@markbase/ui/utils";
import { AppHeader, headerNoDrag } from "@markbase/ui/app-header";
import { TabBar } from "@markbase/ui/tab-bar";

type TabKey = "attention" | "inbox";

// The merged Attention view: the boards (Attention) and the Gmail Inbox as two
// tabs. Both stay mounted once opened so switching is instant and state is kept;
// the Inbox is lazy-mounted so its Gmail fetch only happens once you open it.
export function AttentionTabs() {
  const [tab, setTab] = useState<TabKey>("attention");
  const [mounted, setMounted] = useState<Record<TabKey, boolean>>({
    attention: true,
    inbox: false,
  });

  const open = (key: TabKey) => {
    setTab(key);
    if (!mounted[key]) setMounted((m) => ({ ...m, [key]: true }));
  };

  return (
    <div className="flex h-svh w-full min-w-0 flex-col">
      <AppHeader>
        <TabBar
          tabs={[
            { key: "attention", label: "Attention", onClick: () => open("attention") },
            { key: "inbox", label: "Inbox", onClick: () => open("inbox") },
          ]}
          activeKey={tab}
          className={cn("min-w-0 flex-1", headerNoDrag)}
        />
      </AppHeader>
      <div className="min-h-0 flex-1">
        {mounted.attention && (
          <div className={cn("h-full", tab !== "attention" && "hidden")}>
            {/*
              Composing the two features is attention's job (its manifest
              declares `requires: ["email"]`), not the shell's.
              The "is there anything to unsubscribe from" test stays here with
              the type that defines it: the button hides itself when there is
              nothing to do, but returning undefined keeps ReaderModal from
              rendering an empty actions slot.
            */}
            <AttentionView<UnsubscribeInfo>
              renderItemActions={({ accountId, messageId, unsubscribe }) =>
                unsubscribe.httpUrl || unsubscribe.bodyUrl || unsubscribe.mailto ? (
                  <UnsubscribeButton
                    accountId={accountId}
                    messageId={messageId}
                    info={unsubscribe}
                  />
                ) : undefined
              }
            />
          </div>
        )}
        {mounted.inbox && (
          <div className={cn("h-full", tab !== "inbox" && "hidden")}>
            <InboxView />
          </div>
        )}
      </div>
    </div>
  );
}
