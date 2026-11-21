// Helpers for tests that extract fragments of Prettier-formatted source files.

/**
 * Returns the complete top-level statement that starts with `prefix` at column 0.
 * The statement continues over indented lines and lines that only close brackets.
 */
export function topLevelStatement(source, prefix) {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.startsWith(prefix));
  if (start < 0) throw new Error(`Top-level statement not found: ${prefix}`);
  let end = start;
  while (end + 1 < lines.length && /^(\s|[})\]])/.test(lines[end + 1])) end++;
  return lines.slice(start, end + 1).join('\n') + '\n';
}

/** Removes all whitespace, for matching code shapes regardless of formatting. */
export function compact(text) {
  return text.replace(/\s+/g, '');
}
