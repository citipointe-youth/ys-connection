// One name key for the group roll (import) and the link roster (check 4), so both sides compare the same way.
export function nameKey(first: string, last: string): string {
  return `${first} ${last}`.replace(/\s+/g, ' ').trim().toLowerCase();
}
