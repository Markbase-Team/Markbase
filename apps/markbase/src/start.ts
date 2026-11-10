import { runTicketWorker } from "@markbase/runner";
import { loadConfig } from "./config";
import { myMounts, startVaultSyncDaemons } from "./vault-sync-run";
import pkg from "../package.json";

// Run the worker in the foreground (claims this owner's jobs forever) AND keep
// every mounted vault syncing in the same process. Previously `start` ran only
// the ticket worker, so mounted vaults stopped syncing whenever the standalone
// `vault-sync` process died — this service now owns both, so one running
// `markbase start` keeps documents flowing to the cloud as well.
/**
 * Keep the service alive through a promise nobody caught.
 *
 * `markbase start` runs forever and claims this owner's work; a process that
 * exits claims nothing, and nothing notices — the jobs simply sit queued.
 * That is not hypothetical: an outage rejected a reconcile pass with a
 * PostgREST error object, Node's default for an unhandled rejection is to
 * throw, and the worker was gone for twenty-two hours with two tickets waiting.
 *
 * The individual leaks are fixed where they were. This is the backstop for the
 * next one, and it is loud rather than silent: the reason is printed in full,
 * because a rejection reaching here is a bug worth reading, just not one worth
 * dying over.
 */
function surviveUnhandledRejections(log: (m: string) => void): void {
  process.on("unhandledRejection", (reason) => {
    const detail =
      reason instanceof Error
        ? `${reason.message}\n${reason.stack ?? ""}`
        : // Supabase rejects with a plain object; String() would print
          // "[object Object]" and tell nobody anything.
          JSON.stringify(reason);
    log(`unhandled rejection (continuing): ${detail}`);
  });
}

export async function runStart(): Promise<void> {
  surviveUnhandledRejections((m) => console.error(`[markbase] ${m}`));
  // The worker needs the API and its key, nothing else: since security lockdown
  // stage 2 it never opens a database connection (the publishable key in this
  // config is for the vault daemons, until they move too).
  const { appUrl, apiKey, mirrorDir } = loadConfig();
  if (!apiKey) {
    console.error("No API key configured. Run `markbase login` first.");
    process.exitCode = 1;
    return;
  }
  // Fire-and-forget: the vault daemons run for the life of the process (they're
  // torn down when the service stops). A failure to start them must not take the
  // worker down.
  void startVaultSyncDaemons().catch((e) =>
    console.error(`[markbase] vault-sync failed to start: ${e instanceof Error ? e.message : String(e)}`)
  );
  await runTicketWorker({
    appUrl,
    apiKey,
    version: pkg.version,
    mirrorDir,
    // One ticket worker per machine. On a Mac that also has the desktop app,
    // whichever started first has it and the other waits — so this service
    // keeps running tickets after the app quits, and stands aside while it is
    // open, instead of both claiming the same jobs.
    lockOwner: "cli",
    // A repo scan ("Rescan paths") looks only inside this account's mounted
    // vaults; nothing else on the machine is Markbase's to read.
    discoverWithin: () => myMounts().map((v) => v.dir),
    log: (m) => console.log(`[markbase] ${m}`),
  });
}
