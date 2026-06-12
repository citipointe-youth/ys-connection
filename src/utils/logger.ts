export function createLogger(namespace: string) {
  return {
    info: (msg: string, ...args: unknown[]) => console.log(`[${namespace}] ${msg}`, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(`[${namespace}] ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[${namespace}] ${msg}`, ...args),
  };
}
