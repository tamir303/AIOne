import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { Command, Handle, InteractiveProcess, SandboxLane } from '../lib/sandbox/types.js';

interface TerminalProps {
  /** The `SandboxLane` a live `handle` was started against (issue #36/#42). */
  lane: SandboxLane;
  /** A live handle from `lane.start()`. */
  handle: Handle;
  /**
   * Command to spawn as the interactive shell. Defaults to `jsh` (WebContainers'
   * own shell), matching how `webcontainerLane.ts`'s `spawnInteractive` is meant
   * to be driven for a terminal rather than a one-off `exec()`.
   */
  shellCommand?: Command;
}

const DEFAULT_SHELL: Command = { cmd: 'jsh' };

/**
 * Interactive terminal surface (issue #42), backed by xterm.js
 * (docs/tech-stack.md fixes this as the terminal choice) and a
 * `SandboxLane.spawnInteractive` process. Pipes xterm.js's own input/output
 * both ways through the vendor-neutral `InteractiveProcess`:
 *
 * - Keystrokes (`XTerm.onData`) are forwarded to `InteractiveProcess.write`.
 * - Process output is read off `InteractiveProcess.output` and written into
 *   the terminal.
 * - Terminal resizes (`XTerm.onResize`) are forwarded to
 *   `InteractiveProcess.resize`.
 *
 * Not wired into `App.tsx`'s routing yet — same call #37/#38 made for
 * `FileTree`/`FileEditor`; this component is built and tested standalone.
 */
export default function Terminal({ lane, handle, shellCommand = DEFAULT_SHELL }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let interactive: InteractiveProcess | null = null;
    const term = new XTerm({ convertEol: true, cursorBlink: true });
    term.open(container);

    const dataSubscription = term.onData((data) => {
      interactive?.write(data);
    });
    const resizeSubscription = term.onResize(({ cols, rows }) => {
      interactive?.resize({ cols, rows });
    });

    (async () => {
      try {
        const process = await lane.spawnInteractive(handle, shellCommand);
        if (cancelled) {
          process.kill();
          return;
        }
        interactive = process;
        // Sync the freshly-spawned PTY to whatever size xterm.js already
        // rendered at, rather than leaving it at the SandboxLane's default.
        process.resize({ cols: term.cols, rows: term.rows });

        const reader = process.output.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done || cancelled) break;
          term.write(value);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          term.writeln(`\r\nFailed to start terminal: ${message}`);
        }
      }
    })();

    return () => {
      cancelled = true;
      dataSubscription.dispose();
      resizeSubscription.dispose();
      interactive?.kill();
      term.dispose();
    };
    // `shellCommand` defaults to the stable `DEFAULT_SHELL` module constant
    // when the caller omits it, so this effect only re-runs when the lane,
    // handle, or an explicitly-passed shellCommand actually changes.
  }, [lane, handle, shellCommand]);

  return <div ref={containerRef} style={{ height: '100%', width: '100%' }} />;
}
