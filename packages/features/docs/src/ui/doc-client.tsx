"use client";

import { api } from "@markbase/protocol/api-client";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { readLocal, writeLocal } from "./local-store";
import { setDocCrdtAccess } from "./doc-crdt-pool";

// One fetch path for everyone. Authenticated users send cookies; guests (opened
// via a share link) carry the share token + their display name as headers. The
// server resolves capability either way, so all doc components call the same
// /api/v1/docs endpoints regardless of role.

type DocClient = {
  docId: string;
  shareToken?: string;
  guestName: string;
  setGuestName: (name: string) => void;
};

const GUEST_NAME_KEY = "doc-guest-name";

const Ctx = createContext<DocClient | null>(null);

export function DocClientProvider({
  docId,
  shareToken,
  children,
}: {
  docId: string;
  shareToken?: string;
  children: React.ReactNode;
}) {
  // Read once, when the state is created. It was read in an effect instead,
  // which cost a second render to deliver a value that is never rendered — it
  // only rides along as a request header — so there is no hydration to mismatch.
  const [guestName, setGuestNameState] = useState(() =>
    shareToken ? readLocal(GUEST_NAME_KEY) ?? "" : ""
  );
  // During render, not in an effect: a child's effects run before this
  // component's, and the editor opens its document from one of them. The CRDT
  // pool reads this when that first document opens, so it has to be set by
  // then. Idempotent, and a module value rather than state — it describes the
  // page, not a render.
  setDocCrdtAccess({ shareToken: shareToken ?? null });

  const setGuestName = useCallback(
    (name: string) => {
      setGuestNameState(name);
      if (shareToken) writeLocal(GUEST_NAME_KEY, name);
    },
    [shareToken]
  );

  const value = useMemo(
    () => ({ docId, shareToken, guestName, setGuestName }),
    [docId, shareToken, guestName, setGuestName]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** api.request() that injects the share token + guest name headers when in guest mode. */
export function useDocFetch() {
  const ctx = useContext(Ctx);
  const token = ctx?.shareToken;
  const guestName = ctx?.guestName;
  return useCallback(
    (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (token) headers.set("X-Share-Token", token);
      if (guestName) headers.set("X-Guest-Name", guestName);
      return api.request(path, { ...init, headers });
    },
    [token, guestName]
  );
}
