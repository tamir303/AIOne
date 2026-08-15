/**
 * Vendor-neutral sandbox lane contract (docs/sandbox-execution.md, "Vendor
 * abstraction"; .claude/skills/sandbox-routing).
 *
 * Agent code and UI code depend only on this file — never on a lane
 * implementation's underlying SDK. `@webcontainer/api` is imported nowhere
 * in this module; see webcontainerLane.ts for the first (and today, only)
 * `SandboxLane` implementation, which is the sole file in apps/web allowed
 * to import it.
 */

/** Which execution lane a `LaneSpec` targets — see the router in the doc. */
export type LaneKind = 'webcontainers' | 'e2b' | 'remote-builder';

export interface LaneSpec {
  /** Which lane to start. `WebContainerLane` only ever handles 'webcontainers'. */
  readonly kind: LaneKind;
}

/**
 * A flat map of workspace-relative file path to UTF-8 text contents.
 * Directories are inferred from `/`-separated path segments — there is no
 * separate "create directory" call in this contract.
 */
export type FileMap = Record<string, string>;

export interface Command {
  readonly cmd: string;
  readonly args?: readonly string[];
  /** Working directory, relative to the lane's workdir. Defaults to the workdir root. */
  readonly cwd?: string;
}

export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Opaque reference to a running lane instance. Never carries a
 * provider-specific field — an adapter that leaks a vendor type onto
 * `Handle` has already broken the abstraction (sandbox-routing skill).
 */
export interface Handle {
  readonly id: string;
  readonly kind: LaneKind;
}

/** The only interface agent code knows about (docs/sandbox-execution.md). */
export interface SandboxLane {
  start(spec: LaneSpec): Promise<Handle>;
  writeFiles(h: Handle, files: FileMap): Promise<void>;
  exec(h: Handle, cmd: Command): Promise<ExecResult>;
  previewUrl(h: Handle): Promise<URL | null>;
  dispose(h: Handle): Promise<void>;
}

/**
 * Normalized error taxonomy shared across every `SandboxLane` implementation
 * (sandbox-routing skill: "Normalize errors into our own taxonomy... Callers
 * must not switch on provider error strings."). Each lane adapter is
 * responsible for translating its vendor SDK's own errors into these.
 */

/** The lane could not be started, or a handle no longer refers to a live lane. */
export class LaneUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LaneUnavailableError';
  }
}

/** A `writeFiles`/`exec` call against a live lane failed. */
export class ExecFailedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ExecFailedError';
  }
}

/** A lane operation did not complete within its allotted time budget. */
export class LaneTimeoutError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LaneTimeoutError';
  }
}
