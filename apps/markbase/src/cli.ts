import pkg from "../package.json";
import { runLogin } from "./login";
import { runInit } from "./init";
import { runDoctor } from "./doctor";
import { runStart } from "./start";
import { runInstallService, uninstallService } from "./service";
import { runUpdate } from "./update";
import { runMirror } from "./mirror";
import { runVaultSync } from "./vault-sync-run";
import { runVault } from "./vault";
import { runSkillInstall } from "./integration/skill";
import { runApi } from "./integration/api";
import { runMcp, runMcpInstall } from "./integration/mcp";
import { runInstance } from "./instance";
import { runReadAudit, runWriteAudit } from "./audit";

const HELP = `markbase — run a Markbase ticket worker on your machine.
It claims your tickets and executes them locally with Claude Code.

Usage:
  markbase login               Connect via the browser (recommended) — then
                             checks prerequisites and starts the service
                             (--app-url <url> to sign in to your team's own instance)
  markbase init                Connect by pasting an API key (headless/manual)
  markbase instance [url]      Show which instance this machine talks to, or point
                             it at a self-hosted one (the desktop app follows)
  markbase doctor              Check prerequisites (claude + API key; git/gh optional)
  markbase start               Run the worker in the foreground
  markbase install-service     Install + start it as a background service
                             (not needed on a Mac that has the desktop app)
  markbase uninstall-service   Stop + remove the background service
  markbase update              Upgrade to the latest CLI and restart the service
                             (--force to reinstall the current latest)
  markbase mirror [dir]        Mirror your documents to a local folder as .md files
                             (off / status / sync)
  markbase skill install       Install the docs agent skill into .claude/skills
                             (add --global for ~/.claude/skills)
  markbase api <endpoint>      Call a document endpoint (markbase api list to see all)
                             e.g. markbase api editDoc id=<doc> quote="a" insert="b"
  markbase mcp install         Add the doc tools to Claude Desktop, Claude Code,
                             Codex + Cursor (--desktop / --claude-code / --codex
                             / --cursor to pick specific ones)
  markbase mcp                 Run the MCP server (stdio) — Claude Desktop runs this
  markbase read-audit          Record which agent read which vault file — run by an
                             agent's hook (report to see the counts)
  markbase write-audit         Record which agent changed which characters of which
                             vault file — run by an agent's hook (report to see them)

First run:  markbase login
`;

import { migrateHome, markbaseHome } from "@markbase/vault";

async function main(): Promise<void> {
  // Before anything reads the registry, the locks, or a sync base. Both this and
  // the desktop app do it, because whichever starts first has to be the one that
  // moves it — and the other must then find it already there.
  const move = migrateHome();
  if (move.migrated) console.log(`moved settings to ${markbaseHome()} — ${move.moved.join(", ")}`);
  else if (move.error) console.warn(`couldn't move settings out of ~/.config/markbase: ${move.error}`);

  const cmd = process.argv[2];
  switch (cmd) {
    case "login":
      await runLogin(process.argv.slice(3));
      break;
    case "init":
      await runInit(process.argv.slice(3));
      break;
    case "instance":
      await runInstance(process.argv.slice(3));
      break;
    case "doctor": {
      const ok = await runDoctor();
      if (!ok) process.exitCode = 1;
      break;
    }
    case "start":
      await runStart();
      break;
    case "install-service":
      await runInstallService();
      break;
    case "uninstall-service":
      await uninstallService();
      break;
    case "update":
      await runUpdate(pkg.version, process.argv.slice(3));
      break;
    case "mirror":
      await runMirror(process.argv.slice(3));
      break;
    case "vault-sync":
      await runVaultSync();
      break;
    case "vault":
      await runVault(process.argv.slice(3));
      break;
    case "read-audit":
      await runReadAudit(process.argv.slice(3));
      break;
    case "write-audit":
      await runWriteAudit(process.argv.slice(3));
      break;
    case "api":
      await runApi(process.argv.slice(3));
      break;
    case "mcp":
      if (process.argv[3] === "install") await runMcpInstall(process.argv.slice(4));
      else await runMcp();
      break;
    case "skill": {
      const sub = process.argv[3];
      if (sub === "install" || sub === undefined) {
        await runSkillInstall(process.argv.slice(4));
      } else {
        console.error(`Unknown skill command: ${sub}\n`);
        console.log("Usage: markbase skill install [--global]");
        process.exitCode = 1;
      }
      break;
    }
    case "version":
    case "-v":
    case "--version":
      console.log(pkg.version);
      break;
    case undefined:
    case "help":
    case "-h":
    case "--help":
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
