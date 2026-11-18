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

/**
 * Whether this run claims tickets. Off unless asked for, the same default as
 * the desktop app: the ticket worker is a polling loop against the API, and
 * on a hosted API every idle ask is a billed request — a worker with nothing
 * to do was a third of what paused the Vercel account on 2026-11-17. Vault
 * sync is what `markbase start` is for on most machines; tickets are opt-in,
 * by flag (`--tickets`) or by the environment the service file sets
 * (`MARKBASE_TICKETS=on`).
 */
export function ticketsRequested(args: readonly string[], env: NodeJS.ProcessEnv = process.env): boolean {
  if (args.includes("--tickets")) return true;
  if (args.includes("--no-tickets")) return false;
  return env.MARKBASE_TICKETS === "on";
}

export async function runStart(args: readonly string[] = []): Promise<void> {
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
  if (!ticketsRequested(args)) {
    console.log("[markbase] tickets: off — vault sync only (pass --tickets, or set MARKBASE_TICKETS=on, to run them)");
    // The daemons run for the life of the process; nothing else holds it open.
    await new Promise<never>(() => {});
  }
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
