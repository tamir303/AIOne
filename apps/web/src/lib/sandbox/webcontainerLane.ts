import { WebContainer } from '@webcontainer/api';
import {
  ExecFailedError,
  LaneTimeoutError,
  LaneUnavailableError,
  type Command,
  type ExecResult,
  type FileMap,
  type Handle,
  type LaneSpec,
  type SandboxLane,
} from './types.js';
import type {
  WebContainerBoot,
  WebContainerFileTree,
  WebContainerInstanceTransport,
} from './webcontainerTransport.js';

/**
 * `SandboxLane` implementation for router rule 4 in docs/sandbox-execution.md
 * ("Everything else → WebContainers" — Node/Vite/npm, the common case).
 *
 * This is the only file in apps/web allowed to import `@webcontainer/api`
 * (docs/sandbox-execution.md, "Vendor abstraction (non-negotiable)";
 * .claude/skills/sandbox-routing). Everything else — agent code, UI — must
 * depend on the vendor-neutral `SandboxLane` interface in ./types.ts.
 *
 * Only a single `WebContainer` instance can be booted concurrently per
 * browser tab (see the SDK's own `WebContainer.boot` docs), so this
 * implementation only ever tracks one live container at a time; a second
 * `start()` call before `dispose()` throws `LaneUnavailableError` rather
 * than silently tearing down the first container out from under its caller.
 */

/** Wall-clock budget for a spawned command before `exec` gives up and throws `LaneTimeoutError`. */
const DEFAULT_EXEC_TIMEOUT_MS = 5 * 60 * 1000;

/** Wall-clock budget for `previewUrl` to wait for a `server-ready` event before resolving `null`. */
const DEFAULT_PREVIEW_TIMEOUT_MS = 60 * 1000;

let nextHandleId = 0;

export class WebContainerLane implements SandboxLane {
  private container: { handleId: string; instance: WebContainerInstanceTransport } | null = null;

  constructor(private readonly boot: WebContainerBoot) {}

  async start(spec: LaneSpec): Promise<Handle> {
    if (spec.kind !== 'webcontainers') {
      throw new LaneUnavailableError(
        `WebContainerLane cannot start a "${spec.kind}" lane; it only handles "webcontainers".`,
      );
    }

    if (this.container) {
      throw new LaneUnavailableError(
        'A WebContainer is already running on this lane; dispose() the existing handle before starting another.',
      );
    }

    let instance: WebContainerInstanceTransport;
    try {
      instance = await this.boot();
    } catch (error) {
      throw new LaneUnavailableError('Failed to boot WebContainer.', { cause: error });
    }

    const handle: Handle = { id: `webcontainers-${nextHandleId++}`, kind: 'webcontainers' };
    this.container = { handleId: handle.id, instance };
    return handle;
  }

  async writeFiles(h: Handle, files: FileMap): Promise<void> {
    const instance = this.requireInstance(h);
    try {
      await instance.mount(toFileSystemTree(files));
    } catch (error) {
      throw new ExecFailedError('Failed to write files to the WebContainer.', { cause: error });
    }
  }

  async exec(h: Handle, cmd: Command): Promise<ExecResult> {
    const instance = this.requireInstance(h);

    let process: Awaited<ReturnType<WebContainerInstanceTransport['spawn']>>;
    try {
      process = await instance.spawn(cmd.cmd, cmd.args ? [...cmd.args] : [], { cwd: cmd.cwd });
    } catch (error) {
      throw new ExecFailedError(`Failed to spawn "${cmd.cmd}".`, { cause: error });
    }

    let stdout = '';
    const collectOutput = process.output
      .pipeTo(
        new WritableStream<string>({
          write(chunk) {
            stdout += chunk;
          },
        }),
      )
      // A stream teardown race (e.g. the process is killed mid-read) throws
      // here independently of the process's own exit code; the exit code is
      // the source of truth for exec()'s result, so this is swallowed
      // rather than rejecting exec() a second way.
      .catch(() => undefined);

    let exitCode: number;
    try {
      exitCode = await withTimeout(
        process.exit,
        DEFAULT_EXEC_TIMEOUT_MS,
        () =>
          new LaneTimeoutError(
            `Command "${cmd.cmd}" did not exit within ${DEFAULT_EXEC_TIMEOUT_MS}ms.`,
          ),
      );
    } catch (error) {
      process.kill();
      throw error;
    }

    await collectOutput;

    return { exitCode, stdout, stderr: '' };
  }

  async previewUrl(h: Handle): Promise<URL | null> {
    const instance = this.requireInstance(h);

    return new Promise<URL | null>((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(null);
      }, DEFAULT_PREVIEW_TIMEOUT_MS);

      const unsubscribe = instance.on('server-ready', (_port, url) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(new URL(url));
      });
    });
  }

  async dispose(h: Handle): Promise<void> {
    // Idempotent per .claude/skills/sandbox-routing ("dispose is idempotent
    // and safe to call on an already-dead handle"): an unknown or
    // already-disposed handle is a no-op, not an error.
    if (!this.container || this.container.handleId !== h.id) {
      return;
    }

    const { instance } = this.container;
    this.container = null;
    instance.teardown();
  }

  private requireInstance(h: Handle): WebContainerInstanceTransport {
    if (!this.container || this.container.handleId !== h.id) {
      throw new LaneUnavailableError(`No live WebContainer for handle "${h.id}".`);
    }
    return this.container.instance;
  }
}

/**
 * Converts the flat, `SandboxLane`-neutral `FileMap` into the nested tree
 * shape `@webcontainer/api`'s `mount` expects, inferring directories from
 * `/`-separated path segments.
 */
function toFileSystemTree(files: FileMap): WebContainerFileTree {
  const tree: WebContainerFileTree = {};

  for (const [path, contents] of Object.entries(files)) {
    const segments = path.split('/').filter((segment) => segment.length > 0);
    if (segments.length === 0) continue;

    let cursor = tree;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const existing = cursor[segment];
      if (existing && 'directory' in existing) {
        cursor = existing.directory;
      } else {
        const dir: WebContainerFileTree = {};
        cursor[segment] = { directory: dir };
        cursor = dir;
      }
    }

    cursor[segments[segments.length - 1]] = { file: { contents } };
  }

  return tree;
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Boots a real `@webcontainer/api` `WebContainer` and wraps it as a
 * `SandboxLane`. The one call site in the codebase that constructs a live
 * WebContainer instance; everything else should depend on `SandboxLane`.
 *
 * `coep: 'require-corp'` matches the header apps/web/vite.config.ts serves
 * and the mode verified against Clerk (docs/sandbox-execution.md,
 * "Cross-origin isolation (COOP/COEP), and Clerk") — do not change this to
 * `'credentialless'` without re-reading that note.
 */
export function createWebContainerLane(): WebContainerLane {
  const boot: WebContainerBoot = async () => {
    const instance = await WebContainer.boot({ coep: 'require-corp' });
    return instance as unknown as WebContainerInstanceTransport;
  };
  return new WebContainerLane(boot);
}
