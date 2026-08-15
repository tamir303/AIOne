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

/** cols/rows dimensions of an attached pseudoterminal, as reported by e.g. xterm.js's `onResize`. */
export interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

/**
 * A live, bidirectional process spawned via `spawnInteractive` (issue #42) —
 * the PTY-backed counterpart to `exec()`'s batch, run-to-completion model.
 * There is no single `ExecResult` here: the caller streams output as it
 * arrives, writes input as the user types, and resizes the attached terminal
 * as its UI resizes, until the process exits or is killed. Intended consumer
 * is a `Terminal` component (apps/web/src/components/Terminal.tsx) wiring
 * xterm.js's input/output through these members.
 */
export interface InteractiveProcess {
  /** Combined stdout+stderr (PTY-merged), streamed live rather than collected into a string. */
  readonly output: ReadableStream<string>;
  /** Writes a chunk of input (keystrokes, pasted text) to the process's stdin/PTY. */
  write(data: string): void;
  /** Resizes the attached pseudoterminal, e.g. when the hosting UI element resizes. */
  resize(size: TerminalSize): void;
  /** Resolves with the process's exit code once it terminates (e.g. the shell process exits). */
  readonly exit: Promise<number>;
  /** Forcibly terminates the process. */
  kill(): void;
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
  /**
   * Spawns a long-lived, bidirectional process for an interactive terminal,
   * rather than `exec()`'s batch run-to-completion model. `cmd` is typically
   * a shell (no args) left running until the caller `kill()`s it or the
   * shell process exits on its own (e.g. the user types `exit`). Unlike
   * `exec()`, this never times out on its own — an interactive shell has no
   * defined "done" point, so `LaneTimeoutError` does not apply here.
   */
  spawnInteractive(h: Handle, cmd: Command): Promise<InteractiveProcess>;
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
