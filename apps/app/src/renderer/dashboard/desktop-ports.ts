import type { DocsPorts } from "@markbase/docs/ui";
import type { DashboardBridge } from "../../preload";

/**
 * What this machine offers the documents surface, read off the dashboard
 * window's bridge.
 *
 * The same seam as ipc-api.ts: the feature describes what it needs as ports
 * (@markbase/docs/ui/ports) and the shell hands in the implementation that fits
 * where it runs. Here that is mostly a matter of naming, because the preload
 * builds its slices to the port types — a vault, an agent, a snapshot host are
 * the main process, reached over IPC. There is no file: the dashboard's
 * documents are cloud documents, and a loose `.md` opens in its own window.
 */
export function desktopDocsPorts(bridge: DashboardBridge): DocsPorts {
  return {
    links: { openExternal: bridge.openExternal },
    vaults: bridge.vaults,
    agent: bridge.agent,
    tabMenu: bridge.tabs,
    crdt: bridge.crdt,
    localFile: null,
    forks: bridge.forks,
  };
}
