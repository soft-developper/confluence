/**
 * The report token for a transfer, kept in this browser only (localStorage), so the
 * transaction page can report a completed mint even from a new tab. The token only
 * allows step reports for that one transfer; it is never sent anywhere else.
 */
const key = (id: string) => `confluence:transfer-token:${id}`;

export function saveTransferToken(id: string, token: string): void {
  try {
    localStorage.setItem(key(id), token);
  } catch {
    // Storage blocked (private mode, quota): reporting from the page is then unavailable.
  }
}

export function loadTransferToken(id: string): string | null {
  try {
    return localStorage.getItem(key(id));
  } catch {
    return null;
  }
}
