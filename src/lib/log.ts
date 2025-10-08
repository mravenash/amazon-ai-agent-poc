// Minimal debug logger gated by build env
export function debug(...args: any[]) {
  try {
    // Vite exposes import.meta.env.DEV in browser and tests
    const isDev = Boolean((import.meta as any)?.env?.DEV);
    if (isDev) console.debug('[debug]', ...args);
  } catch {
    // last resort: no-op
  }
}
