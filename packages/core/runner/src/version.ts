import pkg from "../package.json";

/**
 * The version this engine reports as "worker version".
 *
 * The web app shows it on the Agents page and compares it against the minimum
 * that can fulfil a feature (MIN_SPAWN_WORKER_VERSION), so it has to say what
 * this code can do — not what wraps it. The CLI reports its own package
 * version, which is the same number: @markbase/cli is this engine plus a
 * command line, and the two are bumped together. The desktop app reports this
 * one directly, because its own version (the DMG's) says nothing about tickets.
 */
export const RUNNER_VERSION: string = pkg.version;
