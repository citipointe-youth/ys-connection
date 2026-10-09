/** Remove database connection strings (and their passwords) from text before it is logged. */
export function redactSecrets(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/\S*/gi, 'postgres://[hidden]');
}

/** A log-safe description of an error: code, message and stack only. Never the raw object (it can hold the input URL). */
export function safeErrorText(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return redactSecrets(`${typeof code === 'string' ? `(${code}) ` : ''}${err.stack ?? `${err.name}: ${err.message}`}`);
  }
  return redactSecrets(String(err));
}
