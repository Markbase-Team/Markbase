import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  dialog,
  shell,
  ipcMain,
  net,
  protocol,
  session,
  type IpcMainEvent,
} from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { startTicketWorkerHost, type TicketWorkerHost, type TicketWorkerStatus } from "./ticket-worker";
import { reportClaudeRun } from "@markbase/runner";
import { installTray } from "./tray";
import {
  AT_LOGIN_FLAG,
  diskFs,
  installLaunchAgent,
  launchAgentInstalled,
  launchAgentPath,
  uninstallLaunchAgent,
  type LaunchAgentSpec,
} from "./launch-agent";
import {
  becomeDefaultMarkdownOpener,
  defaultMarkdownOpener,
  shouldOfferDefaultOpener,
} from "./default-opener";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SUPABASE_KEY_DEFAULT, SUPABASE_URL_DEFAULT } from "./supabase-defaults";
import { DEFAULT_APP_URL, parseConnectLink } from "@markbase/protocol/instance";
import { connectToInstance, instanceStatus, type InstanceStatus } from "./instance";
import { awaitDeviceAuth, detectClaudeVersion } from "@markbase/node";
import {
  startVaultSync,
  listMarkdown,
  readVaultMarker,
  readVaultMarkerInfo,
  readMountedVaults,
  mountsForAccount,
  mountedByAccount,
  confirmMountAccount,
  resolveKeyOwner,
  VaultNotOursError,
  VaultGoneError,
  readUnmountedVaults,
  removeMountedVault,
  // Aliased: this file has its own unmountVault, which is the host half (menu,
  // supervisor pass). The @markbase/vault one is the registry half.
  unmountVault as tombstoneUnmount,
  migrateHome,
  markbaseHome,
  updateMountedVaults,
  VaultLockedError,
  readVaultIndex,
  docIdForFile,
  type VaultIndex,
  adoptLegacyVaults,
  readSavedInstance,
  saveInstance,
  VAULT_REGISTRY_PATH,
  type MountedVault,
  type ForeignVault,
  type VaultSyncProgress,
  type ForkControl,
  type LocalFork,
  type SharedVaultHost,
} from "@markbase/vault";
import {
  SHARED_VAULT_DIRNAME,
  SHARED_VAULT_ID,
  SHARED_VAULT_NAME,
  sanitizePathSegment,
} from "@markbase/protocol/shared-vault";
import {
  mountVault,
  folderRefusal,
  reclaimVaults,
  repointVault,
  signIn as runSignIn,
  startVaultSupervisor,
  type ReconcileDeps,
  type VaultSupervisor,
} from "@markbase/flows/node";
import { dialogOperator } from "./dialog-operator";
import { spawn as spawnPty, type IPty } from "node-pty";
import {
  configureCrdtHost,
  crdtHas,
  crdtLoad,
  crdtSave,
  crdtRelease,
  crdtReleaseAll,
} from "./crdt-host";
import {
  CliExitedError,
  openClaudeSession,
  type ClaudeSession,
  listChatSessions,
  getChatSession,
  saveChatSession,
  deleteChatSession,
  readTranscript,
  type StreamChunk,
  type ChatSessionMeta,
  failureIn,
} from "@markbase/agent";
import type { WebContents } from "electron";
import {
  claudeAuthStatus,
  claudeLogout,
  startClaudeLogin,
  type LoginHandle,
} from "./claude-auth";
import { bundledClaudePath, bundledClaudeSearchPaths } from "./claude-bin";
import type { DesktopApiRequest, DesktopApiResponse } from "./api-bridge";
import type { DesktopCredentials, WindowKind } from "./preload";
// Inlined by tsup's .html text loader — see tsup.config.ts.
import ONBOARDING_HTML from "./onboarding.html";

// The desktop app is a native window around the web app PLUS the local vault
// daemons (roadmap C1–C3).
//
// The window and the daemons never talk to each other: the renderer syncs the
// document CRDT over Supabase Realtime, and a daemon syncs that same CRDT to
// markdown files on disk. They converge through the `crdt:<docId>` channel, so
// editing in the window updates the file, and editing the file updates the
// window — with no IPC between them.
//
// Multiple vaults can be mounted at once, each to its own folder. Vaults must
// never nest: two sync roots over one file means two daemons claim it. We refuse
// an overlapping folder up front (pathsOverlap), and the marker each daemon
// writes lets the others recognise a vault that was dragged inside them.
// Where the window points and the daemons call. A packaged build talks to
// production; a dev run talks to the dev server, because a branch's API only
// exists there until it ships. APP_URL overrides both.
//
// Between the two: the instance this machine was pointed at. `markbase instance
// <url>` in the terminal, or "Connect to a team instance" in this app's
// onboarding window (SELF-HOSTING.md), saves a self-hosted instance's URL and
// the Supabase project it runs on in the registry file this app shares with the
// CLI — so a team member who joined their team's instance in either place opens
// this app on it. Read once, at launch: the window, the daemons and the renderer
// bundle must all agree on one instance for the life of the process, which is
// why changing it from the window relaunches the app (see registerInstanceIpc).
const SAVED_INSTANCE = readSavedInstance();
const APP_URL =
  process.env.APP_URL ??
  SAVED_INSTANCE?.appUrl ??
  (app.isPackaged ? DEFAULT_APP_URL : "http://localhost:3000");

// The main process configures no Supabase client (security lockdown stage 2:
// the daemons, the CRDT host and the ticket worker reach the API with this
// machine's key). The pair is still handed to every window's preload, because
// the renderer's live-edit channel is a Realtime connection to the instance's
// project — see windowArgs and supabase-defaults.ts.
const SUPABASE_URL = process.env.SUPABASE_URL ?? SAVED_INSTANCE?.supabaseUrl ?? SUPABASE_URL_DEFAULT;
const SUPABASE_KEY = process.env.SUPABASE_KEY ?? SAVED_INSTANCE?.supabaseKey ?? SUPABASE_KEY_DEFAULT;

/** Where this app points, for a menu: the host, and whether that is the hosted app or a dev override. */
function instanceLabel(): string {
  const status = instanceStatus(APP_URL, Boolean(process.env.APP_URL));
  let host = status.appUrl;
  try {
    host = new URL(status.appUrl).host;
  } catch {
    // APP_URL from the environment need not parse; show it as typed.
  }
  if (status.fromEnv) return `Instance: ${host} (APP_URL)`;
  return status.isDefault ? `Instance: ${host} (hosted app)` : `Instance: ${host}`;
}

// Two knobs for running a packaged build as a fresh user (scripts/sync-smoke.mjs).
//
// HOME moves everything Node reads from the home directory — the registry, the
// locks, ~/Markbase, the launch agent — but Electron resolves userData from the
// OS, not from HOME, so a smoke run would still read the real settings.json
// (and its key) and trip over the real single-instance lock. This moves it too,
// before anything reads it: settings, the logs and the lock all live under it.
if (process.env.MARKBASE_USER_DATA) app.setPath("userData", process.env.MARKBASE_USER_DATA);
// And a smoke run syncs a vault; it must not also claim the account's tickets
// and run them with this build's Claude.
const TICKETS_OFF = process.env.MARKBASE_TICKETS === "off";

/**
 * Daemon output, to a file as well as the console.
 *
 * A packaged app has no terminal: console.log goes nowhere a user — or we — can
 * read. So when someone says "my vault stopped syncing", the one thing that would
 * answer it is invisible. The file lives beside the settings, so it travels with
 * the install and never lands in the synced folder.
 */
function vaultLogPath(): string {
  return join(app.getPath("userData"), "vault.log");
}

function logVault(message: string): void {
  console.log(message);
  try {
    appendFileSync(vaultLogPath(), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging must never be the reason a vault fails to sync.
  }
}

/**
 * Keep the app alive through a promise nobody caught, or a throw nobody
 * expected. The worker and the vault daemons live in this process; a main
 * process that dies claims nothing and syncs nothing, and nothing notices. The
 * CLI learned this the hard way (see surviveUnhandledRejections in its start.ts:
 * one rejected reconcile pass, and no worker for twenty-two hours). Electron's
 * own answer to an uncaught exception is a modal error box that sits there
 * until someone clicks it, which is no better for a menu bar app nobody is
 * looking at. Both are logged in full — a bug worth reading, not dying over.
 */
process.on("unhandledRejection", (reason) => {
  const detail =
    reason instanceof Error ? `${reason.message}\n${reason.stack ?? ""}` : JSON.stringify(reason);
  logVault(`unhandled rejection (continuing): ${detail}`);
});
process.on("uncaughtException", (e) => {
  logVault(`uncaught exception (continuing): ${e.stack ?? e.message}`);
});

interface Settings {
  /**
   * Mounted vaults are NOT here. They live in the machine-wide registry the CLI
   * also uses (packages/core/src/vault-registry.ts) — one list, so mounting in
   * either place is visible to both. `legacyVaults` is only read once, to move
   * an older install's list over.
   */
  legacyVaults?: MountedVault[];
  /** The original field name for the same thing. Read once, then deleted. */
  vaults?: MountedVault[];
  /**
   * Legacy: the key encrypted with the OS keychain via safeStorage. No longer
   * written or read — decrypting it is what raised a login-password prompt on
   * every launch. Kept in the type so an older settings.json still parses, and
   * so `signedIn()` can tell "has a key we won't read" from "has no key".
   */
  apiKeyEnc?: string;
  /** This app's own API key (roadmap C4). Plaintext, in a 0600 file. */
  apiKey?: string;
  /**
   * Logged out here, on purpose. readApiKey falls back to the CLI's key when
   * this app has none — right for a fresh install on a machine with the CLI,
   * wrong for someone who just pressed Log out. Cleared by the next sign-in.
   */
  signedOut?: boolean;
  /**
   * The account `apiKey` belongs to (a user id), as /api/v1/me answered. The
   * mount registry is machine-wide; this is what says which of its entries are
   * this account's to sync and show. Resolved at sign-in, or lazily on the
   * first launch that can reach the API; cleared with the key.
   *
   * It exists because of 2026-10-30: this app, signed out and into a second
   * account, started a daemon for every mounted folder and uploaded the first
   * account's files as the second account's documents.
   */
  ownerId?: string;
  /**
   * When we first offered to put a cloud vault on this machine. Set whether the
   * answer was yes or no — the offer is a one-time nudge, not a recurring one.
   */
  firstMountPromptedAt?: string;
  /**
   * The invite code that came with the join link that pointed this app here.
   * The first sign-in on the new instance opens its sign-up with it, so the
   * person creates their account right there; dropped once a sign-in lands.
   */
  pendingInviteCode?: string;
  /**
   * The same code, kept: after a logout the sign-in page carries it, so
   * "Sign up" there still works — a team instance's sign-up needs it. Replaced
   * with the next join link, gone when the app connects without one.
   */
  inviteCode?: string;
  /**
   * Whether the app registers its launch agent (launch-agent.ts): opened at
   * login, relaunched after a crash. Unset means nobody has decided, and the
   * app turns it on at the first sign-in; false is the tray switch turned off,
   * which the app then respects on every launch.
   */
  startAtLogin?: boolean;
  /**
   * When the main window offered to make this app the Mac's default for
   * markdown files (default-opener.ts). Set whatever the answer was — the
   * offer is made once, after the first sign-in, not on every launch.
   */
  defaultOpenerOfferedAt?: string;
}

interface CloudVault {
  id: string;
  name: string;
}

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

/**
 * The app's own settings. Returns the file AS READ — it used to return only
 * `{ vaults }`, so every writer that did load-modify-save silently dropped the
 * encrypted API key alongside it.
 */
function loadSettings(): Settings {
  try {
    return JSON.parse(readFileSync(settingsPath(), "utf8")) as Settings;
  } catch {
    return {};
  }
}

function saveSettings(s: Settings): void {
  mkdirSync(dirname(settingsPath()), { recursive: true });
  // 0600 — it holds an API key. This file used to be world-readable while the
  // key inside it was encrypted, which is the wrong way round: the permission
  // bits are what actually keep another account on the machine out.
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2), { mode: 0o600 });
}

/**
 * Whose documents to sync: this app's own key first, then the `markbase` CLI's.
 *
 * The CLI fallback is kept deliberately — a machine already set up with the CLI
 * keeps working exactly as it did — but it is now the LAST resort rather than the
 * only option, so the desktop app is no longer a guest in the CLI's account.
 *
 * Not MARKBASE_API_KEY. That variable is the HTTP API's contract for agents and
 * scripts — the skill, the MCP server, the install script, the CLI — and an
 * account someone signed into here must not be overridden by whatever a shell
 * happens to export for those.
 */
function readApiKey(): string | null {
  const own = readOwnKey();
  if (own) return own;
  // Logged out of this app: the CLI's key is not a way back in.
  if (loadSettings().signedOut) return null;
  try {
    const cfg = JSON.parse(
      readFileSync(VAULT_REGISTRY_PATH, "utf8")
    ) as { apiKey?: string };
    return cfg.apiKey ?? null;
  } catch {
    return null;
  }
}

/**
 * The account the current key belongs to, or null while it is not known.
 *
 * Null is "not yet", never "nobody": mountsForAccount hides nothing on null, and
 * the daemon's own check — which also asks /me — is what decides then.
 */
function currentOwnerId(): string | null {
  return loadSettings().ownerId ?? null;
}

/**
 * Ask the API whose key this is and write it down, if it is not known yet.
 * Called at launch and after every sign-in. Returns the account, or null when
 * the API could not say (offline) — the supervisor pass that follows will try
 * again, since every pass runs this first.
 */
async function rememberOwnerId(): Promise<string | null> {
  const known = currentOwnerId();
  if (known) return known;
  const apiKey = readApiKey();
  if (!apiKey) return null;
  const owner = await resolveKeyOwner(APP_URL, apiKey);
  if (!owner) return null;
  const s = loadSettings();
  // Written down only for this app's OWN key, and only if it is still the key
  // we asked about. A key borrowed from the CLI (readApiKey's fallback) is the
  // CLI's to re-login at any time, so its owner is answered but never cached.
  if (s.apiKey !== apiKey) return owner;
  s.ownerId = owner;
  saveSettings(s);
  logVault(`signed in as account ${owner}`);
  return owner;
}

/**
 * The mounts that are this account's to sync and to show. Every place that
 * used to read the registry whole reads this instead: the supervisor, the
 * menus, the tray, the vault list over IPC, the cloud-deletion check. A folder
 * mounted by another account on this machine is left exactly as it is — not
 * synced, not trashed, not listed.
 */
function myMounts(): MountedVault[] {
  return mountsForAccount(readMountedVaults(), currentOwnerId());
}

/**
 * Sign this app in, in a window of its own.
 *
 * The same loopback flow `markbase login` uses — but opened HERE, where the user
 * is already signed in, so authorizing is one click rather than a terminal
 * command. The key is bound to whoever the browser session says they are, which
 * is what makes the daemon and the window the same person by construction.
 */
/**
 * The sign-in currently in flight, if any.
 *
 * A boolean used to live here, and a second attempt was simply refused while it
 * was set — which meant a stuck flow could only be cleared by a clock. Holding
 * the controller instead lets a new attempt SUPERSEDE the old one, which is what
 * a person retrying actually wants, and is what allows the timeout to stop being
 * a deadline anyone is expected to meet.
 */
let signInAttempt: AbortController | null = null;

/** Stop any sign-in in progress — a retry, a closing window, or quitting. */
function cancelSignIn(): void {
  signInAttempt?.abort();
  signInAttempt = null;
}

/**
 * Sign in through the real, branded /login — shown IN the window, same as web.
 *
 * awaitDeviceAuth starts a loopback and hands us the /cli-auth authorize URL; we
 * point the window's /login at it via ?next, so both paths route home:
 *   • Email — signed in the window, then /login pushes to /cli-auth → approve →
 *     the window navigates to the loopback. All in-window; email needs no browser.
 *   • Google — the button (seeing it's in Electron) opens the SYSTEM browser at
 *     Google's OAuth URL, whose redirect chain runs /auth/callback → /cli-auth →
 *     approve → loopback. Google refuses to render embedded, so it MUST be the
 *     real browser; the window.open is caught by setWindowOpenHandler.
 * Either way the loopback resolves here with the key (+ a session for the window).
 */
async function signIn(question?: {
  action: string;
  detail?: string;
  confirmLabel?: string;
}): Promise<boolean> {
  // Retrying supersedes rather than bounces. Asking to sign in while an attempt
  // is open means the earlier one is being abandoned — the user is standing right
  // there saying so — and the old loopback should close rather than hold the flag
  // until a timer decides otherwise.
  cancelSignIn();
  const attempt = new AbortController();
  signInAttempt = attempt;
  try {
    const res = await runSignIn({
      // Asks with a dialog, reports through the log. A failure is logged, never
      // shown: a message box with no window behind it runs as a native modal
      // that holds the whole main process — window blank, quit refused — until
      // someone finds and dismisses it. The sign-in page is already on screen,
      // and pressing Sign in again is the retry.
      operator: {
        ...dialogOperator({
          showMessageBox: (r) => dialog.showMessageBox(r),
          showOpenDialog: (r) => dialog.showOpenDialog(r),
          log: logVault,
        }),
        reportEvent: (e) => logVault(`${e.level}: ${e.message}`),
      },
      // Deliberately null: this function means "sign in now". Whether a key
      // already exists is the caller's question, and the menu item exists to
      // replace one.
      readKey: () => null,
      storeKey: storeApiKey,
      deviceAuth: ({ open, wantSession }) =>
        awaitDeviceAuth({
          appUrl: APP_URL,
          wantSession,
          // The browser page should finish on its own and say "Sign in", not
          // "Connect the markbase CLI" with an Authorize button.
          desktop: true,
          // How this ends: the browser comes back, or something cancels it — a
          // retry, Log out, the window closing, quit. No clock, not even the
          // backstop: a person signing in through a browser has no predictable
          // duration, and an attempt that expired left this window wired to a
          // loopback nobody was listening on, so the browser landed on a dead
          // address and the app sat on /login as if nothing had happened.
          signal: attempt.signal,
          timeoutMs: null,
          // Same machine as the CLI — detect Claude Code so the key records it
          // and the page does not wrongly report it missing.
          claudeVersion: detectClaudeVersion(),
          open,
        }),
      openAuthPage: (authUrl) => {
        // authUrl = ${APP_URL}/cli-auth?callback=…&state=…&claude=…&desktop=1.
        // Send the window to the branded /login, wired to finish at that /cli-auth.
        const next = `/cli-auth${new URL(authUrl).search}`;
        // Pointed here by a join link that carried an invite code: the person
        // has no account on this instance yet, so start at its sign-up, which
        // creates one for the code and continues to the same /cli-auth. After
        // that (a logout, say) it is the login, carrying the code so its
        // "Sign up" still leads somewhere on a team instance.
        const { pendingInviteCode, inviteCode } = loadSettings();
        const q = `next=${encodeURIComponent(next)}`;
        const login = pendingInviteCode
          ? `${APP_URL}/signup?code=${encodeURIComponent(pendingInviteCode)}&${q}`
          : inviteCode
            ? `${APP_URL}/login?code=${encodeURIComponent(inviteCode)}&${q}`
            : `${APP_URL}/login?${q}`;
        // The documents window, not whichever window was made first: with a
        // file open in a viewer, [0] is the viewer, and the login page landed
        // in an 820px read-only window while the main one kept saying Sign in.
        void (appWindow() ?? BrowserWindow.getAllWindows()[0])?.loadURL(login);
      },
      // The window used to need a site session too; it now renders the
      // documents surface itself and reaches the API with the key, so the
      // daemon's credential is the only one there is.
      wantSession: false,
      // Naming the real location matters: this line is what someone reads when
      // they go looking for where the credential went.
      keyLocation: settingsPath(),
      // No dialog unless a caller brings a real question. The person already
      // chose — pressed Sign in, picked it from the menu, or the window has no
      // key and the sign-in page is the only thing it can show. The old
      // default put "Sign in to Markbase?" in a modal first, and on macOS that
      // modal holds the whole main process: window blank, quit ignored, until
      // someone finds the dialog.
      question: question ?? null,
    });

    if (!res.ok) {
      // Cancelled is not failed — the user retried, closed the window, or quit,
      // and there is nobody to tell. A real failure (the key could not be
      // activated, say) is already in vault.log via the operator above; what
      // the person needs is a sign-in page that still works. The one on screen
      // is wired to the loopback this attempt just closed, so send the window
      // to the bare /login: landing there starts a fresh attempt (see
      // did-navigate), and the page comes back wired to a port that answers.
      if (res.reason === "failed") void appWindow()?.loadURL(`${APP_URL}/login`);
      return false;
    }

    // Whose key is this now? Settled before any vault is started under it, so
    // the supervisor's first pass already knows which mounts are this
    // account's. Then the daemons: a sign-in may be a different account, and
    // daemons started under the previous key hold that key. Stop them all and
    // start again from what the registry says is THIS account's — never the
    // other one's folders (2026-10-30).
    const previous = currentOwnerId();
    await rememberOwnerId();
    invitePendingDone();
    void offerFirstMount().catch(() => {});
    if (supervisorStopped || previous !== currentOwnerId()) {
      supervisorStopped = false;
      void restartSupervisor();
    } else {
      // Vaults that found no key on the last pass start now, not on the next.
      void reconcileMounts();
    }
    // The flow borrowed the window for the site's /login; hand it back to the
    // documents surface, which now has a key to read with — and bring the app
    // forward: the sign-in finished in the system browser, which is what is on
    // screen now, and "it stays in the browser" is how that looked.
    const win = appWindow();
    if (win) {
      await win.loadURL(HOME_URL);
      win.show();
      win.focus();
    }
    app.focus({ steal: true });
    return true;
  } finally {
    // Only clear it if it is still OURS — a newer attempt has already taken the
    // slot, and wiping it here would leave that one uncancellable.
    if (signInAttempt === attempt) signInAttempt = null;
  }
}

/**
 * The app's API key, in a file only this user can read. No OS keychain.
 *
 * It WAS encrypted with safeStorage, and that bought nothing. The `markbase` CLI
 * keeps the very same key in plaintext at ~/.config/markbase/config.json, and
 * this app falls back to reading it — so the "stolen disk" the encryption was
 * defending against just reads the copy next door. Meanwhile settings.json was
 * being written world-readable (0644) while its contents were ciphertext, which
 * is the protection exactly backwards.
 *
 * What it DID cost was a macOS password prompt on launch. Keychain ACLs are
 * granted per code signature, and this app is ad-hoc signed — a signature that
 * changes with every build — so "Always Allow" can never stick and every update
 * asks again. A prompt the user cannot make go away, guarding a secret that is
 * already in the clear elsewhere, is worse than no prompt.
 *
 * So: plaintext at 0600, which is what the CLI has always done, and what the
 * permission bits are for. A stable Developer ID signature would make the
 * keychain viable again; until then this is the honest trade.
 */

function storeApiKey(key: string): void {
  const s = loadSettings();
  delete s.apiKeyEnc; // retire any ciphertext from the keychain era
  delete s.signedOut;
  // A new key may be a new account: whose it is gets asked again (see
  // rememberOwnerId), and until then no mount is filtered out — nor started,
  // because the supervisor is restarted on sign-in and asks before each one.
  if (s.apiKey !== key) delete s.ownerId;
  s.apiKey = key;
  saveSettings(s); // 0600
  // Tickets start under the new key now, not at the worker loop's next tick.
  ticketWorker?.poke();
  // And keep starting after the next reboot.
  ensureLaunchAgent();
}

/** Forget the key, and remember that this was asked for (see Settings.signedOut). */
function clearApiKey(): void {
  const s = loadSettings();
  delete s.apiKey;
  delete s.apiKeyEnc;
  delete s.ownerId;
  s.signedOut = true;
  saveSettings(s);
}

/** Keep (or drop, with null) the invite code this app joins with: the next
 *  sign-in offers to create an account with it, later ones carry it. */
function setPendingInvite(code: string | null): void {
  const s = loadSettings();
  if (code) {
    s.pendingInviteCode = code;
    s.inviteCode = code;
  } else {
    delete s.pendingInviteCode;
    delete s.inviteCode;
  }
  saveSettings(s);
}

/** A sign-in landed: the account exists, so the next sign-in is a login. */
function invitePendingDone(): void {
  const s = loadSettings();
  if (!s.pendingInviteCode) return;
  delete s.pendingInviteCode;
  saveSettings(s);
}

/*
 * The launch agent (launch-agent.ts). Only a packaged Mac build has an app
 * bundle worth opening at login — `npm start` would register Electron's own
 * binary in node_modules — and only a signed-in one has anything to run there.
 */

/** Launched by the agent: come up in the menu bar, without a window. */
function launchedAtLogin(): boolean {
  return process.argv.includes(AT_LOGIN_FLAG);
}

function canHaveLaunchAgent(): boolean {
  return process.platform === "darwin" && app.isPackaged;
}

function launchAgentSpec(): LaunchAgentSpec {
  return { execPath: process.execPath, logPath: join(app.getPath("userData"), "launchd.log") };
}

/**
 * On every launch and every sign-in: register the agent unless the switch was
 * turned off. Idempotent — the plist is rewritten only when it would differ,
 * which is how an app that moved gets its agent pointed at the new place.
 */
function ensureLaunchAgent(): void {
  if (!canHaveLaunchAgent() || !signedIn()) return;
  const s = loadSettings();
  if (s.startAtLogin === false) return;
  try {
    const result = installLaunchAgent(launchAgentSpec(), launchAgentPath(), diskFs);
    if (result !== "unchanged") logVault(`launch agent ${result}: opens at login, relaunched after a crash`);
    if (s.startAtLogin === undefined) {
      s.startAtLogin = true;
      saveSettings(s);
    }
  } catch (e) {
    logVault(`couldn't register the launch agent: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The tray switch. */
function setStartAtLogin(on: boolean): void {
  const s = loadSettings();
  s.startAtLogin = on;
  saveSettings(s);
  try {
    if (on) {
      installLaunchAgent(launchAgentSpec(), launchAgentPath(), diskFs);
      logVault("launch agent installed from the tray: opens at login, relaunched after a crash");
    } else {
      uninstallLaunchAgent(launchAgentPath(), diskFs);
      logVault("launch agent removed from the tray: nothing opens Markbase at the next login");
    }
  } catch (e) {
    logVault(`couldn't ${on ? "register" : "remove"} the launch agent: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * The app's own key.
 *
 * A leftover `apiKeyEnc` is deliberately NOT decrypted. Reading it is precisely
 * the call that raises the macOS password prompt, and doing that on launch is
 * what we set out to stop — so an install from the keychain era falls through to
 * the CLI's key, or signs in again, either of which replaces it with plaintext
 * on the next write. Silently, except for one log line: a key we are choosing
 * not to read should not look like a key that was never there.
 */
let saidLegacyKey = false;
function readOwnKey(): string | null {
  const s = loadSettings();
  if (s.apiKey) return s.apiKey;
  // Once. readApiKey runs per vault and on every remount, so an unguarded line
  // here repeats for as long as the app is open.
  if (s.apiKeyEnc && !saidLegacyKey) {
    saidLegacyKey = true;
    logVault(
      "found an old keychain-encrypted key — ignoring it (it would prompt for your " +
        "login password). Sign in again to replace it."
    );
  }
  return null;
}

/**
 * The loop that makes the registry true — see @markbase/flows.
 *
 * This replaces the map of stop handles the file used to keep. Mounting and
 * unmounting now edit the registry and ask for a pass; the supervisor decides
 * what that means for running daemons. The CLI daemon runs the same loop, which
 * is what stops a vault unmounted in one client from syncing on in the other.
 *
 * Created at launch, not here: a pass reads the registry and starts daemons,
 * and none of that may happen before the app is ready.
 */
let supervisor: VaultSupervisor | null = null;

/**
 * The ticket worker — see ticket-worker.ts. One loop for the life of the app;
 * it runs a worker while there is a key and stands down while there is not,
 * so Log out and sign-in are things it notices rather than things it is told.
 */
let ticketWorker: TicketWorkerHost | null = null;

/** Ask for a pass, after this process has changed the registry itself. */
async function reconcileMounts(): Promise<void> {
  await supervisor?.reconcile();
}

// ---- The Shared Vault's forks (docs/shared-vault.md) -------------------------
// Documents shared with this person read-only whose file they edited anyway.
// The daemon keeps the edits as a live fork and tells us; we tell the person —
// a native notification the first time each one appears, since the app runs
// without its window — and keep the list for the tray and the window's banner.

/** The running Shared Vault daemon's handle on its forks; null while none runs. */
let forkControl: ForkControl | null = null;
let sharedForks: LocalFork[] = [];

function broadcastForks(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("markbase:shared-forks-changed", sharedForks);
  }
}

/** One notification per fork, the first time it is ever seen (the daemon says which). */
function notifyFork(f: LocalFork): void {
  // Logged either way: a notification leaves no trace once dismissed, and
  // "did it fire" is the first question when a fork went unnoticed.
  logVault(
    `[${SHARED_VAULT_NAME}] ${Notification.isSupported() ? "notifying" : "cannot notify (unsupported here)"}: ` +
      `"${f.title}" has local-only edits (${f.path})`
  );
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: "Local-only edits",
    body: `"${f.title}" is shared with you read-only. Your edits to ${f.path} stay on this Mac.`,
  });
  n.on("click", showMainWindow);
  n.show();
}

function sharedVaultHost(): SharedVaultHost {
  return {
    onForks: (forks, fresh) => {
      sharedForks = forks;
      for (const f of fresh) notifyFork(f);
      broadcastForks();
    },
    attach: (control) => {
      forkControl = control;
    },
  };
}

/** The Shared Vault's daemon stopped: nothing to act on until the next one. */
function forgetForks(): void {
  forkControl = null;
  if (sharedForks.length > 0) {
    sharedForks = [];
    broadcastForks();
  }
}

/** Where the Shared Vault goes unless the person picks somewhere else. */
function defaultSharedVaultDir(): string {
  return join(homedir(), "Markbase", SHARED_VAULT_DIRNAME);
}

/**
 * Remount what was mounted last run, and keep doing it. The supervisor starts
 * a daemon per mounted vault, stops the ones that go away, and takes over a
 * vault the CLI service was holding once that process exits. Started at
 * launch, and again after a sign-out stopped it — a stopped loop stays
 * stopped, so a new one is how syncing resumes under the next key.
 */
function startSupervisor(): VaultSupervisor {
  const all = readMountedVaults().length;
  const mine = myMounts().length;
  logVault(
    `starting — ${mine} vault(s) mounted for this account` +
      (all > mine ? ` (${all - mine} mounted by another account, left alone)` : "") +
      `, app at ${APP_URL}`
  );
  supervisor = startVaultSupervisor({
    // Only this account's mounts are ever declared to the loop, so a folder
    // another account mounted is never started, whatever key is in use.
    readMounted: myMounts,
    startSync: startVaultDaemon,
    log: logVault,
    // Also how a registry edited by the CLI reaches this process: nothing sends
    // us word, so looking again is the only way to find out.
    retryMs: 10_000,
  });
  return supervisor;
}

/** Whether a sign-out stopped the loop; the next sign-in starts a fresh one. */
let supervisorStopped = false;

/**
 * Stop every daemon and start the loop again under the current key. A daemon
 * holds the key it was started with, so a sign-in as a different account must
 * not leave the previous account's daemons running beside the new one's.
 */
async function restartSupervisor(): Promise<void> {
  const running = supervisor;
  supervisor = null;
  if (running) {
    await running.stop().catch((e) =>
      logVault(`stopping the vault daemons: ${e instanceof Error ? e.message : String(e)}`)
    );
  }
  await startSupervisor().settled();
  buildMenu();
}

/**
 * Log this app out: forget the key, stop syncing, and clear the site session.
 *
 * The footer used to offer "Switch account", which ran the sign-in flow — but
 * the window still held the site's session cookie, so /login re-authorised the
 * same account without showing a form, and nothing visibly happened. Logging
 * out is the honest action: the files stay on disk, nothing syncs until the
 * next sign-in, and that sign-in starts from the login form.
 */
async function signOut(): Promise<void> {
  cancelSignIn();
  clearApiKey();
  const running = supervisor;
  if (running) {
    supervisorStopped = true;
    // Not awaited. A daemon's stop waits out whatever request it is in the
    // middle of, and right after launch that is a first pass over every vault
    // — the first Log out took 21 seconds to answer, during which the window
    // just sat there. The key is already gone, which is the part that matters;
    // the daemons wind down behind the signed-out screen.
    void running
      .stop()
      .then(() => logVault("vault daemons stopped"))
      .catch((e) => logVault(`stopping the vault daemons: ${e instanceof Error ? e.message : String(e)}`));
  }
  // Tickets stop with the key: a job in flight is abandoned for the next
  // worker to reclaim, and nothing further is claimed under a key we no longer
  // hold. The loop itself stays up, waiting for the next sign-in.
  ticketWorker?.stopRun();
  try {
    await session.defaultSession.clearStorageData({
      origin: APP_URL,
      storages: ["cookies", "localstorage"],
    });
  } catch (e) {
    logVault(`couldn't clear the site session: ${e instanceof Error ? e.message : String(e)}`);
  }
  logVault("signed out — vaults stay on disk and sync again after the next sign-in");
  buildMenu();
}

/** Vaults we have already said are missing — one dialog, not one per pass. */
const warnedMissing = new Set<string>();

/**
 * A daemon found another vault sitting inside its folder, and its marker told us
 * which vault it is and where it landed.
 *
 * This is the ONE case where a folder moved in Finder is knowable. Nothing else
 * observes a move: the kernel renames a directory without touching what's inside,
 * and if the app wasn't running there's no trace at all. Here the vault was
 * dragged into a tree we watch, so it announced itself — offer the repair instead
 * of leaving the user to hunt for a vault we already found.
 */
async function offerRepoint(found: ForeignVault, insideName: string): Promise<void> {
  const repointed = await repointVault(
    { vaultId: found.vaultId, dir: found.dir },
    insideName,
    reconcileDeps()
  );
  // The menu lists mounted vaults and where they are, so it is stale the moment
  // one moves. Stays here: the flow knows nothing about menus.
  if (repointed) buildMenu();
}

/** What the shared reconcile flows need from this host. */
function reconcileDeps(): ReconcileDeps {
  return {
    operator: dialogOperator({
      showMessageBox: (r) => dialog.showMessageBox(r),
      showOpenDialog: (r) => dialog.showOpenDialog(r),
      log: logVault,
    }),
    readMounted: myMounts,
    readUnmounted: readUnmountedVaults,
    updateMounted: updateMountedVaults,
    markerOf: readVaultMarker,
    markerOwnerOf: (dir) => readVaultMarkerInfo(dir)?.ownerId ?? null,
    keyOwner: currentOwnerId,
    listCloudVaults: fetchCloudVaults,
    // Registration only. The flow's job ends when the registry says where the
    // vault lives; the supervisor is what turns that into a running daemon.
    startSync: () => {
      void reconcileMounts();
    },
    listSubdirs: (dir) =>
      existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => join(dir, e.name))
        : [],
    defaultHome: join(homedir(), "Markbase"),
  };
}

/**
 * Push sync progress to the window, at most a few times a second.
 *
 * The daemon calls onProgress once per file — hundreds of times a minute on a
 * real vault — and each send crosses a process boundary and re-renders the tree.
 * Throttling here rather than in the renderer keeps the IPC quiet at the source.
 * The final tick of a phase always goes through, so a listener never sits on a
 * stale "497 of 500".
 */
const lastProgressAt = new Map<string, number>();
function sendVaultProgress(vaultId: string, p: VaultSyncProgress): void {
  const done = p.done >= p.total;
  const now = Date.now();
  if (!done && now - (lastProgressAt.get(vaultId) ?? 0) < 400) return;
  lastProgressAt.set(vaultId, now);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("markbase:vault-progress", { vaultId, ...p });
  }
}

/**
 * Tell the window this vault's document set changed, coalescing a burst.
 *
 * This process adopts the file and knows the moment it becomes a document, but
 * the renderer's document list is an app-lifetime cache refreshed only when the
 * window regains focus, throttled to once a minute. So a folder an agent wrote
 * showed up minutes later — or not until you clicked away and back, which is not
 * a thing anyone should have to discover.
 *
 * Coalesced rather than throttled: adopting a folder fires once per file, and
 * what the renderer needs is one refetch after the burst, not a refetch per file
 * racing the writes. The trailing edge is the one that carries the full set.
 */
const docsChangedTimers = new Map<string, ReturnType<typeof setTimeout>>();
function sendVaultDocsChanged(vaultId: string): void {
  clearTimeout(docsChangedTimers.get(vaultId));
  docsChangedTimers.set(
    vaultId,
    setTimeout(() => {
      docsChangedTimers.delete(vaultId);
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send("markbase:vault-docs-changed", { vaultId });
      }
    }, 500)
  );
}

/**
 * Extensions macOS would RUN rather than open. A document is data, and following
 * a link inside one must not start a program — the document may have arrived over
 * sync from another machine, or from someone else's shared vault.
 */
const NEVER_OPEN = new Set([
  ".app", ".command", ".sh", ".bash", ".zsh", ".scpt", ".applescript",
  ".terminal", ".workflow", ".pkg", ".dmg", ".jar", ".osascript",
]);

/** Open a local file with whatever the user's Mac uses for it. */
async function openLocalFile(fileUrl: string): Promise<void> {
  let path: string;
  try {
    path = fileURLToPath(fileUrl);
  } catch {
    logVault(`can't open ${fileUrl} — not a usable file URL`);
    return;
  }
  const ext = extname(path).toLowerCase();
  if (NEVER_OPEN.has(ext)) {
    logVault(`refused to open ${path} — a ${ext} would be run, not opened`);
    return;
  }
  // Say WHICH file is missing. A link written months ago points at a file that
  // may have moved, and "nothing happened" is the least useful answer possible.
  if (!existsSync(path)) {
    logVault(`can't open ${path} — no such file`);
    return;
  }
  const failure = await shell.openPath(path);
  if (failure) logVault(`couldn't open ${path}: ${failure}`);
}


/**
 * Start one vault's daemon and hand back its stop handle.
 *
 * Throws rather than swallowing, because the supervisor owns what a failure
 * means. A locked vault is not a failure at all: another Markbase process has
 * it — almost always the `markbase` CLI service, which is a supported setup and
 * the one that keeps syncing when this window is closed. The supervisor keeps
 * the vault desired and takes it over when that process lets go, which is what
 * this file could never do on its own.
 */
async function startVaultDaemon(v: MountedVault): Promise<() => Promise<void>> {
  // Nothing on disk is touched until two things are settled: there is a key,
  // and the vault is this key's account's. The folder used to be checked
  // first — and three of this machine's vault folders live under ~/Documents,
  // so a launch with no key yet, or signed into a different account, had macOS
  // asking whether Markbase may read Documents on behalf of vaults it was
  // never going to start. The person chooses what folders to mount; a folder
  // mounted by another account on this machine is not one of them.
  const apiKey = readApiKey();
  if (!apiKey) {
    // Nothing to ask here: a window with no key is already on the sign-in
    // page, and a successful sign-in asks for a pass, which starts every
    // waiting vault. This used to put up its own "Sign in to sync your
    // vaults" dialog on top — a second question with one answer.
    throw new Error("no API key — not syncing");
  }

  // Whose vault is this, and is it this key's? Settled BEFORE a daemon exists
  // for it, from the registry and the API — not from the folder. myMounts
  // already hid every mount recorded for another account; this is for the
  // ones recorded for nobody yet (mounted before owners were written down):
  // the API is asked, the answer is recorded, and a vault that is not this
  // account's is never started. "Not yet" (offline) is a retry on the
  // supervisor's next pass, not a start.
  const owner = await confirmMountAccount(v, {
    appUrl: APP_URL,
    apiKey,
    keyOwner: await rememberOwnerId(),
  });
  if (owner === null) throw new Error("couldn't confirm which account this vault belongs to yet — not syncing until it can");

  if (!existsSync(v.dir)) {
    // The folder moved or was deleted while we weren't running. Recreating it at
    // the old path, or adopting whatever is there now, would both be worse than
    // saying so — but say it once, not on every pass.
    if (!warnedMissing.has(v.vaultId)) {
      warnedMissing.add(v.vaultId);
      void dialog.showMessageBox({
        type: "warning",
        message: `"${v.name}" isn't where it used to be`,
        detail: `${v.dir} is gone. Mount the vault again to point it at its new home.`,
      });
    }
    throw new Error(`${v.dir} is gone`);
  }
  warnedMissing.delete(v.vaultId);

  try {
    const isShared = v.vaultId === SHARED_VAULT_ID;
    const stop = await startVaultSync({
      lockOwner: "desktop app",
      dir: v.dir,
      vaultId: v.vaultId,
      appUrl: APP_URL,
      apiKey,
      ownerId: owner,
      log: (m: string) => logVault(`[${v.name}] ${m}`),
      onProgress: (p) => sendVaultProgress(v.vaultId, p),
      onDocsChanged: () => sendVaultDocsChanged(v.vaultId),
      onForeignVault: (found) => void offerRepoint(found, v.name),
      sharedHost: isShared ? sharedVaultHost() : undefined,
    });
    if (!isShared) return stop;
    return async () => {
      await stop();
      forgetForks();
    };
  } catch (e) {
    // A modal on every launch would be noise for the one expected failure.
    // Another account's vault is not this account's problem to be told about
    // either: it is logged, and the folder is left exactly as it is. A vault
    // that is gone gets its dialog from reconcileVaults, which retires it.
    if (!(e instanceof VaultLockedError) && !(e instanceof VaultNotOursError) && !(e instanceof VaultGoneError)) {
      void dialog.showMessageBox({
        type: "error",
        message: `Couldn't sync "${v.name}"`,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
    throw e;
  }
}

/**
 * The account's vaults, or null when the answer cannot be trusted.
 *
 * `null` and `[]` were the same value here, and that conflation unmounted a
 * vault: `body.vaults ?? []` turns a 200 with a missing or malformed field into
 * "you have no vaults", and the caller treats every mounted vault as deleted.
 * Missing key, not-ok, unparseable, not an array — all of them are "I don't
 * know", and none of them is "they're gone".
 */
async function fetchCloudVaults(): Promise<CloudVault[] | null> {
  const apiKey = readApiKey();
  if (!apiKey) return null;
  try {
    const res = await fetch(`${APP_URL}/api/v1/vaults`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { vaults?: CloudVault[] };
    return Array.isArray(body.vaults) ? body.vaults : null;
  } catch {
    return null;
  }
}

/**
 * Has this vault really gone — as opposed to being missing from one list?
 *
 * Asks about the vault itself. A 404 is an answer: the vault no longer exists.
 * A 403 is a different answer — it exists and is another account's — and that
 * one leaves the folder exactly as it is (another account's files are not ours
 * to retire; the server says which it is, so this never has to guess). A
 * timeout, a 500 or a 200 are not answers, and each of those leaves the vault
 * mounted. This is the difference between "the server told me it is deleted"
 * and "the server did not mention it", which is the whole distinction the
 * unmount path was missing.
 */
async function confirmVaultDeleted(vaultId: string): Promise<boolean> {
  const apiKey = readApiKey();
  if (!apiKey) return false;
  try {
    const res = await fetch(`${APP_URL}/api/v1/vaults/${encodeURIComponent(vaultId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return res.status === 404;
  } catch {
    return false; // offline is not a deletion
  }
}

/**
 * Mount a vault: pick which one, then where it lives. The folder is refused if it
 * overlaps an already-mounted vault — nesting sync roots is the one thing that
 * genuinely corrupts (two daemons claiming one file), and it's far kinder to stop
 * it here than to detect it later.
 */
async function addVault(): Promise<void> {
  const cloud = await fetchCloudVaults();
  if (cloud === null) {
    void dialog.showMessageBox({
      type: "error",
      message: "Couldn't load your vaults",
      detail: "The app couldn't reach the server, or the answer wasn't usable. Try again in a moment.",
    });
    return;
  }
  const mounted = myMounts();
  const choices = cloud.filter((c) => !mounted.some((m) => m.vaultId === c.id));
  if (choices.length === 0) {
    void dialog.showMessageBox({
      type: "info",
      message: "Every vault is already mounted",
      detail: "Create another vault on the web to mount it here.",
    });
    return;
  }

  const pick = await dialog.showMessageBox({
    type: "question",
    message: "Which vault do you want on this machine?",
    buttons: [...choices.map((c) => c.name), "Cancel"],
    cancelId: choices.length,
  });
  if (pick.response === choices.length) return;
  const chosen = choices[pick.response];
  await mountVaultToFolder(chosen.id, chosen.name, mounted.length === 0);
}



/**
 * Re-adopt vault folders that are already sitting in the default home.
 *
 * The registry is the app's memory of what is mounted, and it is not the only
 * record: every vault folder carries a marker naming the vault it holds. When the
 * two disagree — a reset registry, a reinstall, a config copied from another
 * machine — the folder is right and the app is the one that forgot.
 *
 * Without this the app offers to mount a vault whose files are already on disk,
 * and accepting with a DIFFERENT folder leaves one vault with two homes.
 *
 * Only ~/Markbase/* is scanned: one level, the default location the picker
 * proposes. Searching the whole disk for markers would be slow and presumptuous —
 * a vault deliberately put elsewhere is the user's to point at again.
 */
async function reclaimVaultsAtDefaultHome(): Promise<number> {
  const reclaimed = await reclaimVaults(reconcileDeps());
  if (reclaimed > 0) buildMenu();
  return reclaimed;
}

/**
 * Offer to put a cloud vault on this Mac, once, on a machine that has none.
 *
 * The gap this closes: someone who created vaults in the browser and then
 * downloaded the desktop app got a window showing all their documents — from the
 * cloud, in the embedded web app — and no folder anywhere. It looked identical to
 * the website, which is to say it looked like the app did nothing. `addVault` has
 * done exactly the right thing all along; it just had a single caller, a menu item
 * a new user has no reason to open.
 *
 * Asked once (recorded either way). Someone who says no has said no; the menu is
 * still there, and mounting from the web New Vault modal still works.
 */
async function offerFirstMount(): Promise<void> {
  if (myMounts().length > 0) return; // already has a folder here
  if (loadSettings().firstMountPromptedAt) return; // asked before
  if (!readApiKey()) return; // not signed in yet — signIn calls us again

  // The folder may already be here even though the registry forgot. Asking in
  // that case invites a second home for one vault.
  if ((await reclaimVaultsAtDefaultHome()) > 0) return;

  // Offline or an unusable answer: this is a nicety, never an error.
  const cloud = await fetchCloudVaults();
  if (cloud === null) return;
  if (cloud.length === 0) return; // nothing to mount; the web modal covers this

  const s = loadSettings();
  s.firstMountPromptedAt = new Date().toISOString();
  saveSettings(s);

  logVault(`no vault is on this machine — offering to mount one of ${cloud.length}`);
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Choose a folder…", "Not now"],
    defaultId: 0,
    cancelId: 1,
    message: "Keep your documents as files on this Mac",
    detail:
      `You have ${cloud.length} vault${cloud.length === 1 ? "" : "s"} in the cloud. ` +
      `Pick one and choose a folder, and every document in it becomes a .md file there — ` +
      `editable in Obsidian or any editor, and synced both ways.\n\n` +
      `You can do this later from the Vaults menu.`,
  });
  if (response !== 0) {
    logVault("first mount declined — the Vaults menu still offers it");
    return;
  }
  await addVault();
  buildMenu();
}

/** The result of trying to mount a vault to a local folder — shared by the Vaults
 *  menu and the web New Vault modal (over IPC). */
interface MountOutcome {
  ok: boolean;
  dir?: string;
  canceled?: boolean;
  error?: string;
}

/**
 * Pick a folder and mount an existing cloud vault to it. The one place the folder
 * picker + overlap check + daemon start live, so the menu and the web modal mount
 * a vault exactly the same way.
 *
 * `isFirstVault` pre-fills the picker at ~/Markbase — the home the first vault
 * gets by default (the user can still choose elsewhere).
 */
async function chooseVaultFolder(
  name: string,
  isFirstVault: boolean
): Promise<{ dir?: string; canceled?: boolean; refused?: boolean }> {
  let defaultPath: string | undefined;
  if (isFirstVault) {
    defaultPath = join(homedir(), "Markbase");
    try {
      mkdirSync(defaultPath, { recursive: true }); // so the picker opens there
    } catch {
      defaultPath = undefined;
    }
  }

  const res = await dialog.showOpenDialog({
    title: name ? `Choose a folder for "${name}"` : "Choose a folder for this vault",
    defaultPath,
    properties: ["openDirectory", "createDirectory"],
  });
  const dir = res.filePaths[0];
  if (res.canceled || !dir) return { canceled: true };
  // Refused here, at the pick, and not when the vault is mounted after Create:
  // by then the cloud row exists, and a refusal that late reads as "it said no
  // and created it anyway".
  const refused = newVaultFolderRefusal(dir, name);
  if (refused) {
    await dialog.showMessageBox({ type: "warning", message: refused, buttons: ["OK"] });
    return { refused: true };
  }
  return { dir };
}

/**
 * Why a vault that does not exist yet may not live in `dir`, or null. The
 * vault has no id, so none can be its own marker — any marked folder is
 * another vault's.
 */
function newVaultFolderRefusal(dir: string, name: string): string | null {
  return folderRefusal(
    dir,
    "",
    name || "this vault",
    mountedForOverlapCheck(currentOwnerId()),
    readVaultMarker,
    join(homedir(), "Markbase")
  );
}

/**
 * The folder a new vault called `name` will get — the one picked, or
 * ~/Markbase/<name> — and whether it may have it. The New Vault dialog asks
 * before Create: the default folder can be taken too (a vault of the same
 * name mounted here by another account, say), and finding that out after the
 * row exists is the bug the pick-time check fixed for picked folders.
 */
function checkNewVaultFolder(name: string, dir?: string): { dir?: string; refused?: string } {
  const target = dir ?? defaultVaultDir(name);
  const refused = newVaultFolderRefusal(target, name);
  return refused ? { refused } : { dir: target };
}

/**
 * Every mount on the machine, for the overlap check — not only this account's:
 * the check is about two daemons claiming one folder, which another account's
 * daemon can do as well as ours. Another account's vault is named only as that
 * in a refusal: its folder has to be, or the refusal explains nothing, but its
 * name is not this account's to see.
 */
function mountedForOverlapCheck(me: string | null): MountedVault[] {
  return readMountedVaults().map((v) =>
    mountedByAccount(v, me) ? v : { ...v, name: "a vault mounted by another account" }
  );
}

/** Where a vault goes when nobody chose: a folder of its own in the home. */
function defaultVaultDir(name: string): string {
  return join(homedir(), "Markbase", sanitizePathSegment(name));
}

async function mountVaultToFolder(
  vaultId: string,
  name: string,
  isFirstVault: boolean,
  /**
   * A folder the caller already picked. The New Vault modal offers the picker
   * BEFORE the vault exists — you cannot mount an id that hasn't been created —
   * so it chooses first and hands the path here once the row is in.
   */
  preChosenDir?: string,
  /**
   * Use the home default (~/Markbase/<name>) when nothing was picked, instead
   * of asking. The New Vault dialog says that is the default, so Create must
   * mean create. The Vaults menu's "Mount a Vault…" leaves this off and asks —
   * an existing vault often already has a folder somewhere.
   */
  opts: { defaultToHome?: boolean } = {}
): Promise<MountOutcome> {
  // The steps below — pick a folder, warn before adopting a big one, refuse a
  // folder that belongs to or sits inside another vault, register, start syncing
  // — are the same ones `markbase vault mount` runs. They live in
  // @markbase/flows now, and this host supplies the dialogs and the menu.
  const operator = dialogOperator({
    showMessageBox: (req) => dialog.showMessageBox(req),
    showOpenDialog: (req) => dialog.showOpenDialog(req),
    log: logVault,
  });

  // The Shared Vault has a home of its own beside the person's vaults, and
  // nothing in its folder is ever adopted, so the big-folder warning has
  // nothing to warn about.
  const isShared = vaultId === SHARED_VAULT_ID;
  let dir = preChosenDir;
  if (isShared && !dir) {
    dir = defaultSharedVaultDir();
    try {
      mkdirSync(dir, { recursive: true });
    } catch (e) {
      logVault(`couldn't create ${dir}: ${e instanceof Error ? e.message : String(e)}`);
      dir = undefined; // fall back to asking
    }
  }
  // The home default, created now: the flow counts the folder's markdown
  // before it mounts, and a folder that is not there yet has none to count.
  let defaultDir: string | undefined;
  if (!dir && !isShared && opts.defaultToHome) {
    defaultDir = defaultVaultDir(name);
    try {
      mkdirSync(defaultDir, { recursive: true });
    } catch (e) {
      logVault(`couldn't create ${defaultDir}: ${e instanceof Error ? e.message : String(e)}`);
      defaultDir = undefined; // fall back to asking
    }
  }
  const me = currentOwnerId();
  const outcome = await mountVault(
    // Recorded as this account's from the start — the cloud list (or the New
    // Vault modal, signed in as this account) just vouched for the vault.
    { vaultId, name, dir, defaultDir, isFirstVault, ownerId: me },
    {
      operator,
      readMounted: () => mountedForOverlapCheck(me),
      updateMounted: updateMountedVaults,
      markerOf: readVaultMarker,
      countMarkdown: isShared ? () => 0 : (d) => listMarkdown(d).length,
      startSync: () => {
        buildMenu();
        // Deliberately NOT awaited. Mounting is REGISTRATION — the vault now has
        // a folder, which is the entire question the caller asked. The first
        // sync is open-ended work behind that answer: startVaultSync resolves
        // only once every document is opened and every unadopted file uploaded,
        // which for 675 files is 675 network round trips. Awaiting it left the
        // New Vault modal's spinner turning for the whole pass, so a vault that
        // was created and syncing correctly looked hung.
        void reconcileMounts();
      },
      defaultHome: join(homedir(), "Markbase"),
    }
  );

  if (outcome.ok) return { ok: true, dir: outcome.dir };
  return outcome.reason === "refused"
    ? { ok: false, error: "That folder can't hold this vault" }
    : { ok: false, canceled: true };
}

async function unmountVault(v: MountedVault): Promise<void> {
  // Unmounting is an edit to the registry and nothing else. The pass is what
  // stops the daemon — here, and in the CLI service the next time it looks.
  //
  // Tombstoned, because the folder stays on disk: reclaimVaults walks the
  // default home and reconnects vault folders the registry has forgotten, and
  // without a record of the decision it cannot tell "forgotten" from "the user
  // just unmounted this". It would put it straight back, within seconds.
  await tombstoneUnmount(v.vaultId);
  await reconcileMounts();
  buildMenu();
}

// ---- Open a local agent in a vault's folder (roadmap: agent adapters) --------
// The web "Open in agent" menu calls this (via the preload bridge). CLI agents
// (Claude Code, Codex) open a Terminal running the tool in the vault's folder;
// editor apps (Cursor) open there via `open -a`; Claude Desktop just comes to the
// front (it reaches the vault through its wired MCP server, not a folder).

const AGENT_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  "claude-desktop": "Claude Desktop",
};

/**
 * Claude Code was just run in `dir` through this app: register the folder's
 * repo and sessions with the API. This is the one moment a Claude Code session
 * check happens — the person ran it, here, in a folder they mounted — rather
 * than a background scan over everything Claude Code was ever run in.
 */
function noteClaudeRun(dir: string): void {
  const apiKey = readApiKey();
  if (!apiKey) return;
  void reportClaudeRun({ appUrl: APP_URL, apiKey, cwd: dir, log: (m) => logVault(`[tickets] ${m}`) });
}

/** Single-quote a path for a POSIX shell (safe for spaces/quotes). */
function shQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

/** Double-quote a string for an AppleScript literal. */
function appleQuote(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/** Open a new Terminal window running `bin` in `dir` (a login shell, so the
 *  user's PATH resolves `claude`/`codex`). */
function openTerminalRunning(dir: string, bin: string): void {
  const shCmd = `cd ${shQuote(dir)} && exec ${bin}`;
  execFile(
    "osascript",
    [
      "-e", `tell application "Terminal" to do script ${appleQuote(shCmd)}`,
      "-e", `tell application "Terminal" to activate`,
    ],
    (err) => {
      if (err) logVault(`open-agent terminal error: ${err.message}`);
    }
  );
}

function openMacApp(appName: string, args: string[] = []): void {
  execFile("open", ["-a", appName, ...args], (err) => {
    if (err) logVault(`open-agent app error (${appName}): ${err.message}`);
  });
}

/**
 * Where a vault is mounted on this machine.
 *
 * One lookup now: the desktop app and the CLI share a single registry, so a
 * vault mounted by either is visible to both. This used to read two files and
 * fall back between them, which was the only reason anything here worked — the
 * startup path did NOT fall back, so a CLI-mounted vault would open in an agent
 * while the app's own daemon reported nothing mounted.
 */
function findVaultDir(vaultId: string): string | null {
  return myMounts().find((m) => m.vaultId === vaultId)?.dir ?? null;
}

async function openAgentInVault(
  agentId: string,
  vaultId: string
): Promise<{ ok: boolean; error?: string }> {
  const dir = findVaultDir(vaultId);
  logVault(`open-agent: agent=${agentId} vaultId=${vaultId} -> dir=${dir ?? "NOT FOUND"}`);
  if (!dir || !existsSync(dir)) {
    await dialog.showMessageBox({
      type: "info",
      message: `Can't open ${AGENT_LABELS[agentId] ?? "the agent"}`,
      detail: dir
        ? `This vault's folder (${dir}) is missing. Re-mount it, then try again.`
        : "This vault isn't mounted on this Mac. Mount it (desktop app or the markbase CLI), then try again.",
    });
    return { ok: false, error: "vault-not-mounted" };
  }
  if (process.platform !== "darwin") {
    return { ok: false, error: "unsupported-platform" };
  }
  switch (agentId) {
    case "claude-code":
      openTerminalRunning(dir, "claude");
      noteClaudeRun(dir);
      break;
    case "codex":
      openTerminalRunning(dir, "codex");
      break;
    case "cursor":
      openMacApp("Cursor", [dir]);
      break;
    case "claude-desktop":
      openMacApp("Claude");
      break;
    default:
      return { ok: false, error: "unknown-agent" };
  }
  logVault(`opened ${agentId} in ${dir}`);
  return { ok: true };
}

// ---- Native agent chat: run Claude via the Agent SDK, stream chunks to the UI --
// The renderer's chat panel calls `agent-chat:start`; we run the query in the
// vault's folder (local Claude auth, no API key) and relay each StreamChunk on
// `agent-chat:chunk:<sessionId>`, ending with `agent-chat:end:<sessionId>`.

/**
 * The document each chat session was last told about.
 *
 * A session follows you from document to document rather than restarting, so
 * "the first turn" is the wrong moment to say which one is open — after that it
 * is whatever the transcript said hours ago, while you are looking at something
 * else. Keyed by chat session; one short string per panel you have opened.
 */
const announcedDoc = new Map<string, string>();
/** Far more chat panels than a session opens; a backstop, not a working limit. */
const MAX_ANNOUNCED = 200;

/**
 * One live CLI per chat panel.
 *
 * Each panel's session is a `claude` process that stays up between your
 * messages, so a background command it starts is still running when the turn
 * that started it is over — which the one-shot runner could not offer, because
 * the process owning that command exited with the turn.
 */
interface LiveChat {
  session: ClaudeSession;
  /** The vault it was opened against; a different one needs a different CLI. */
  cwd: string;
  /** The conversation it was told to resume, if any. */
  resumedFrom?: string;
}

const chats = new Map<string, LiveChat>();

/** Forward everything a session says to the panel that owns it, until it ends. */
function pumpChat(wc: WebContents, sessionId: string, chat: LiveChat): void {
  const send = (
    kind: "chunk" | "end",
    data: StreamChunk | { ok: boolean; error?: string }
  ): void => {
    if (!wc.isDestroyed()) wc.send(`agent-chat:${kind}:${sessionId}`, data);
  };

  void (async () => {
    try {
      for await (const event of chat.session.events()) {
        if (event.kind === "turn-end") {
          // `ok: true` even after an error chunk, deliberately: the chunk is
          // already in the conversation, and the renderer treats `ok: false` as
          // fatal — it shows a banner AND returns before persisting the session
          // index, discarding the record of a chat that ran fine for several
          // turns and failed on the last one.
          send("end", { ok: true });
          continue;
        }
        // A run can fail without throwing and without being an error: "Failed to
        // authenticate. API Error: 403" arrives as an ordinary assistant
        // message. It has happened repeatedly and left no trace anywhere but the
        // SDK's own transcript, so the stream is read for text that ANNOUNCES a
        // failure as well as for errors. Nothing the user sees changes.
        const failure = failureIn(event.chunk);
        if (failure !== null) {
          logVault(
            `agent run failed (session ${sessionId}, cwd ${chat.cwd}` +
              `${chat.resumedFrom ? ", resumed" : ""}): ${failure}`
          );
        }
        send("chunk", event.chunk);
      }
      // The stream ended without a result: the session is over, so whatever turn
      // the panel thinks is running is not.
      send("end", { ok: true });
    } catch (e) {
      if (e instanceof CliExitedError) {
        // The CLI died and its stream never ended — the failure that left a
        // spinner counting past five minutes with no process behind it.
        logVault(
          `agent session died (session ${sessionId}, cwd ${chat.cwd}` +
            `${chat.resumedFrom ? ", resumed" : ""}): ${e.message}`
        );
        send("chunk", { type: "error", content: e.message });
        send("end", { ok: true });
      } else {
        const error = e instanceof Error ? e.message : String(e);
        logVault(`agent session threw (session ${sessionId}, cwd ${chat.cwd}): ${error}`);
        send("end", { ok: false, error });
      }
    } finally {
      chat.session.close();
      if (chats.get(sessionId) === chat) chats.delete(sessionId);
    }
  })();
}

/**
 * The live CLI for this panel, started if there is not one.
 *
 * Replaced rather than reused when the panel has moved to a different vault, or
 * when the user has opened a PAST conversation — that is a different transcript,
 * and the process is holding the old one. A `resume` that merely names the
 * conversation this session is ALREADY on is not a change: the renderer sends
 * the provider's id back on every message once it knows it.
 */
async function liveChat(
  wc: WebContents,
  sessionId: string,
  dir: string,
  resume: string | undefined
): Promise<ClaudeSession> {
  const existing = chats.get(sessionId);
  if (existing) {
    const sameVault = existing.cwd === dir;
    const sameConversation =
      !resume ||
      resume === existing.resumedFrom ||
      resume === existing.session.providerSessionId();
    if (sameVault && sameConversation) return existing.session;
    existing.session.close();
    chats.delete(sessionId);
  }

  const session = await openClaudeSession({
    cwd: dir,
    resume,
    // Our own copy, never the user's PATH — see claude-bin.ts. `undefined` would
    // let the SDK resolve a path inside app.asar, which cannot run.
    pathToClaudeCodeExecutable: bundledClaudePath() ?? undefined,
  });
  const chat: LiveChat = { session, cwd: dir, resumedFrom: resume };
  chats.set(sessionId, chat);
  pumpChat(wc, sessionId, chat);
  noteClaudeRun(dir);
  return session;
}

async function startAgentChat(
  wc: WebContents,
  arg: {
    sessionId: string;
    prompt: string;
    vaultId: string;
    docId?: string;
    docPath?: string;
    resume?: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  const dir = findVaultDir(arg.vaultId);
  if (!dir || !existsSync(dir)) return { ok: false, error: "vault-not-mounted" };

  // The backstop. The bot button asks `ensureClaude` before opening its panel, but
  // that is the polite path — a resumed conversation, a keyboard shortcut, or any
  // caller added later reaches this function directly. Without the check here a
  // signed-out user gets a 403 four minutes into a run, which is exactly the
  // failure that sent us looking in the first place.
  const ready = await ensureClaudeReady();
  if (!ready.ready) return { ok: false, error: "claude-not-connected" };

  // Tell the agent where it is — otherwise "this document" and "the images" mean
  // nothing, since all it has is the vault folder as cwd.
  //
  // Sent whenever the answer CHANGES, not only on the first turn: a session
  // follows you from document to document rather than restarting, so after a
  // switch the transcript's only mention of "the document" points at the one you
  // left. An unchanged answer says nothing rather than repeating itself.
  //
  // Most of this is about where writing GOES, and it is spelled out because an
  // agent that has a document tool for some other service will otherwise use it.
  // Saying only "read this file" left the question open and edits went to Google
  // Docs; saying "edits belong in that file" left the NEXT question open and new
  // documents were created there instead. Both landed somewhere real, just not in
  // the vault the user was looking at. So: what a document is here (a file), where
  // edits go (that file), where a new one goes (a new file, in this folder), and
  // that nothing else counts unless the user names it.
  const viewing = arg.docPath
    ? `The user is viewing \`${arg.docPath}\`. "this document", "the doc", "this page", and "the images" mean that file and the image assets it embeds — read it (and the assets/ files it references) as needed to answer. Anything they ask you to write, add, or revise in it belongs IN that file, edited with your file tools.`
    : `The user has no document open.`;
  const announcement = arg.docPath ?? "";
  const preamble =
    announcedDoc.get(arg.sessionId) === announcement
      ? ""
      : `[Context] Your working directory is a Markbase vault: every document in it is a markdown file on disk, and that is what a document IS here. ${viewing} A NEW document is a new \`.md\` file you write in this folder — alongside the others, in the subfolder the subject belongs in. Do not create documents anywhere else: not in Google Docs, not in Notion, not through an MCP document tool, unless the user names that service themselves. Deleting a file DOES delete its document — the folder is the vault — so treat removing one as you would any irreversible edit: say what you are about to delete and why, and let the user answer.\n\n`;
  announcedDoc.set(arg.sessionId, announcement);
  // Nothing tells the main process when a chat panel is gone for good, so drop
  // the oldest once there are more than a session could plausibly need. Re-set
  // does not reorder a Map, so the first key is the least recently opened.
  if (announcedDoc.size > MAX_ANNOUNCED) {
    const oldest = announcedDoc.keys().next().value;
    if (oldest !== undefined) announcedDoc.delete(oldest);
  }

  try {
    const session = await liveChat(wc, arg.sessionId, dir, arg.resume);
    session.send(preamble + arg.prompt);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logVault(`agent session failed to open (session ${arg.sessionId}, cwd ${dir}): ${error}`);
    return { ok: false, error };
  }

  return { ok: true };
}

// ---- Embedded terminal: a PTY per agent panel, streamed to the renderer ------
// CLI agents (Claude Code, Codex) run inside the app's xterm panel, not an
// external terminal. Each panel opens a PTY here — a login shell that execs the
// agent, so the user's PATH resolves `claude`/`codex` — and bytes relay both ways
// keyed by ptyId (`markbase:pty-data:<id>` / `-exit:<id>`).

const ptys = new Map<string, IPty>();

function agentTerminalBin(agentId: string): string | null {
  if (agentId === "claude-code") return "claude";
  if (agentId === "codex") return "codex";
  return null; // GUI agents don't run in a PTY
}

function startPty(arg: {
  ptyId: string;
  agentId: string;
  vaultId: string;
  cols: number;
  rows: number;
}): { ok: boolean; error?: string } {
  const dir = findVaultDir(arg.vaultId);
  if (!dir || !existsSync(dir)) return { ok: false, error: "vault-not-mounted" };
  const bin = agentTerminalBin(arg.agentId);
  if (!bin) return { ok: false, error: "not-a-terminal-agent" };
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    const p = spawnPty(shell, ["-l", "-c", `exec ${bin}`], {
      name: "xterm-color",
      cwd: dir,
      cols: arg.cols || 80,
      rows: arg.rows || 24,
      env: process.env as { [key: string]: string },
    });
    ptys.set(arg.ptyId, p);
    if (arg.agentId === "claude-code") noteClaudeRun(dir);
    p.onData((data) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send(
        `markbase:pty-data:${arg.ptyId}`,
        data
      );
    });
    p.onExit(({ exitCode }) => {
      ptys.delete(arg.ptyId);
      BrowserWindow.getAllWindows()[0]?.webContents.send(
        `markbase:pty-exit:${arg.ptyId}`,
        exitCode
      );
    });
    logVault(`pty ${arg.ptyId.slice(0, 6)} started (${bin}) in ${dir}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * A vault was deleted in the cloud — stop syncing it and move its local files into
 * the folder's `.trash/`.
 *
 * Deliberately NOT a hard delete: the cloud is gone, but the bytes on disk are the
 * user's, and a delete they did on the web shouldn't silently erase local work.
 * Everything at the vault root moves into `.trash/deleted-<timestamp>/` — except
 * `.trash` itself — so it's all recoverable in Finder.
 */
async function trashVault(v: MountedVault): Promise<void> {
  // Unmount BEFORE touching the files: the registry edit plus a pass is what
  // stops the daemon, and moving a vault's contents out from under a running
  // watcher would have it report every file as deleted.
  //
  // Deliberately NOT tombstoned. This vault was deleted in the cloud — that is
  // not a decision about this machine, and reclaim cannot resurrect it anyway
  // since the cloud list no longer names it. A tombstone here would outlive the
  // vault it names.
  await removeMountedVault(v.vaultId);
  await reconcileMounts();
  let movedTo: string | null = null;
  try {
    if (existsSync(v.dir)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const trashDir = join(v.dir, ".trash", `deleted-${stamp}`);
      mkdirSync(trashDir, { recursive: true });
      for (const entry of readdirSync(v.dir)) {
        if (entry === ".trash") continue; // never move the trash into itself
        renameSync(join(v.dir, entry), join(trashDir, entry));
      }
      movedTo = trashDir;
    }
  } catch (e) {
    logVault(`[${v.name}] couldn't move files to .trash: ${e instanceof Error ? e.message : String(e)}`);
  }
  logVault(`[${v.name}] deleted in cloud — unmounted${movedTo ? `, files moved to ${movedTo}` : ""}`);
  void dialog.showMessageBox({
    type: "info",
    message: `"${v.name}" was deleted`,
    detail: movedTo
      ? `It was removed from the cloud. Your local files were moved to ${movedTo}.`
      : "It was removed from the cloud and unmounted here.",
  });
}

/**
 * Reconcile mounted vaults against the cloud: any that no longer exist there were
 * deleted, so trash them locally.
 *
 * Guarded hard against blind deletion — if there's no API key, or the list can't
 * be fetched (offline, auth error), we do NOTHING. Only a successful list with a
 * vault genuinely absent counts as "deleted"; a failed fetch must never look like
 * "everything was deleted."
 */
let reconciling = false;
async function reconcileVaults(): Promise<void> {
  if (reconciling) return;
  if (!readApiKey()) return; // can't tell who owns what — never trash blind
  reconciling = true;
  try {
    const cloud = await fetchCloudVaults();
    // Offline, unauthorised, or an answer we could not read: leave every local
    // file exactly where it is.
    if (cloud === null) return;

    // The Shared Vault is not a row in the cloud and never will be; its folder
    // is retired by its own daemon, one un-shared document at a time. It is
    // left out here entirely, or a machine holding only it would be told the
    // cloud reports no vaults while one is mounted.
    // Only mounts RECORDED as this account's. Retiring a folder is the most
    // destructive thing this app does, so "the vault is gone" is believed only
    // for a vault this account was confirmed to own first. The new server
    // answers 403 for another account's vault, never 404 — but a server from
    // before the split answers 404 for both, and this is what keeps that
    // answer from retiring another account's folder while the two versions
    // overlap. A mount recorded for nobody yet waits for its daemon's first
    // confirmed run.
    const me = currentOwnerId();
    const mounted = myMounts().filter(
      (m) => m.vaultId !== SHARED_VAULT_ID && me !== null && m.ownerId === me
    );
    if (mounted.length === 0) return;

    // Zero vaults while this machine holds mounts is refused outright. Deleting
    // every vault you own is a rare, deliberate act — and that path already
    // unmounts as it goes. A list that arrives empty is far more likely to be a
    // broken answer, and acting on it moves the user's files.
    if (cloud.length === 0) {
      logVault(`the cloud reported no vaults while ${mounted.length} are mounted here — ignoring`);
      return;
    }

    const cloudIds = new Set(cloud.map((c) => c.id));
    const missing = mounted.filter((m) => !cloudIds.has(m.vaultId));
    if (missing.length === 0) return;

    // Absent from a list is a suspicion. Ask about each one before touching a
    // single file.
    let acted = false;
    for (const v of missing) {
      if (!(await confirmVaultDeleted(v.vaultId))) {
        logVault(`[${v.name}] missing from the vault list, but the server did not say it is deleted — leaving it mounted`);
        continue;
      }
      await trashVault(v);
      acted = true;
    }
    if (acted) buildMenu();
  } finally {
    reconciling = false;
  }
}

/**
 * Does this app have a USABLE key of its own (as opposed to borrowing the CLI's)?
 *
 * A leftover `apiKeyEnc` deliberately doesn't count: we no longer decrypt it, so
 * an install carrying only that one still needs to sign in, and the menu should
 * say "Sign in…" rather than "Sign in again…".
 */
function signedIn(): boolean {
  return Boolean(loadSettings().apiKey);
}

/** Hand a Tabs-menu command to the focused window's page, which owns the tabs. */
function sendTabCommand(command: string): void {
  const win = BrowserWindow.getFocusedWindow();
  if (win && !win.isDestroyed()) win.webContents.send("markbase:tab-command", command);
}

/**
 * Tell every window the mounted-vault set changed, so the vault switcher
 * re-reads it. Sent from buildMenu, because the menu is rebuilt at exactly the
 * moments the set changes — a mount from the first-run offer, the Vaults menu,
 * a reclaim, a trash, a sign-in — and the window used to learn about none of
 * them: it read the list once and showed a vault mounted through a native
 * dialog as cloud-only until it happened to re-render.
 */
function sendMountsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("markbase:mounts-changed");
  }
}

function buildMenu(): void {
  sendMountsChanged();
  const mounted = myMounts();
  const template: Parameters<typeof Menu.buildFromTemplate>[0] = [
    { role: "appMenu" },
    {
      label: "Vaults",
      submenu: [
        { label: "Mount a Vault…", click: () => void addVault().then(buildMenu) },
        ...(mounted.some((m) => m.vaultId === SHARED_VAULT_ID)
          ? []
          : [
              {
                label: "Sync Shared Documents to a Folder",
                click: () =>
                  void mountVaultToFolder(SHARED_VAULT_ID, SHARED_VAULT_NAME, false).then(buildMenu),
              },
            ]),
        {
          // Reachable, not just offered when a mount fails: a person who wants to
          // switch accounts shouldn't have to trigger an error to find it.
          label: signedIn() ? "Sign in again…" : "Sign in…",
          click: () => void signIn().then(buildMenu),
        },
        ...(signedIn() ? [{ label: "Log out", click: () => void signOut() }] : []),
        { type: "separator" },
        { label: instanceLabel(), enabled: false },
        { label: "Settings…", click: openSettings },
        { type: "separator" },
        ...(mounted.length === 0
          ? [{ label: "No vaults mounted", enabled: false }]
          : mounted.map((v) => ({
              label: v.name,
              submenu: [
                { label: v.dir, enabled: false },
                { label: "Reveal in Finder", click: () => void shell.openPath(v.dir) },
                { label: "Unmount", click: () => void unmountVault(v) },
              ],
            }))),
      ],
    },
    {
      label: "Claude",
      submenu: [
        // The onboarding window doubles as the account screen — it already shows
        // who is signed in and can sign out, so there is no second surface to
        // build and no way for the two to disagree.
        { label: "Connect Claude…", click: () => openOnboarding() },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      // Tabs are workspaces with their own history — Obsidian's keys. The
      // accelerators are claimed here, before the page sees them, and forwarded
      // to it by name (preload's onTabCommand).
      label: "Tabs",
      submenu: [
        { label: "New Tab", accelerator: "CmdOrCtrl+T", click: () => sendTabCommand("newTab") },
        { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: () => sendTabCommand("closeTab") },
        {
          label: "Reopen Closed Tab",
          accelerator: "CmdOrCtrl+Shift+T",
          click: () => sendTabCommand("reopenClosedTab"),
        },
        { type: "separator" },
        { label: "Back", accelerator: "CmdOrCtrl+Alt+Left", click: () => sendTabCommand("back") },
        { label: "Forward", accelerator: "CmdOrCtrl+Alt+Right", click: () => sendTabCommand("forward") },
        { type: "separator" },
        { label: "Next Tab", accelerator: "Ctrl+Tab", click: () => sendTabCommand("nextTab") },
        { label: "Previous Tab", accelerator: "Ctrl+Shift+Tab", click: () => sendTabCommand("prevTab") },
      ],
    },
    {
      // Spelled out rather than `role: "windowMenu"`, whose Close item would also
      // claim ⌘W (Ctrl+W) — the key that closes a tab here.
      label: "Window",
      submenu:
        process.platform === "darwin"
          ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
          : [{ role: "minimize" }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// What a window is painted with before its page has drawn a frame. Electron's
// default is white, so a window whose page is still loading — or never loads —
// is a white rectangle; saying so explicitly keeps it a decision rather than
// a default, and a page that goes dark one day gets its own token beside this
// one. It is `--background` from @markbase/ui/theme.css as hex, because
// BrowserWindow takes no oklch.
const LIGHT_BACKGROUND = "#ffffff";

/**
 * Which kind of window a BrowserWindow is, told to its preload.
 *
 * The preload exposes a different slice of the bridge per kind — the viewer
 * gets its file and nothing else, the onboarding page Claude and nothing else —
 * and the only thing it can read before the page loads is argv. So each window
 * is made with this in `webPreferences.additionalArguments`, and the preload
 * builds the bridge for the kind it finds (see preload.ts).
 */
function windowKindArg(kind: WindowKind): string {
  return `--markbase-window=${kind}`;
}

/**
 * What every window's preload reads off argv: its kind, and the Supabase
 * project this process runs against. The renderer bundle is built once and
 * shipped to everyone, so the project cannot be compiled into it the way the
 * website's is — the preload exposes these two to the page instead
 * (`globalThis.__MARKBASE_SUPABASE_URL__` and `__KEY__`, which vite.config.mts
 * substitutes for the NEXT_PUBLIC_ reads).
 */
function windowArgs(kind: WindowKind): string[] {
  return [
    windowKindArg(kind),
    `--markbase-supabase-url=${SUPABASE_URL}`,
    `--markbase-supabase-key=${SUPABASE_KEY}`,
  ];
}

function createWindow(initialUrl?: string): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: "Markbase",
    // The web app renders light; see LIGHT_BACKGROUND.
    backgroundColor: LIGHT_BACKGROUND,
    // Shown on ready-to-show, not immediately — same reason the viewer is (see
    // openViewer). The documents surface now loads from a local page and can
    // settle to a static resting state fast, so a first frame that misses the
    // screen is not redrawn and the window opens white. Launching from the app
    // icon with no file is exactly that path.
    show: false,
    // No native title bar at all — the web app fills the window edge-to-edge.
    // `hidden` drops the bar but keeps the traffic-light buttons (so the window
    // can still be closed/minimised) and leaves the top strip draggable. The
    // position centres them vertically in the app's 44px unified header row.
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 15 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.js"),
      additionalArguments: windowArgs("dashboard"),
      backgroundThrottling: false,
    },
  });
  // Reveal on the first painted frame. The fallback is load-bearing here in a
  // way it is not for the viewer: this window loads over the network (the API,
  // and the site's /login during sign-in) and has its own retry path, so
  // ready-to-show could be delayed or, on an error page, not arrive — and a
  // window that never shows is worse than one that shows a moment early.
  let shown = false;
  const reveal = (): void => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.show();
  };
  win.once("ready-to-show", reveal);
  setTimeout(reveal, 4000);

  // Coming back to the window is a good moment to notice a vault deleted on the
  // web (here or on another device) and move its local files to .trash.
  win.on("focus", () => void reconcileVaults());

  // On macOS, closing the main window HIDES it rather than destroying it. The
  // app stays running with no visible windows (standard macOS), and reopening
  // it — the dock icon, or opening a file — re-shows this same window, so the
  // open tabs, the scroll position and the live sync connection are all still
  // there and reappear instantly. It is really closed only when the app quits:
  // before-quit sets quitRequested first, so the close then goes through and
  // `closed` (below) tears down the CRDT subscriptions. Guarded by isDestroyed
  // because once a real close has begun, this fires again with nothing to do.
  win.on("close", (e) => {
    if (process.platform === "darwin" && !quitRequested && !win.isDestroyed()) {
      e.preventDefault();
      win.hide();
    }
  });

  // A closed window is watching nothing — drop its CRDT subscriptions so the
  // cloud channels close with it.
  //
  // The reference is captured HERE, not read inside the handler: `closed` fires
  // after the window is destroyed, and any property access on a destroyed
  // BrowserWindow throws "Object has been destroyed" — which, thrown from an
  // event handler in the main process, is an uncaught exception and puts a
  // JavaScript-error dialog in front of the user as they close a window. Holding
  // the WebContents is safe because it is only ever used as a Set key here;
  // nothing calls into it.
  const wc = win.webContents;
  win.on("closed", () => {
    crdtReleaseAll(wc);
    // The sign-in runs IN this window (it loads /login and finishes at the
    // loopback). Closing it abandons the flow, so the port should go with it
    // rather than linger until the backstop.
    cancelSignIn();
  });

  // A blank white window means the renderer is gone (crashed, killed, or OOM) or
  // the page never loaded — from the outside the two look identical, and neither
  // says anything on its own. Write down which it was, so "it went white again"
  // has an answer in the log instead of needing to be reproduced.
  win.webContents.on("render-process-gone", (_e, details) => {
    logVault(
      `RENDERER GONE — reason=${details.reason} exitCode=${details.exitCode}. ` +
        `The window is blank because the page's process died.`
    );
  });
  // HOME_URL is the documents surface rendered by this app — see where it is
  // declared, beside the scheme that serves it.

  // A failed load used to be the end of it: one log line, and a white window
  // until the person quit and reopened the app. In the packaged build APP_URL is
  // the live site, so every launch that beats the network to it — waking a
  // laptop, joining café wifi, a VPN still coming up — landed there. The log
  // even said "the window will be blank", which is a strange thing to write down
  // and then do nothing about.
  //
  // So: back off and keep trying, and put something on screen meanwhile. The
  // last delay repeats forever rather than giving up, because the interesting
  // case is a machine that comes back hours later.
  const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];
  let loadAttempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The URL whose load just failed, waiting for its error page to finish.
   *
   * Chromium renders an error page for a failed navigation and that page emits
   * did-finish-load — at the ORIGINAL url, not a data: one. So the first version
   * of this retry cancelled itself: it armed a timer, Chromium finished the
   * error page a moment later, and the "we loaded fine, forget the retry" branch
   * threw the timer away before it could fire. The window stayed blank and the
   * log said nothing, which is precisely the bug this set out to fix.
   */
  let failedUrl: string | null = null;

  /** Text as text: a Chromium message like `net::ERR_<name>` is not markup. */
  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * Something to look at while we wait, as a data: URL.
   *
   * Deliberately self-contained — no stylesheet, no fonts, no network of any
   * kind. It is shown precisely when the network is the thing that failed, and
   * a placeholder that needs to fetch anything would blank the window too.
   */
  function offlineNotice(description: string, delayMs: number): string {
    const seconds = Math.max(1, Math.round(delayMs / 1000));
    const html = `<!doctype html>
<meta charset="utf-8">
<title>Markbase</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; background: #ffffff; color: #111111;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  @media (prefers-color-scheme: dark) { body { background: #111111; color: #f5f5f5; } }
  .card { max-width: 24rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.125rem; font-weight: 600; margin: 0 0 .5rem; }
  p { margin: 0 0 .5rem; opacity: .7; font-size: .875rem; }
  .tag {
    display: inline-block; margin-top: 1rem; padding: .35rem .75rem;
    border-radius: 999px; background: #e5ff6e; color: #111111;
    font-size: .8125rem; font-weight: 600;
  }
</style>
<div class="card">
  <h1>Can't reach Markbase</h1>
  <p>${escapeHtml(description)}</p>
  <p>Your vaults keep syncing on this machine.</p>
  <div class="tag">Trying again in ${seconds}s</div>
</div>`;
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  }

  function scheduleReload(description: string): void {
    if (retryTimer) return; // a retry is already pending
    const delay = RETRY_DELAYS_MS[Math.min(loadAttempt, RETRY_DELAYS_MS.length - 1)];
    loadAttempt += 1;
    // The timer is armed FIRST, deliberately. Showing the notice is the
    // cosmetic half of this and retrying is the half that matters, so nothing
    // about rendering a placeholder may come between a failed load and the next
    // attempt — least of all a synchronous throw, which would leave the timer
    // unset and the window blank forever, which is the bug being fixed.
    retryTimer = setTimeout(() => {
      retryTimer = null;
      logVault(`retrying ${HOME_URL} (attempt ${loadAttempt + 1})`);
      void win.loadURL(HOME_URL).catch((e) => {
        // ERR_ABORTED is this retry superseding the offline notice it put up a
        // moment ago — the navigation we just cancelled on purpose. Reporting
        // our own tidy-up as a failure is noise, and the real outcome arrives
        // through did-fail-load or did-finish-load either way.
        const detail = e instanceof Error ? e.message : String(e);
        if (!detail.includes("ERR_ABORTED")) logVault(`retry failed: ${detail}`);
      });
    }, delay);
    try {
      void win
        .loadURL(offlineNotice(description, delay))
        .catch((e) => logVault(`offline notice failed: ${e instanceof Error ? e.message : String(e)}`));
    } catch (e) {
      logVault(`offline notice threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  win.webContents.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
    // -3 is ERR_ABORTED, which every superseded navigation reports; not a failure.
    if (code === -3) return;
    // Whether this was the main frame is the one fact that decides if the window
    // is now blank, so it belongs in the log. The first version of this retry
    // dropped that detail and left me unable to tell a guard that rejected the
    // event from a handler that threw.
    logVault(
      `LOAD FAILED — ${description} (${code}) for ${url}` +
        (isMainFrame ? " [main frame]" : " [sub-frame]")
    );
    // A sub-frame failing leaves the app usable; only the main frame blanks it.
    if (!isMainFrame) return;
    // The notice below is itself a data: URL. If THAT fails to load, retrying it
    // would be a loop feeding itself.
    if (url.startsWith("data:")) return;
    // Remember it, so the error page Chromium is about to render for this same
    // url is not mistaken for a successful load.
    failedUrl = url;
    try {
      scheduleReload(description);
    } catch (e) {
      // Electron swallows a throw from an event handler, and a retry that dies
      // silently is indistinguishable from the bug this was written to replace.
      logVault(`couldn't schedule a retry: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  win.webContents.on("did-finish-load", () => {
    const at = win.webContents.getURL();
    if (at.startsWith("data:")) return; // the offline notice, not the app
    // The error page for the load that just failed. It finishes like any other
    // page, so without this it reads as success and cancels the retry.
    if (at === failedUrl) {
      failedUrl = null;
      return;
    }
    // A real load. Forget the backoff and stand down.
    loadAttempt = 0;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  });
  win.on("unresponsive", () => logVault("window unresponsive (renderer is blocked)"));
  win.webContents.on("preload-error", (_e, path, error) =>
    logVault(`preload failed (${path}): ${error.message}`)
  );

  // Signed out, the sign-in flow owns the window: it shows the site's own /login
  // in here and loads HOME_URL itself once a key exists. The surface would only
  // have shown an empty vault list and a button that does the same thing.
  if (readApiKey()) void win.loadURL(initialUrl ?? HOME_URL);
  else void signIn().then(buildMenu);

  // Landing on /login means signed out. Start the sign-in flow, which reloads the
  // SAME branded /login but wired to a loopback (so Google can bounce back to us).
  // The guard on `next` stops that reload from re-triggering: the wired /login
  // carries a next=/cli-auth param the bare one doesn't.
  win.webContents.on("did-navigate", (_e, url) => {
    // `!signInAttempt` replaces the old boolean: landing on /login DURING a
    // sign-in is a step of that flow, not a new one — restarting here would
    // cancel the attempt the user is in the middle of and loop forever.
    if (url.includes("/login") && !url.includes("cli-auth") && !signInAttempt) void signIn();
  });

  // window.open always goes to the system browser — never a new embedded window.
  // The Google button opens ${APP_URL}/auth/google (an APP_URL path!) there on
  // purpose: the whole OAuth, including PKCE's code_verifier, has to run in one
  // browser, and that browser must be the system one where Google will render.
  // So we can't special-case by origin; any window.open is a "send to the browser"
  // intent in this app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  /**
   * A plain link click is a NAVIGATION, not a window.open, and it has its own
   * event — so the handler above never saw it. Clicking a link the agent had
   * written in the chat replaced the whole app with that website: no tabs, no
   * back button that means anything, the vault sync still running behind a page
   * that is now somebody's blog.
   *
   * Anything off our own origin is somebody else's site and belongs in the
   * browser. Navigation WITHIN the app is left alone — that is the app working.
   */
  const ours = (url: string): boolean => {
    try {
      const target = new URL(url);
      if (target.origin === new URL(APP_URL).origin) return true;
      // The pages this app serves itself — the documents surface among them.
      if (target.protocol === `${LOCAL_SCHEME}:`) return true;
      // The device-auth loopback. Signing in with email ends by navigating this
      // window to http://127.0.0.1:<port>/… — our own server, on a port chosen at
      // runtime — so treating it as somebody else's website would hand the last
      // step of sign-in to the browser and leave the app waiting forever.
      return (
        (target.protocol === "http:" || target.protocol === "https:") &&
        (target.hostname === "127.0.0.1" || target.hostname === "localhost" || target.hostname === "[::1]")
      );
    } catch {
      return false;
    }
  };
  const keepInBrowser = (e: { preventDefault: () => void }, url: string): void => {
    // The instance's own sign-in, sign-up and join pages offer an instance
    // switcher that navigates to a connect link, the same link a join page
    // hands the app from a browser. Taken as one here — confirmed in the same
    // dialog — but only from a page on the instance's origin: a document
    // rendered at markbase://app may carry a link somebody else wrote.
    if (parseConnectLink(url)) {
      e.preventDefault();
      let from: URL | null = null;
      try {
        from = new URL(win.webContents.getURL());
      } catch {
        from = null;
      }
      if (from && from.origin === new URL(APP_URL).origin) void handleConnectLink(url);
      else logVault(`link ignored (not from the instance's pages): ${url}`);
      return;
    }
    if (ours(url)) return;
    e.preventDefault();
    // http(s) only. A link to a custom scheme is not ours to hand to the OS on
    // the strength of a click inside a document somebody else may have written.
    if (/^https?:/.test(url)) void shell.openExternal(url);
  };
  win.webContents.on("will-navigate", (e, url) => keepInBrowser(e, url));
  // Iframes and embeds navigate separately, and would otherwise slip past.
  win.webContents.on("will-frame-navigate", (e) => keepInBrowser(e, e.url));
}

// ---- Opening a .md file from Finder -----------------------------------------
// Markbase registers as a handler for .md (see fileAssociations in
// package.json), so it can be set as the default opener. Two things follow.
//
// A file that lives inside a MOUNTED VAULT is already a document: the vault's
// index maps a file on disk back to its document id, so that one opens the real
// synced document in the main window rather than a dead copy of its text. This
// matters precisely because the app can be the DEFAULT — without it, double
// clicking your own notes would silently downgrade them to a read-only view.
//
// Everything else gets the file window: no id, no history, no collaborators.
// The same document surface the main window uses, in a local-file mode that
// reads the file and writes it back — see local-file-crdt.ts in the docs
// feature for the renderer half. This side owns the disk: it is the only thing
// that knows the path, and the renderer never sends one.

/** What a file window is showing. Resolved in main, read over IPC. */
interface LocalFile {
  path: string;
  dir: string;
  name: string;
  content: string;
  /** Set instead of content when the file could not be read. */
  error?: string;
  /** Set when the file could not be watched: edits made elsewhere will not show. */
  watchError?: string;
}

/** How a write back to the file went. A plain value, not a thrown error, so the
 *  message reaches the page as written rather than wrapped by IPC. */
type LocalSaveResult = { ok: true } | { ok: false; error: string };

/** Bigger than this is not a document somebody meant to read in a window. */
const MAX_VIEWABLE_BYTES = 8 * 1024 * 1024;

/** Which file each file window is showing, by its WebContents id. The
 *  `content` is kept current with every write and every change noticed on disk,
 *  so it is what the window has — which is how a watcher event for our own
 *  write is told apart from somebody else's. */
const viewerFiles = new Map<number, LocalFile>();
/** The file windows holding edits not yet on disk, by WebContents id. */
const viewerDirty = new Set<number>();

function readLocalFile(filePath: string): LocalFile {
  const base = { path: filePath, dir: dirname(filePath), name: basename(filePath) };
  try {
    const { size } = statSync(filePath);
    if (size > MAX_VIEWABLE_BYTES) {
      return {
        ...base,
        content: "",
        error: `This file is ${Math.round(size / 1024 / 1024)}MB. The viewer stops at ${MAX_VIEWABLE_BYTES / 1024 / 1024}MB.`,
      };
    }
    return { ...base, content: readFileSync(filePath, "utf8") };
  } catch (e) {
    return { ...base, content: "", error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The document this path already is, if it is inside a mounted vault.
 *
 * Reads the vault's own index — a cache the daemon writes, so a vault that has
 * never synced answers null and the file falls through to the viewer, which is
 * the right answer rather than a failure.
 */
function documentForPath(filePath: string): string | null {
  const full = resolve(filePath);
  for (const v of myMounts()) {
    const dir = resolve(v.dir);
    if (full !== dir && !full.startsWith(dir + sep)) continue;
    const index = readVaultIndex(dir);
    if (!index) return null;
    return docIdForFile(index, relative(dir, full));
  }
  return null;
}

/**
 * Write the file in one step: a temporary file beside it, then a rename.
 *
 * A rename within a directory is atomic, so anything reading the file — another
 * editor, a sync client, our own watcher — sees the old content or the new and
 * never a half-written one. The rename replaces the inode, and a fresh file
 * would get the umask's permissions, so the original's mode is carried over.
 */
function writeLocalFileAtomic(filePath: string, content: string): void {
  const tmp = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.tmp`);
  let mode: number | null = null;
  try {
    mode = statSync(filePath).mode & 0o7777;
  } catch {
    // The file is gone (moved, deleted): it is recreated with the default mode.
  }
  try {
    writeFileSync(tmp, content, "utf8");
    if (mode !== null) chmodSync(tmp, mode);
    renameSync(tmp, filePath);
  } catch (e) {
    // Never leave the temporary behind: it would sit beside the user's file
    // with a name nothing explains.
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // best effort
    }
    throw e;
  }
}

/** The window showing a file, by the WebContents that asked. */
function viewerWindow(e: IpcMainEvent | Electron.IpcMainInvokeEvent): BrowserWindow | null {
  if (!viewerFiles.has(e.sender.id)) return null;
  return BrowserWindow.fromWebContents(e.sender);
}

/**
 * Tell the window when its file changes under it.
 *
 * The DIRECTORY is watched, not the file. Most editors save the way this
 * process does — a new file renamed over the old one — and a watch on the file
 * itself follows the old inode out of the directory and goes quiet after the
 * first such save. Events are debounced briefly, because a save is several of
 * them, and the file is read back and compared with what the window has:
 * identical bytes are our own write (or a touch) and are not announced.
 */
function watchLocalFile(win: BrowserWindow, file: LocalFile): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const announce = (): void => {
    timer = null;
    if (win.isDestroyed()) return;
    const next = readLocalFile(file.path);
    if (!next.error && next.content === file.content) return;
    if (!next.error) file.content = next.content;
    win.webContents.send("markbase:local-file-changed", next);
  };
  const cannotWatch = (e: Error): string =>
    `Changes made outside Markbase won't show up here: ${e.message}`;
  let watcher: FSWatcher;
  try {
    watcher = watch(file.dir, (_event, name) => {
      // `name` is the entry that changed; null when the platform cannot say,
      // in which case the file is read back to find out.
      if (name !== null && name !== file.name) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(announce, 100);
    });
  } catch (e) {
    // The window still edits and saves; it just will not hear about edits made
    // elsewhere. Said in the window — it reads this with the file, as it
    // mounts — rather than in a log nobody reads.
    file.watchError = cannotWatch(e instanceof Error ? e : new Error(String(e)));
    return () => {};
  }
  watcher.on("error", (err) => {
    if (win.isDestroyed()) return;
    win.webContents.send("markbase:local-file-changed", { ...file, error: cannotWatch(err) });
  });
  return () => {
    if (timer !== null) clearTimeout(timer);
    watcher.close();
  };
}

/**
 * Ask a file window to write whatever it is holding, and wait for the answer.
 *
 * The renderer debounces its writes, so at the moment the user closes the
 * window the last half-second of typing can still be in memory. The window is
 * told to flush and answers on its own channel; a window that never answers —
 * a hung page — is treated as a failed save rather than waited on forever.
 */
function flushViewer(win: BrowserWindow): Promise<LocalSaveResult> {
  return new Promise((resolve) => {
    const id = win.webContents.id;
    const settle = (result: LocalSaveResult): void => {
      clearTimeout(timer);
      ipcMain.removeListener("markbase:local-file-flushed", onFlushed);
      resolve(result);
    };
    const onFlushed = (e: IpcMainEvent, result: LocalSaveResult): void => {
      if (e.sender.id === id) settle(result);
    };
    const timer = setTimeout(
      () => settle({ ok: false, error: "The window did not finish saving in time." }),
      5_000
    );
    ipcMain.on("markbase:local-file-flushed", onFlushed);
    win.webContents.send("markbase:local-file-flush");
  });
}

/** Set once the user asked to quit, so a window held open to save can resume it. */
let quitRequested = false;

/** Set once we have begun the daemon shutdown, so the app.quit() it ends with
 *  passes straight through before-quit instead of starting a second shutdown. */
let shuttingDown = false;

function openViewer(filePath: string): void {
  const win = new BrowserWindow({
    width: 820,
    height: 900,
    minWidth: 420,
    title: basename(filePath),
    titleBarStyle: "hiddenInset",
    // The file window renders light, like the main window's document page it
    // shares its editor with; see LIGHT_BACKGROUND.
    backgroundColor: LIGHT_BACKGROUND,
    // Shown only once it has a frame to show — see ready-to-show below. The main
    // window gets away without this because it never stops repainting (loads, a
    // spinner, a blinking cursor), so a dropped first frame is immediately
    // redrawn. A file window settles to static content: the editor mounts, then
    // nothing changes, so a first frame that never reached the screen is never
    // replaced, and the window stays the background colour — white — forever.
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.js"),
      additionalArguments: windowArgs("viewer"),
      // A file opened from Finder lands BEHIND the main window (openPendingFiles
      // runs after createWindow), and an occluded window with throttling on may
      // defer its first paint indefinitely. The page is small; never throttle it.
      backgroundThrottling: false,
    },
  });
  // The frame is ready: reveal the window now, so the first thing on screen is
  // the document and not the empty background.
  win.once("ready-to-show", () => win.show());
  // Recorded BEFORE the load, because the page asks for it as it mounts.
  const file = readLocalFile(filePath);
  const id = win.webContents.id;
  viewerFiles.set(id, file);
  // The title bar's proxy icon: drag it to move the file, ⌘-click it for the
  // path. The unsaved dot beside it is the renderer's to set — it is the only
  // side that knows an edit has happened before the write lands.
  win.setRepresentedFilename(filePath);
  const unwatch = file.error ? (): void => {} : watchLocalFile(win, file);

  // Closing with unsaved edits: hold the window until they are written. A save
  // that fails is put to the user — losing their edits silently is the one
  // outcome this window must never produce.
  let closing = false;
  win.on("close", (e) => {
    if (closing || !viewerDirty.has(id)) return;
    e.preventDefault();
    closing = true;
    void flushViewer(win).then((result) => {
      if (win.isDestroyed()) return;
      if (!result.ok) {
        const choice = dialog.showMessageBoxSync(win, {
          type: "warning",
          message: `“${file.name}” couldn't be saved`,
          detail: result.error,
          buttons: ["Cancel", "Close Without Saving"],
          defaultId: 0,
          cancelId: 0,
        });
        if (choice === 0) {
          closing = false;
          // The user kept the window, so the quit it was part of is off too.
          quitRequested = false;
          return;
        }
      }
      win.destroy();
      // A quit that this window interrupted carries on once it is gone.
      if (quitRequested) app.quit();
    });
  });
  win.on("closed", () => {
    unwatch();
    viewerFiles.delete(id);
    viewerDirty.delete(id);
  });
  void win.loadURL(`${LOCAL_SCHEME}://app/viewer/index.html`);
}

/**
 * The window showing the web app, if there is one.
 *
 * Not `getAllWindows()[0]`: with a viewer or two open that can be a viewer, and
 * a vault document loaded into an 820px read-only window is the wrong answer in
 * both directions.
 */
function appWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find(
    (w) => !viewerFiles.has(w.webContents.id) && w !== onboardingWin
  );
}

/** Open a .md path the way it deserves — as its document, or as a view. */
function openMarkdownPath(filePath: string): void {
  const docId = documentForPath(filePath);
  if (docId) {
    const docUrl = `${HOME_URL}/${encodeURIComponent(docId)}`;
    const win = appWindow();
    if (win) {
      // May be hidden (closed-to-hide); show before navigating so the document
      // actually appears rather than loading into an invisible window.
      win.show();
      win.focus();
      void win.loadURL(docUrl);
      return;
    }
    // Every window is closed. Open the document in a fresh main window rather
    // than falling through to the viewer: for a file that is a synced vault
    // document, the viewer is a dead read-only copy, and the whole point of
    // resolving the id was to avoid that.
    createWindow(docUrl);
    return;
  }
  openViewer(filePath);
}

/**
 * Files macOS asked us to open before there was anywhere to put them.
 *
 * `open-file` fires BEFORE app.whenReady() on a cold launch — double-clicking a
 * file with the app closed is the ordinary case, not the edge one — so the path
 * is held until there is a window to open it in. Without this, the first file
 * you ever open does nothing at all.
 */
const pendingFiles: string[] = [];

/**
 * Paths handed over on the command line.
 *
 * macOS uses `open-file` and never argv; Windows and Linux associations do the
 * opposite. Reading both means the one main process is correct wherever it
 * runs, and it is also how this gets exercised without a Finder.
 *
 * Only .md paths, and only ones that exist: argv is full of Electron's own
 * switches, and `--no-sandbox` is not a document.
 */
function markdownPathsIn(argv: string[]): string[] {
  return argv
    .slice(1)
    .filter((a) => !a.startsWith("-"))
    .filter((a) => /\.(md|markdown|mdown|mkd)$/i.test(a))
    .filter((a) => existsSync(a));
}

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (app.isReady()) openMarkdownPath(filePath);
  else pendingFiles.push(filePath);
});

function openPendingFiles(): void {
  for (const path of markdownPathsIn(process.argv)) pendingFiles.push(path);
  for (const path of pendingFiles.splice(0)) openMarkdownPath(path);
}

function registerViewerIpc(): void {
  // Per WINDOW, not global: several file windows can be open, and each asks for
  // its own file. `e.sender.id` is the only thing that distinguishes them.
  ipcMain.handle("markbase:local-file", (e): LocalFile | null =>
    viewerFiles.get(e.sender.id) ?? null
  );
  // The write takes NO path. A window writes to the file it was opened on and
  // nothing else, and a page that is not a file window cannot write at all —
  // whatever it sends.
  ipcMain.handle(
    "markbase:save-local-file",
    (e, arg: { content: string }): LocalSaveResult => {
      const file = viewerFiles.get(e.sender.id);
      if (!file) return { ok: false, error: "Only a file window can save a file." };
      if (file.error) return { ok: false, error: "This file was opened read-only." };
      if (typeof arg?.content !== "string") return { ok: false, error: "Nothing to save." };
      try {
        writeLocalFileAtomic(file.path, arg.content);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      // Recorded before the watcher can read it back, so our own write is not
      // mistaken for somebody else's.
      file.content = arg.content;
      return { ok: true };
    }
  );
  // The dot in the title bar. Set by the window, because the write is debounced
  // and only the window knows an edit is waiting.
  ipcMain.on("markbase:local-file-edited", (e, arg: { edited: boolean }) => {
    const win = viewerWindow(e);
    if (!win) return;
    const edited = Boolean(arg?.edited);
    if (edited) viewerDirty.add(e.sender.id);
    else viewerDirty.delete(e.sender.id);
    win.setDocumentEdited(edited);
  });
}

// ---- Pages rendered here, not fetched ---------------------------------------
// The documents surface and the viewer are built into the app (see
// vite.config.mts) and mount the SAME components the website renders. What
// travels is data, not a UI: the page opens at once, works on a plane, and
// there is exactly one copy of each component to fix. The Terms window that
// used to sit beside them is gone with its feature — this app ships the kernel
// and Documents, and a feature's own pages come through its package when it is
// released, not through a window hard-wired here.

/**
 * Where locally-rendered pages are served from.
 *
 * NOT file://. A page loaded over file:// has a null origin, and a null origin
 * cannot load an ES module — the module fetch is a CORS fetch and it is refused
 * before a line of it runs, leaving a white window and one console line. Vite
 * emits modules, and that is not a thing to work around.
 *
 * A registered standard scheme gives the page a real, secure origin instead, so
 * modules, fetch and CSP all behave the way they do on the web. Which is the
 * point of the exercise: the same component, under the same rules, in both
 * shells.
 *
 * Must be declared BEFORE app is ready — Chromium fixes its scheme registry at
 * startup — hence the call at module scope.
 */
const LOCAL_SCHEME = "markbase";

protocol.registerSchemesAsPrivileged([
  {
    scheme: LOCAL_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

/**
 * The documents surface, rendered by this app rather than fetched from the site.
 *
 * The same paths the website uses, on this app's own origin. The surface routes
 * on them (`/dashboard/documents/<id>?vault=…`, written with pushState as tabs
 * open), so a reload, a Back, or a cold open on a document path all have to
 * resolve — localPath below folds every one of them onto the one built page.
 */
const HOME_URL = `${LOCAL_SCHEME}://app/dashboard/documents`;

/** Which built file a path on markbase://app names. */
function localPath(pathname: string): string {
  // Vite writes asset URLs relative to the page (`../assets/x.js`). From a
  // routed path that lands under /dashboard — so this rule has to come first,
  // or the page is served in place of its own script and renders nothing.
  const asset = pathname.match(/\/assets\/([^/]+)$/);
  if (asset) return `/assets/${asset[1]}`;
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    return "/dashboard/index.html";
  }
  return pathname;
}

/** Serve dist/renderer over markbase://app/… — and nothing outside it. */
function registerLocalScheme(): void {
  const rendererRoot = join(__dirname, "renderer");
  protocol.handle(LOCAL_SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    const file = join(rendererRoot, decodeURIComponent(localPath(pathname)));
    // `join` already collapses `..`, so this compares the resolved path. A URL
    // that climbs out of the renderer directory is answered with a 404 rather
    // than with whatever it was reaching for.
    if (file !== rendererRoot && !file.startsWith(rendererRoot + sep)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

/**
 * The API, reached from a locally-rendered page.
 *
 * The page never holds the key and never makes the call. It hands the request
 * over here, this process attaches the key it keeps and makes the call with
 * Node's fetch — the same way the vault daemon already talks to the API — and
 * the page gets the status, headers and body back to rebuild a Response from.
 *
 * Two things follow from the key living here. A page can reach only the API
 * (`/api/...` on the app's own origin): any other path, host or scheme is
 * refused, so the bridge cannot be turned into "fetch anything with my key".
 * And only this app's own pages may ask: the main window shows the website,
 * which is signed in by cookie and has its own fetch, and a sign-in page it
 * navigates to is not ours at all.
 */
function registerApiIpc(): void {
  ipcMain.handle("markbase:api", async (e, req: DesktopApiRequest): Promise<DesktopApiResponse> => {
    if (!isLocalPage(e.senderFrame?.url)) throw new Error("Only the app's own pages may use the API bridge.");
    const url = apiUrl(req.path);
    const headers = new Headers(req.headers);
    const apiKey = readApiKey();
    if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);
    else headers.delete("authorization");
    const res = await fetch(url, { method: req.method, headers, body: apiBody(req.body) });
    return {
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers),
      body: await res.text(),
    };
  });
}

/**
 * Is this frame one of the pages this app serves itself (markbase://app)?
 *
 * Compared by scheme and host, not `origin`: the URL parser knows no origin for
 * a scheme it did not grow up with and answers "null" for markbase://, which
 * would refuse every page this app has.
 */
function isLocalPage(frameUrl: string | undefined): boolean {
  if (!frameUrl) return false;
  try {
    const url = new URL(frameUrl);
    return url.protocol === `${LOCAL_SCHEME}:` && url.host === "app";
  } catch {
    return false;
  }
}

/**
 * The one place a page may send a request: `/api/...` on the app's origin.
 *
 * Resolved against APP_URL and checked AFTER resolving, so a path that is really
 * an absolute URL (`https://elsewhere/`), a protocol-relative one (`//host/`), or
 * a traversal that climbs out of `/api/` is refused by what it resolves to,
 * not by what it looks like.
 */
function apiUrl(path: string): URL {
  const base = new URL(APP_URL);
  let url: URL;
  try {
    url = new URL(path, base);
  } catch {
    throw new Error(`Not an API path: ${path}`);
  }
  if (url.origin !== base.origin || !url.pathname.startsWith("/api/")) {
    throw new Error(`Not an API path: ${path}`);
  }
  return url;
}

/**
 * The request body as the page sent it. A string crosses IPC as it is; a form
 * (the asset upload) crosses as its fields, with each file's bytes, and is
 * rebuilt here so Node's fetch writes the multipart encoding itself.
 */
function apiBody(body: DesktopApiRequest["body"]): string | FormData | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  const form = new FormData();
  for (const field of body.form) {
    if ("bytes" in field) {
      form.append(field.name, new Blob([Buffer.from(field.bytes)], { type: field.type }), field.filename);
    } else {
      form.append(field.name, field.value);
    }
  }
  return form;
}

/**
 * What a locally-rendered page needs to know about the API: where it is, and
 * whether this machine is signed in. Not the key itself — that never leaves
 * this process (see registerApiIpc).
 */
function registerCredentialsIpc(): void {
  ipcMain.handle("markbase:credentials", (): DesktopCredentials => ({
    appUrl: APP_URL,
    loggedIn: readApiKey() !== null,
  }));
  // A page whose key the API refused — revoked, or the account changed — asks
  // for a new one here. The flow takes the window over and brings it back to
  // HOME_URL on its own; the page only learns whether it worked.
  ipcMain.handle("markbase:sign-in", async (): Promise<boolean> => {
    const ok = await signIn();
    buildMenu();
    return ok;
  });
  ipcMain.handle("markbase:sign-out", async (): Promise<void> => {
    await signOut();
  });
  // The main window asks, once it is showing a signed-in account, whether to
  // offer making this app the default for markdown files. A yes is recorded
  // here, before the toast is even drawn: the offer is made once per machine.
  ipcMain.handle("markbase:default-opener-offer", async (): Promise<boolean> => {
    const facts = {
      platform: process.platform,
      packaged: app.isPackaged,
      signedIn: signedIn(),
      offeredBefore: Boolean(loadSettings().defaultOpenerOfferedAt),
    };
    // Asked without the opener first: it is the one fact that costs a process
    // to learn, and on every launch after the first the answer is no without it.
    if (!shouldOfferDefaultOpener({ ...facts, currentOpener: null })) return false;
    const offer = shouldOfferDefaultOpener({
      ...facts,
      currentOpener: await defaultMarkdownOpener(),
    });
    // Re-read: the await let other writers in.
    saveSettings({ ...loadSettings(), defaultOpenerOfferedAt: new Date().toISOString() });
    return offer;
  });
  ipcMain.handle("markbase:default-opener-accept", (): Promise<boolean> =>
    becomeDefaultMarkdownOpener()
  );
}

// ---- The team instance -------------------------------------------------------
// "Connect to a team instance" in the onboarding window: which Markbase this
// app talks to (SELF-HOSTING.md). The page asks where the app points and asks
// for a change; the decision is in instance.ts, and what it decides to do with
// a change is save it, drop the key and relaunch — APP_URL and the Supabase
// pair are read once at launch, so a new instance means a new process.

/**
 * Come back up on the instance just saved. `app.quit()` rather than
 * `app.exit()`: quitting runs before-quit, which closes the daemons' channels
 * and releases the vault locks and the ticket worker's lock, bounded at 3 s —
 * an exit would leave them for the new process to find held. The relaunch is
 * armed first and fires when this process is gone. The at-login flag is
 * dropped: this relaunch is the person's own doing, and they want a window.
 */
function relaunchApp(): void {
  app.relaunch({ args: process.argv.slice(1).filter((a) => a !== AT_LOGIN_FLAG) });
  app.quit();
}

/** What connecting to an instance needs from this process — the same for the
 *  Settings dialog, the onboarding card and a join link. */
function instanceDeps() {
  return {
    current: { appUrl: APP_URL, supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY },
    save: saveInstance,
    // A key belongs to one instance: the next process signs in afresh, and
    // must not borrow the CLI's key either, which is the old instance's too.
    forgetKey: clearApiKey,
    relaunch: relaunchApp,
    log: logVault,
  };
}

function registerInstanceIpc(): void {
  ipcMain.handle(
    "instance:current",
    (): InstanceStatus => instanceStatus(APP_URL, Boolean(process.env.APP_URL))
  );
  ipcMain.handle("instance:connect", (_e, arg: { url: string }) =>
    connectToInstance(arg.url, instanceDeps())
  );
}

/** The host of an instance URL, for a sentence; the URL itself if it won't parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Settings is in the main window (the rail's account menu); the tray and the
 *  Vaults menu reach it from outside. */
function openSettings(): void {
  showMainWindow();
  appWindow()?.webContents.send("markbase:open-settings");
}

// ---- Join links -------------------------------------------------------------
// An instance's /join page offers markbase://connect?instance=<url>&code=<invite>
// (@markbase/protocol/instance). The OS hands it to this app — `open-url` on
// macOS, argv on Windows and Linux, and on either the second process when one
// is already running — and the app does what "Change Instance…" did: confirms,
// signs out, saves, restarts on the instance. Nobody types the address.

/** Who this app is signed in as, by asking the instance — or null when it is
 *  signed out or the instance cannot be reached. */
async function signedInEmail(): Promise<string | null> {
  const apiKey = readApiKey();
  if (!apiKey) return null;
  try {
    const res = await fetch(apiUrl("/api/v1/me"), {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const me: { owner_email?: string; owner_name?: string } = await res.json();
    return me.owner_email ?? me.owner_name ?? null;
  } catch {
    return null;
  }
}

/**
 * A join link, acted on. Asks first, and asks the person rather than the
 * machine: it names the account that is signed in here, because joining is a
 * decision about that account — it is signed out of this app, and the person
 * signs in on the team's instance, which keeps its own accounts. A link is a
 * thing anyone can put on a page, so nothing happens without the answer.
 */
async function handleConnectLink(raw: string): Promise<void> {
  const link = parseConnectLink(raw);
  if (!link) {
    logVault(`link ignored: ${raw}`);
    return;
  }
  const target = link.appUrl;
  if (target === APP_URL) {
    showMainWindow();
    // Already pointed here but not signed in, and the link came with the
    // invite code: this is the invited person, back on the link after a
    // launch that landed on /login (or a join that did not finish). Nothing to
    // switch; go straight to creating the account.
    if (link.inviteCode && !readApiKey()) {
      setPendingInvite(link.inviteCode);
      void signIn();
      return;
    }
    await dialog.showMessageBox({
      type: "info",
      message: `Already on ${hostOf(target)}`,
      detail: "This app is connected to that instance.",
      buttons: ["OK"],
    });
    return;
  }
  const email = await signedInEmail();
  const { response } = await dialog.showMessageBox({
    type: "question",
    message: email ? `Join ${hostOf(target)} as ${email}?` : `Join ${hostOf(target)}?`,
    detail: email
      ? `You're signed in as ${email} on ${hostOf(APP_URL)}. Joining signs that account out of this app ` +
        `and restarts it on ${target} to join the team.`
      : `This restarts the app on ${target} to join the team.`,
    buttons: ["Join", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;
  // Saved before the connect, which relaunches the app on success; the next
  // process reads it at its first sign-in. Dropped again if nothing changed.
  setPendingInvite(link.inviteCode);
  const res = await connectToInstance(target, instanceDeps());
  if (!res.ok || !res.changed) setPendingInvite(null);
  if (!res.ok) dialog.showErrorBox("Couldn't join the instance", res.error);
}

/**
 * Links that arrived before the app was ready. `open-url` fires before
 * app.whenReady() on a cold launch — clicking the join link with the app closed
 * is the ordinary case — so they wait until there is somewhere to answer.
 */
const pendingLinks: string[] = [];
let linksReady = false;

function acceptLink(url: string): void {
  if (!linksReady) {
    pendingLinks.push(url);
    return;
  }
  void handleConnectLink(url);
}

/** The join links in a command line: how Windows and Linux hand them over. */
function connectLinksIn(argv: string[]): string[] {
  return argv.filter((a) => a.startsWith("markbase://"));
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  acceptLink(url);
});

// ---- Onboarding: connecting Claude ------------------------------------------
// A separate, local window. The main window loads the web app from APP_URL, and
// this must work before any of that — including with no network — so it is its
// own BrowserWindow over an inlined local page rather than a route over there.

let onboardingWin: BrowserWindow | null = null;
let login: LoginHandle | null = null;

/** The inlined page, written out so it can be loaded as a real file:// page. */
function onboardingFile(): string {
  const path = join(app.getPath("userData"), "onboarding.html");
  writeFileSync(path, ONBOARDING_HTML);
  return path;
}

/**
 * Open the onboarding window. `section` scrolls it to one part of the page —
 * "instance" is the team instance control, which the tray and the Vaults menu
 * open directly — by loading the page with that fragment (the page reads
 * location.hash). A window already open is brought forward and, when a section
 * was asked for, sent there.
 */
function openOnboarding(section?: "instance"): void {
  const hash = section ? { hash: section } : undefined;
  if (onboardingWin && !onboardingWin.isDestroyed()) {
    onboardingWin.focus();
    if (hash) void onboardingWin.loadFile(onboardingFile(), hash);
    return;
  }
  onboardingWin = new BrowserWindow({
    width: 520,
    // Tall enough for the signed-in account card AND the instance card below it.
    height: 820,
    resizable: false,
    title: "Connect Claude",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.js"),
      additionalArguments: windowArgs("onboarding"),
    },
  });
  onboardingWin.on("closed", () => {
    // A window closed mid-flow leaves a child process blocked on stdin forever.
    login?.cancel();
    login = null;
    onboardingWin = null;
  });
  void onboardingWin.loadFile(onboardingFile(), hash);
}

/**
 * Is Claude connected? If not, put the sign-in window up and say so.
 *
 * Called when the user reaches for the agent — NOT at launch. Most of what this
 * app does (reading, editing, syncing a vault) needs no Claude at all, and
 * demanding a sign-in from someone who only wants to open a document is asking
 * for a password at the front door of a building they may never enter a room in.
 * The cost is one subprocess, paid the first time it can actually matter.
 */
async function ensureClaudeReady(): Promise<{ ready: boolean; error?: string }> {
  const status = await claudeAuthStatus();
  if (status.loggedIn) return { ready: true };
  openOnboarding();
  return { ready: false, error: status.error };
}

function registerClaudeAuthIpc(): void {
  ipcMain.handle("claude-auth:status", () => claudeAuthStatus());
  // What the bot button calls before it opens: returns ready, or puts the
  // sign-in window up and returns false so the caller can stand down.
  ipcMain.handle("claude-auth:ensure", () => ensureClaudeReady());
  ipcMain.handle("claude-auth:logout", () => claudeLogout());
  ipcMain.handle("claude-auth:close-onboarding", () => {
    onboardingWin?.close();
  });

  ipcMain.on("claude-auth:login", (e, arg: { mode: "subscription" | "console" }) => {
    login?.cancel(); // never two flows racing for one stdin
    const send = (data: { type: string; [k: string]: unknown }): void => {
      if (!e.sender.isDestroyed()) e.sender.send("claude-auth:login-event", data);
    };
    login = startClaudeLogin(arg.mode, {
      onUrl: (url) => {
        // The CLI opens the browser itself; this covers the case where it can't
        // (no default handler, or a sandbox that blocks it).
        void shell.openExternal(url);
        send({ type: "url", url });
      },
      onNeedsCode: () => send({ type: "needs-code" }),
      onOutput: (text) => send({ type: "output", text }),
      onDone: (result) => {
        login = null;
        send({ type: "done", ...result });
      },
    });
  });

  ipcMain.on("claude-auth:login-code", (_e, arg: { code: string }) => {
    login?.submitCode(arg.code);
  });
  ipcMain.on("claude-auth:login-cancel", () => {
    login?.cancel();
    login = null;
  });

  // Only http(s). A renderer must never be able to hand the OS an arbitrary
  // scheme — file://, or a registered app handler — through this bridge.
  ipcMain.on("markbase:open-external", (_e, arg: { url: string }) => {
    if (/^https?:\/\//.test(arg.url)) {
      void shell.openExternal(arg.url);
      return;
    }
    // A `file://` link to something on this Mac. A vault holds notes ABOUT files
    // that live elsewhere — a passport scan in iCloud Drive, a PDF in Downloads —
    // and a checklist of them is worth nothing if the entries can't be opened.
    // The browser can't do this (an http: page may not follow file:), which is
    // why it has to be the shell.
    if (arg.url.startsWith("file://")) void openLocalFile(arg.url);
    // Anything else — mailto:, custom schemes — is deliberately not handled.
  });
}

// One Markbase per account. Finder never opens a second copy of a running app,
// but the launch agent runs the executable directly, which Finder's rule does
// not cover: with the agent's copy already in the menu bar, a Dock click or a
// stray `open` must land on it rather than start another, which would then
// fight it for the worker and vault locks and put a second icon in the bar.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    showMainWindow();
    connectLinksIn(argv).forEach(acceptLink);
  });
}

app.whenReady().then(async () => {
  // The join link's scheme (SELF-HOSTING.md): the same name as the renderer's
  // own pages use, which is what the packaged Info.plist declares (package.json
  // build.protocols). Registering here covers the development binary too.
  app.setAsDefaultProtocolClient(LOCAL_SCHEME);

  // FIRST, before anything reads the registry, the locks, or a sync base: this
  // and the CLI both call it, because whichever starts first has to be the one
  // that moves the directory and the other must find it already moved.
  const move = migrateHome();
  if (move.migrated) logVault(`moved settings to ${markbaseHome()} — ${move.moved.join(", ")}`);
  else if (move.error) logVault(`couldn't move settings out of ~/.config/markbase: ${move.error}`);

  // No Supabase client is configured here any more: the vault daemons, the
  // window's CRDT host and the ticket worker all reach the API with this
  // machine's key (security lockdown stage 2). The project in SUPABASE_URL /
  // SUPABASE_KEY above is handed to the windows alone (windowArgs), for the
  // renderer's live document channel.
  configureCrdtHost(APP_URL, readApiKey, logVault);

  // An install from before the registries merged kept its mounts in the app's
  // own settings. Move them across once, then forget them — the shared registry
  // wins from here.
  const legacy = loadSettings().legacyVaults ?? loadSettings().vaults ?? [];
  if (legacy.length > 0) {
    // Awaited: the registry takes a lock and writes atomically now, so this is
    // async. Without the await the log below counted a Promise and said
    // "adopted undefined vault(s)" — and the settings below were cleared before
    // the adoption had actually landed, which is how a mount goes missing.
    const adopted = await adoptLegacyVaults(legacy);
    const s = loadSettings();
    delete s.legacyVaults;
    delete s.vaults;
    saveSettings(s);
    logVault(
      `adopted ${adopted.length} vault(s) from this app's old list into ${VAULT_REGISTRY_PATH}`
    );
  }

  // The dock icon. A packaged build gets it from build/icon.icns (electron-builder),
  // but a dev run (`npm start`) shows Electron's default unless we set it here.
  if (!app.isPackaged && app.dock) {
    // The composited icon (rounded, padded, on-brand) that `npm run icon` builds —
    // NOT the raw full-bleed logo, which looks oversized and square in the dock.
    const devIcon = join(app.getAppPath(), "build", "icon.png");
    try {
      if (existsSync(devIcon)) app.dock.setIcon(devIcon);
    } catch {
      // A missing/bad icon must never stop the app from opening.
    }
  }

  /**
   * Which vaults this machine syncs, and where. The web UI lists every vault the
   * ACCOUNT has; only the shell knows which of them exist as folders here, so
   * without this the list can't tell a vault you can open in Finder from one that
   * lives only in the cloud — and it offered no way to mount the latter.
   */
  ipcMain.handle(
    "markbase:mounted-vaults",
    (): { vaultId: string; name: string; dir: string }[] =>
      myMounts().map((v) => ({ vaultId: v.vaultId, name: v.name, dir: v.dir }))
  );

  /**
   * Vaults this machine was deliberately told to stop syncing.
   *
   * The app hides these entirely: unmounting one here means "I don't work on
   * this on this Mac", and leaving it in the list as a cloud-only row is not
   * what was asked for. A vault that simply has never been mounted here — made
   * on the web, or on another machine — is NOT in this list and stays visible,
   * because hiding those would leave no way to bring them onto this Mac.
   *
   * Mounting a vault again clears its tombstone (see updateMountedVaults), so
   * it comes back without anything here having to remember it.
   */
  ipcMain.handle("markbase:unmounted-vaults", (): string[] => readUnmountedVaults());

  // The Shared Vault's forks, for the banner on a forked document. Both texts
  // come from the daemon in this process — the cloud's from its shadow, the
  // local one from the file — so comparing needs no request.
  ipcMain.handle("markbase:shared-forks", (): LocalFork[] => sharedForks);
  ipcMain.handle("markbase:fork-compare", (_e, arg: { docId: string }) =>
    forkControl?.compare(arg.docId) ?? null
  );
  ipcMain.handle("markbase:fork-discard", (_e, arg: { docId: string }): { ok: boolean; error?: string } => {
    if (!forkControl) return { ok: false, error: "The Shared Vault isn't syncing on this Mac right now." };
    return forkControl.discard(arg.docId)
      ? { ok: true }
      : { ok: false, error: "That document has no local-only edits any more." };
  });
  // Keep the person's text as a document of their own, in a vault of their own,
  // then drop the fork. The copy is made through the API with this app's key,
  // so it is a document like any other — editable, shareable, synced.
  ipcMain.handle(
    "markbase:fork-keep-copy",
    async (_e, arg: { docId: string; vaultId: string }): Promise<{ ok: boolean; error?: string; docId?: string }> => {
      const both = forkControl?.compare(arg.docId);
      if (!both) return { ok: false, error: "That document has no local-only edits any more." };
      const apiKey = readApiKey();
      if (!apiKey) return { ok: false, error: "Sign in first." };
      try {
        const res = await fetch(`${APP_URL}/api/v1/docs`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ title: `${both.title} (my copy)`, content: both.local, vault_id: arg.vaultId }),
        });
        if (!res.ok) return { ok: false, error: `Couldn't create the copy (${res.status}).` };
        const body = (await res.json()) as { doc?: { id?: string } };
        forkControl?.discard(arg.docId);
        sendVaultDocsChanged(arg.vaultId);
        logVault(`[${SHARED_VAULT_NAME}] kept a copy of ${both.path} as ${body.doc?.id ?? "a new document"}`);
        return { ok: true, docId: body.doc?.id };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  );

  // The web New Vault modal (on desktop) mounts a freshly-created vault here.
  ipcMain.handle(
    "markbase:mount-vault",
    (
      _e,
      arg: { vaultId: string; name: string; isFirstVault: boolean; dir?: string }
    ): Promise<MountOutcome> =>
      // No folder picked in the dialog: it said ~/Markbase/<name> is the
      // default, so that is where it goes — without a picker.
      mountVaultToFolder(arg.vaultId, arg.name, arg.isFirstVault, arg.dir, { defaultToHome: true })
  );

  /**
   * Stop syncing a vault on THIS machine, from the vault settings menu.
   *
   * Until now the only way to unmount from the app was a native menu item, so
   * the web UI could offer Mount and had no way back. It goes through the same
   * host unmountVault the menu uses — tombstone, then a supervisor pass, then
   * rebuild the menu — rather than touching the registry directly, because the
   * daemon stopping and the tombstone are the parts that matter and they live
   * there.
   *
   * Takes a vault id because that is what the web app has; the folder is ours
   * to look up. A vault that is not mounted here is not an error worth a
   * dialog — the UI simply has a staler view than we do.
   */
  ipcMain.handle(
    "markbase:unmount-vault",
    async (_e, arg: { vaultId: string }): Promise<{ ok: boolean; error?: string }> => {
      const v = myMounts().find((m) => m.vaultId === arg.vaultId);
      if (!v) return { ok: false, error: "That vault isn't synced to a folder on this Mac." };
      try {
        await unmountVault(v);
        return { ok: true };
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        logVault(`[${v.name}] unmount failed: ${detail}`);
        return { ok: false, error: detail };
      }
    }
  );

  // Where a new vault would go, and whether it may — asked before Create.
  ipcMain.handle("markbase:check-folder", (_e, arg: { name: string; dir?: string }) =>
    checkNewVaultFolder(arg.name, arg.dir)
  );

  // Just the folder picker, with no vault to mount yet. The modal's "Local folder"
  // row looks like a chooser — dashed border, folder icon — so it has to BE one;
  // it was inert text, and clicking it did nothing at all. The vault row does not
  // exist until Create is pressed, so the path is picked here and mounted after.
  ipcMain.handle(
    "markbase:choose-folder",
    (_e, arg: { name?: string; isFirstVault?: boolean }) =>
      chooseVaultFolder(arg.name ?? "", arg.isFirstVault ?? false)
  );

  // The web "Open in agent" menu (DocActionSet) opens a local agent in the vault's
  // mounted folder. GUI agents (Cursor / Claude Desktop) open externally here; CLI
  // agents (Claude Code / Codex) run in the app's embedded terminal via the PTY
  // handlers below.
  ipcMain.handle(
    "markbase:open-agent",
    (_e, arg: { agentId: string; vaultId: string; docId?: string }) =>
      openAgentInVault(arg.agentId, arg.vaultId)
  );

  // Embedded-terminal PTYs (Claude Code / Codex panels).
  ipcMain.handle(
    "markbase:pty-start",
    (
      _e,
      arg: { ptyId: string; agentId: string; vaultId: string; cols: number; rows: number }
    ) => startPty(arg)
  );
  ipcMain.on("markbase:pty-input", (_e, arg: { ptyId: string; data: string }) => {
    ptys.get(arg.ptyId)?.write(arg.data);
  });
  ipcMain.on(
    "markbase:pty-resize",
    (_e, arg: { ptyId: string; cols: number; rows: number }) => {
      try {
        ptys.get(arg.ptyId)?.resize(arg.cols, arg.rows);
      } catch {
        // pty already gone / bad size — ignore
      }
    }
  );
  ipcMain.on("markbase:pty-kill", (_e, arg: { ptyId: string }) => {
    ptys.get(arg.ptyId)?.kill();
    ptys.delete(arg.ptyId);
  });

  // The vault's own index of which document each file is (see vault-index.ts in
  // core). Lets the window list a vault, and resolve a file to a document,
  // without asking the API — the mapping the daemon already computed, read off
  // disk. Null when this vault isn't mounted here or has never synced.
  ipcMain.handle(
    "markbase:vault-index",
    (_e, arg: { vaultId: string }): VaultIndex | null => {
      const dir = findVaultDir(arg.vaultId);
      return dir ? readVaultIndex(dir) : null;
    }
  );

  // The editor's CRDT transport (see crdt-host.ts). The renderer used to fetch a
  // document's snapshot from Supabase itself, which put a network round trip
  // between clicking a document and seeing it. These serve it from disk.
  ipcMain.handle(
    "crdt:load",
    async (e, arg: { docId: string }): Promise<Uint8Array | null> => {
      const bytes = await crdtLoad(arg.docId, e.sender);
      // Buffer survives the structured clone; a bare Uint8Array does not.
      return bytes ? Buffer.from(bytes) : null;
    }
  );
  ipcMain.handle("crdt:has", (_e, arg: { docId: string }): boolean => crdtHas(arg.docId));
  ipcMain.handle(
    "crdt:save",
    (_e, arg: { docId: string; bytes: Uint8Array }): Promise<void> =>
      crdtSave(arg.docId, new Uint8Array(arg.bytes))
  );
  ipcMain.on("crdt:release", (e, arg: { docId: string }) => {
    crdtRelease(arg.docId, e.sender);
  });

  // Native agent chat (Claude via the Agent SDK).
  ipcMain.handle(
    "agent-chat:start",
    (
      e,
      arg: {
        sessionId: string;
        prompt: string;
        vaultId: string;
        docId?: string;
        docPath?: string;
        resume?: string;
      }
    ) => startAgentChat(e.sender, arg)
  );
  // Interrupt, not kill: the panel wants THIS turn to stop, and the session it
  // belongs to is still the one the next message continues.
  ipcMain.on("agent-chat:cancel", (_e, arg: { sessionId: string }) => {
    void chats.get(arg.sessionId)?.session.interrupt();
  });

  // Persisted sessions: the `.chat/` index in the vault (doc links + titles) and
  // the transcript read back from ~/.claude (the source of truth for messages).
  // The panel is gone for good (unmounted, or the window closed). Ending the
  // session closes the CLI's stdin, which is how its process exits — without
  // this a `claude` would be left running for every chat ever opened.
  ipcMain.on("agent-chat:close", (_e, arg: { sessionId: string }) => {
    const chat = chats.get(arg.sessionId);
    if (!chat) return;
    chats.delete(arg.sessionId);
    chat.session.close();
  });

  ipcMain.handle(
    "agent-chat:sessions:list",
    (_e, arg: { vaultId: string; docId?: string }): ChatSessionMeta[] => {
      const dir = findVaultDir(arg.vaultId);
      return dir ? listChatSessions(dir, arg.docId) : [];
    }
  );
  ipcMain.handle(
    "agent-chat:sessions:get",
    (_e, arg: { vaultId: string; id: string }): ChatSessionMeta | null => {
      const dir = findVaultDir(arg.vaultId);
      return dir ? getChatSession(dir, arg.id) : null;
    }
  );
  ipcMain.handle("agent-chat:sessions:save", (_e, arg: { vaultId: string; meta: ChatSessionMeta }) => {
    const dir = findVaultDir(arg.vaultId);
    if (dir) saveChatSession(dir, arg.meta);
  });
  ipcMain.handle("agent-chat:sessions:delete", (_e, arg: { vaultId: string; id: string }) => {
    const dir = findVaultDir(arg.vaultId);
    if (dir) deleteChatSession(dir, arg.id);
  });
  ipcMain.handle(
    "agent-chat:transcript",
    (_e, arg: { vaultId: string; sessionId: string }) => {
      const dir = findVaultDir(arg.vaultId);
      // cwd is the vault dir — the same cwd the session runs under.
      return dir ? readTranscript(dir, arg.sessionId) : null;
    }
  );

  registerClaudeAuthIpc();
  registerCredentialsIpc();
  registerInstanceIpc();
  registerApiIpc();
  registerLocalScheme();
  registerViewerIpc();
  // Which Claude this build runs. Worth a line: "it works on my machine" and
  // "it works for a downloaded user" differ precisely here, and a missing binary
  // is otherwise indistinguishable from a sign-in problem.
  logVault(
    bundledClaudePath()
      ? `claude: bundled at ${bundledClaudePath()}`
      : `claude: NOT BUNDLED — agent features will not work. Looked in ${bundledClaudeSearchPaths().length} places.`
  );
  buildMenu();
  // Opened by the launch agent at login (or relaunched after a crash): the menu
  // bar icon is the whole of it until someone clicks it or the Dock icon.
  if (!launchedAtLogin()) createWindow();
  // Anything Finder handed us before the app was ready — AFTER the main window,
  // for two reasons. A window created later stacks in front, so a viewer opened
  // first was then buried under the main window as it appeared: a 1280×860
  // white rectangle over an 820×900 document, which is how "double-click a .md"
  // looked on a cold launch. And a file inside a mounted vault opens in the
  // main window, so there has to be one by the time the path is resolved;
  // before this, that branch found no window and fell through to the viewer —
  // the dead copy it exists to avoid.
  openPendingFiles();

  // A first-run screen is otherwise visible exactly once per machine, which makes
  // it the least-tested surface in the app — and the one every new user meets first.
  if (process.env.MARKBASE_ONBOARDING === "1") openOnboarding();

  // Not awaited: it asks the API which vaults exist, and the window must not wait
  // on that. Runs again after a sign-in, for the (normal) case where this machine
  // had no key yet when it first fired.
  void offerFirstMount().catch((e) =>
    logVault(`couldn't offer a first mount: ${e instanceof Error ? e.message : String(e)}`)
  );

  // Whose key is this? Asked before the first pass so the pass already knows
  // which mounts are this account's. Offline it stays unknown, and every pass
  // asks again before starting anything (startVaultDaemon).
  await rememberOwnerId();
  await startSupervisor().settled();

  // The app's face while the window is closed — and the only Quit a person
  // will find once it is.
  installTray({ items: trayItems });

  // Tickets, under the same key the vaults sync under. The host loop runs for
  // the life of the process; a missing key or binary is a state it waits in,
  // not an error it stops on.
  if (TICKETS_OFF) logVault("tickets: off (MARKBASE_TICKETS=off) — vault sync only");
  else ticketWorker = startTicketWorkerHost({
    appUrl: APP_URL,
    readApiKey,
    claudeBin: bundledClaudePath,
    // A repo scan looks only inside this account's mounted folders. Nothing
    // else on the machine is Markbase's to read.
    mountedDirs: () => myMounts().map((v) => v.dir),
    log: logVault,
  });

  // A vault deleted in the cloud while the app was closed gets trashed locally on
  // this first pass; then a slow poll catches deletions made while it's running
  // (the window-focus handler covers the common case immediately).
  void reconcileVaults();
  setInterval(() => void reconcileVaults(), 30_000);

  // Last: an install from before the agent existed, already signed in, gets
  // its agent here; the switch, once turned off, is respected.
  ensureLaunchAgent();
});

// Registered after the ready callback above, so it runs once that one has
// started: the links the OS handed over before then, and any on this process's
// own command line, are answered now.
app.whenReady().then(() => {
  linksReady = true;
  connectLinksIn(process.argv).forEach((l) => pendingLinks.push(l));
  for (const l of pendingLinks.splice(0)) void handleConnectLink(l);
});

// Let the daemons close their channels and flush before the app exits.
app.on("before-quit", (e) => {
  // A file window with unsaved edits stops its own close to write them, which
  // also stops the quit; it resumes it (see openViewer) once the write lands.
  quitRequested = true;
  // The app.quit() at the end of our own shutdown comes back through here. Let
  // it exit rather than starting the shutdown over.
  if (shuttingDown) return;
  // Nothing can finish a sign-in after this point, and the loopback must not
  // outlive the process that opened it.
  cancelSignIn();
  // A ticket in flight is killed and left for the next worker to reclaim; the
  // lock is released so the CLI service, if there is one, can take over.
  ticketWorker?.stop();
  // Every chat is holding a CLI open; they are ours to close.
  for (const chat of chats.values()) chat.session.close();
  chats.clear();
  // Only wait on daemons we actually started: a vault held by the CLI service is
  // desired here but not running, and blocking quit on it would hang the app.
  if (!supervisor || supervisor.running().length === 0) return;
  e.preventDefault();
  shuttingDown = true;
  // Give the daemons a moment to close their channels, but NEVER let a stuck one
  // trap the user. supervisor.stop() awaits each daemon's own stop, and a daemon
  // mid network I/O can leave that pending for a long time — which is the app
  // that "stops responding" and demands Force Quit on every quit. Quit after at
  // most 3s regardless: an abandoned sync reconverges on next launch (the store
  // is a CRDT), a wedged app does not.
  const bounded = Promise.race([
    supervisor.stop(),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);
  void bounded.then(() => app.quit());
});

// Clicking the dock icon with no windows open re-creates one. Registered at
// module scope, NOT inside app.whenReady().then(...), and for a specific reason:
// that callback awaits the vault supervisor settling, and if any of those awaits
// rejects, everything after it — including this handler, when it lived there —
// never runs. The first window opens fine (createWindow is called before those
// awaits), but reopening after closing every window did nothing, because nothing
// was listening for activate. open-file and window-all-closed were always out
// here; this belongs beside them.
app.on("activate", showMainWindow);

/**
 * Bring the app window back. It usually still exists, just hidden (see its
 * close handler) — re-show it, keeping everything it held. Create a fresh one
 * only when there is genuinely no app window to restore. The Dock icon and
 * the tray's Open both land here.
 */
function showMainWindow(): void {
  const main = appWindow();
  if (main) {
    main.show();
    main.focus();
  } else {
    createWindow();
  }
}

/** One line on tickets for the tray, from what the worker host last said. */
function ticketsLine(status: TicketWorkerStatus): string {
  switch (status.kind) {
    case "signed-out":
      return "Tickets: signed out";
    case "no-claude":
      return "Tickets: this build has no Claude";
    case "waiting":
      return `Tickets: run by the ${status.holder} right now`;
    case "idle":
      return "Tickets: ready";
    case "job":
      return `Running ticket ${status.ticketId.slice(0, 8)}…`;
    case "failed":
      return `Tickets: ${status.message.slice(0, 60)}`;
  }
}

/**
 * What the menu bar icon offers. Built on every click (see tray.ts), so the
 * vault and ticket lines are what is true at that moment.
 */
function trayItems(): MenuItemConstructorOptions[] {
  const mounted = myMounts().length;
  const running = supervisor?.running().length ?? 0;
  const vaults = !signedIn()
    ? "Vaults: not syncing — signed out"
    : mounted === 0
      ? "No vaults mounted"
      : `${running} of ${mounted} vault${mounted === 1 ? "" : "s"} syncing`;
  const forkCount = sharedForks.length;
  return [
    { label: "Open Markbase", click: showMainWindow },
    { type: "separator" },
    { label: vaults, enabled: false },
    ...(forkCount > 0
      ? [
          {
            label: `${forkCount} document${forkCount === 1 ? "" : "s"} with local-only edits`,
            click: showMainWindow,
          },
        ]
      : []),
    {
      label: TICKETS_OFF
        ? "Tickets: off (MARKBASE_TICKETS=off)"
        : ticketsLine(ticketWorker?.status() ?? { kind: "signed-out" }),
      enabled: false,
    },
    { type: "separator" },
    { label: instanceLabel(), enabled: false },
    { label: "Settings…", click: openSettings },
    { type: "separator" },
    ...(canHaveLaunchAgent()
      ? [
          {
            label: "Start at login",
            type: "checkbox" as const,
            checked: launchAgentInstalled(launchAgentPath(), diskFs),
            click: () => setStartAtLogin(!launchAgentInstalled(launchAgentPath(), diskFs)),
          },
          { type: "separator" as const },
        ]
      : []),
    signedIn()
      ? { label: "Log out", click: () => void signOut() }
      : {
          label: "Sign in…",
          click: () => {
            showMainWindow();
            void signIn().then(buildMenu);
          },
        },
    { label: "Quit Markbase", click: () => app.quit() },
  ];
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
