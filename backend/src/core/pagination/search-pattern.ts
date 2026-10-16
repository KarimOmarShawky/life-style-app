/** Escape PostgreSQL LIKE metacharacters, including its default escape. */
export function literalContainsPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`;
}
