/**
 * Clipboard helper that also works on plain-HTTP LAN installs, where browsers hide the async
 * Clipboard API outside secure contexts.
 */

function copyWithTextarea(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

/**
 * Starts copying `text` to the clipboard. Returns false only when no copy path is available,
 * so callers can show feedback synchronously.
 */
export function copyText(text: string): boolean {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      Promise.resolve(clipboard.writeText(text)).catch(() => {
        copyWithTextarea(text);
      });
      return true;
    } catch {
      return copyWithTextarea(text);
    }
  }
  return copyWithTextarea(text);
}
