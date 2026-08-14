/**
 * WebContainers requires `SharedArrayBuffer`, which the browser only exposes
 * when the page is cross-origin isolated (COOP: same-origin + COEP:
 * require-corp/credentialless — see apps/web/vite.config.ts and
 * docs/sandbox-execution.md).
 *
 * A silently-false `crossOriginIsolated` is exactly what makes WebContainers
 * fail later with a confusing "SharedArrayBuffer is not defined" error far
 * from the actual cause, so this checks it at startup and warns loudly in
 * dev instead of crashing — later tickets (Monaco/xterm/WebContainers) can
 * decide what a production-facing failure mode should look like.
 */
export function checkCrossOriginIsolation(): void {
  if (!import.meta.env.DEV) return;

  if (typeof window === 'undefined') return;

  if (!window.crossOriginIsolated) {
    // eslint-disable-next-line no-console
    console.warn(
      '[AIOne] crossOriginIsolated is false. COOP/COEP headers are not being ' +
        'applied (or a cross-origin subresource without a CORP header blocked ' +
        'isolation). SharedArrayBuffer will be unavailable, which will break ' +
        'WebContainers once it is wired in. Check apps/web/vite.config.ts and ' +
        'docs/sandbox-execution.md.',
    );
  }
}
