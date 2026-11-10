import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import { type ChildProcess, type StdioOptions, spawn } from 'child_process';

import { cliPathRequiresNode, findNodeExecutable } from '../../../utils/env';
import type { ChildExit } from './cliExitWatch';
import {
  resolveWindowsCmdShimSpawnSpec,
  terminateSpawnedProcess,
  type WindowsCmdShimSpawnSpec,
} from '../../../utils/windowsCmdShim';

export function createCustomSpawnFunction(
  enhancedPath: string,
  /**
   * Called when the CLI exits. The SDK stores an exit as `exitError` and only
   * converts it into a thrown error at the points where it thinks to look, so a
   * death that lands anywhere else leaves the caller reading a stream that has
   * already stopped. Spawning is the one place that sees the process itself —
   * see cliExitWatch.ts for what the caller does with it.
   */
  onExit?: (info: ChildExit) => void
): (options: SpawnOptions) => SpawnedProcess {
  return (options: SpawnOptions): SpawnedProcess => {
    let { command } = options;
    let { args } = options;
    const { cwd, env, signal } = options;
    const shouldPipeStderr = !!env?.DEBUG_CLAUDE_AGENT_SDK;

    // The SDK only routes some script extensions through `node`; normalize the
    // remaining Node-backed paths here before Electron spawns with shell=false.
    if (command === 'node' || cliPathRequiresNode(command)) {
      const nodeFullPath = findNodeExecutable(enhancedPath);
      if (command === 'node') {
        if (nodeFullPath) {
          command = nodeFullPath;
        }
      } else {
        args = [command, ...args];
        command = nodeFullPath ?? 'node';
      }
    }

    const resolvedSpawnSpec = resolveWindowsCmdShimSpawnSpec({ args, command });

    // Do not pass `signal` directly to spawn() — Obsidian's Electron runtime
    // uses a different realm for AbortSignal, causing `instanceof EventTarget`
    // checks inside Node's internals to fail. Handle abort manually instead.
    // Explicit tuple type: an inferred string[] collapses spawn's overloads to
    // `never` (and downstream `.stdin`/`.kill` errors) under some @types/node.
    const stdio: StdioOptions = ['pipe', 'pipe', shouldPipeStderr ? 'pipe' : 'ignore'];
    const child = spawn(resolvedSpawnSpec.command, resolvedSpawnSpec.args, {
      cwd,
      // The SDK's env is a plain string dict; Node's ProcessEnv (augmented by
      // some hosts to require NODE_ENV) is structurally the same at runtime.
      env: env as NodeJS.ProcessEnv,
      stdio,
      windowsHide: true,
      ...(resolvedSpawnSpec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });
    installTreeAwareKill(child, resolvedSpawnSpec);

    if (onExit) {
      child.on('exit', (code, signal) => onExit({ code, signal }));
    }

    if (signal) {
      const killChild = (): void => {
        child.kill('SIGTERM');
      };
      if (signal.aborted) {
        killChild();
      } else {
        signal.addEventListener('abort', killChild, { once: true });
      }
    }

    if (shouldPipeStderr && child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', () => {});
    }

    if (!child.stdin || !child.stdout) {
      throw new Error('Failed to create process streams');
    }

    return child as unknown as SpawnedProcess;
  };
}

function installTreeAwareKill(child: ChildProcess, spawnSpec: WindowsCmdShimSpawnSpec): void {
  if (!spawnSpec.killProcessTree) {
    return;
  }

  const originalKill = child.kill.bind(child);
  const callOriginalKill = (signal?: NodeJS.Signals | number): boolean =>
    originalKill(signal);
  const killableChild = {
    get pid(): number | undefined {
      return child.pid;
    },
    kill: callOriginalKill,
  };

  child.kill = ((signal?: NodeJS.Signals | number): boolean =>
    terminateSpawnedProcess(killableChild, signal, spawn, spawnSpec)
  );
}
