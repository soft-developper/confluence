/**
 * Payment notes (confluence:arc-pay): plain text only, trimmed, one line, no control
 * characters, at most NOTE_MAX characters. Shown only to the two sides of a payment, and
 * rendered as text, never as links.
 */
export const NOTE_MAX = 140;

export class NoteError extends Error {
  readonly status = 400;
  readonly code = "note_too_long";
}

export function cleanNote(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null) return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if ([...s].length > NOTE_MAX) throw new NoteError(`the note can be at most ${NOTE_MAX} characters`);
  return s;
}
