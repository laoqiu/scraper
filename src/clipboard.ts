/** Clipboard permissions can be blocked by an embedding host even on HTTPS. */
export async function copyWithFallback(
  text: string,
  writeText: ((text: string) => Promise<void>) | undefined,
  legacyCopy: () => boolean,
): Promise<boolean> {
  if (writeText) {
    try { await writeText(text); return true; } catch { /* Try a user-initiated DOM copy. */ }
  }
  try { return legacyCopy(); } catch { return false; }
}
