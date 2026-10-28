/**
 * Browser download helpers shared by export surfaces.
 */

/**
 * Extracts a filename from a Content-Disposition header, preferring the RFC 5987
 * `filename*=` form and falling back to the quoted/unquoted `filename=` form.
 */
export function parseContentDispositionFilename(header: string | null | undefined): string | null {
  if (!header) return null;
  const star = header.match(/filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ''));
    } catch {
      return star[2].trim();
    }
  }
  const plain = header.match(/filename\s*=\s*("?)([^";]+)\1/i);
  return plain ? plain[2].trim() : null;
}

/** Triggers a download of a Blob with the given filename and cleans up the object URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    anchor.remove();
    window.URL.revokeObjectURL(url);
  }, 0);
}
