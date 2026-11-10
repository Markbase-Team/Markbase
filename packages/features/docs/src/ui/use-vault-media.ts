"use client";

// Media in a vault, browser side (roadmap A6).
//
// The document's markdown only ever says `![d](assets/diagram.png)` — that's what
// keeps a vault readable in Obsidian, in git, and offline. But a browser can't
// render a vault-relative path; it would resolve against the page URL and 404.
//
// So this hook owns the mapping. It loads the vault's assets, hands back a LENS
// that swaps paths for signed URLs on the way into the editor and back again on
// the way out, and an `upload` for pasted/dropped files. The lens is what keeps
// Y.Text-is-truth honest: storage never sees a URL, the editor never sees a path.

import { api } from "@markbase/protocol/api-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MediaRegistry, type AssetLink, type MarkdownLens } from "@markbase/docs";
import { cachedGet, invalidateCache } from "@markbase/ui/app-cache";
import { useLatest } from "@markbase/ui/latest-ref";

interface AssetResponse {
  assets?: Array<{ path: string; url: string | null }>;
}

export interface VaultMedia {
  /** Pass to useCrdtSync so the editor shows images instead of dead paths. */
  lens: MarkdownLens;
  /**
   * Upload a file and return the URL to insert in the editor. The editor holds
   * URLs; the lens turns them back into `assets/…` paths before they reach the
   * CRDT — so what we insert here never lands in storage verbatim.
   */
  upload: (file: File) => Promise<string | null>;
  /** True once the vault's existing assets are known. */
  ready: boolean;
  /**
   * Bumps whenever the registry learns about an asset. The asset list arrives
   * AFTER the editor first derives its content, so without a signal to re-derive,
   * images stay stuck as unresolved paths — the lens is right and the timing is
   * wrong. Callers re-derive when this changes.
   */
  version: number;
}

/**
 * `vaultId` may be null while the document loads; the lens is still safe to use —
 * it simply resolves nothing, leaving paths untouched rather than blanking them.
 */
export function useVaultMedia(vaultId: string | null): VaultMedia {
  // One registry per vault, and the SAME one for that vault's whole life: a
  // freshly pasted image must resolve immediately, so `upload` adds to the object
  // the lens is already reading.
  //
  // A reset during render rather than a useMemo keyed on vaultId, because that
  // memo never read vaultId — so the dependency looked like a mistake to anyone
  // (and anything) checking, when it was the entire point.
  const [registry, setRegistry] = useState(() => new MediaRegistry());
  const [registryVault, setRegistryVault] = useState(vaultId);
  if (registryVault !== vaultId) {
    setRegistryVault(vaultId);
    setRegistry(new MediaRegistry());
  }
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  // The lens closes over the registry, so it must not be rebuilt on every render —
  // EditorBinding holds the one it was given.
  const lens = useMemo(() => registry.lens(), [registry]);
  const registryRef = useLatest(registry);

  useEffect(() => {
    if (!vaultId) return;
    let cancelled = false;
    void (async () => {
      // Async, not synchronous: see the note in use-doc-comments.
      setReady(false);
      try {
        // Cached for the life of the app: every document in a vault resolves its
        // images against the same asset list, so mounting an editor must not
        // re-fetch it. `upload` invalidates it when a new asset lands.
        const body = await cachedGet<AssetResponse>(
          `/api/v1/assets?vault=${encodeURIComponent(vaultId)}`
        );
        if (cancelled) return;
        let added = 0;
        for (const a of body.assets ?? []) {
          if (a.url) {
            registryRef.current.add({ path: a.path, url: a.url } as AssetLink);
            added++;
          }
        }
        if (added > 0) setVersion((v) => v + 1); // tell the editor to re-resolve
      } catch {
        // Offline or a failed list: images render as broken rather than the
        // document failing to open. The paths are intact and resolve on reload.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vaultId, registryRef]);

  const upload = useCallback(
    async (file: File): Promise<string | null> => {
      if (!vaultId) return null;
      const form = new FormData();
      form.set("file", file);
      form.set("vault_id", vaultId);
      const res = await api.request("/api/v1/assets", { method: "POST", body: form });
      if (!res.ok) return null;
      const body = (await res.json()) as { asset?: { path: string; url: string | null } };
      const asset = body.asset;
      if (!asset?.url) return null;
      // Register before the URL reaches the editor, or the lens won't know how to
      // turn it back into a path and the reference would be stored as a URL.
      registryRef.current.add({ path: asset.path, url: asset.url });
      // The cached asset list predates this upload — next reader re-fetches.
      invalidateCache("/api/v1/assets");
      setVersion((v) => v + 1);
      return asset.url;
    },
    [vaultId, registryRef]
  );

  return { lens, upload, ready, version };
}
