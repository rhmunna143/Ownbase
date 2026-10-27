/**
 * Universal clipboard helper with fallback for non-secure contexts (HTTP / LAN / Tailscale).
 * In modern browsers, `navigator.clipboard` is only exposed in secure contexts (HTTPS or localhost).
 * When accessed via HTTP over Wi-Fi (e.g. 192.168.x.x) or Tailscale (100.x.x.x), `navigator.clipboard`
 * is undefined and throws TypeError. This utility falls back to `document.execCommand('copy')`.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Try modern async Clipboard API if available in secure context
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below if permission was denied or browser threw SecurityError
    }
  }

  // 2. Universal fallback using textarea + document.execCommand('copy')
  if (typeof document !== 'undefined') {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      // Prevent scrolling / zooming on mobile iOS/Android
      textArea.style.position = 'fixed';
      textArea.style.top = '0';
      textArea.style.left = '-9999px';
      textArea.style.opacity = '0';
      textArea.style.pointerEvents = 'none';
      textArea.setAttribute('readonly', '');
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      textArea.setSelectionRange(0, text.length);

      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    } catch (err) {
      console.warn('[Clipboard] Fallback copy failed:', err);
    }
  }

  return false;
}
