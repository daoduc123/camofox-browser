/**
 * In-page image extraction via Playwright page.evaluate().
 *
 * Separated from downloads.js to avoid OpenClaw scanner false positives
 * (browser-side fetch inside page.evaluate + Node fs reads in same file).
 */

import { MAX_DOWNLOAD_INLINE_BYTES } from './downloads.js';

/**
 * Extract image metadata (and optionally inline data) from visible <img> elements.
 */
async function extractPageImages(page, { includeData = false, maxBytes = MAX_DOWNLOAD_INLINE_BYTES, limit = 8 } = {}) {
  return page.evaluate(
    async ({ includeData, maxBytes, limit }) => {
      const toDataUrl = (blob) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
          reader.onerror = () => reject(new Error('file_reader_failed'));
          reader.readAsDataURL(blob);
        });

      const nodes = Array.from(document.querySelectorAll('img'));
      const seen = new Set();
      const candidates = [];

      for (const [documentOrder, node] of nodes.entries()) {
        const src = String(node.currentSrc || node.src || node.getAttribute('src') || '').trim();
        if (!src || seen.has(src)) continue;

        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const renderedWidth = Math.round(rect.width);
        const renderedHeight = Math.round(rect.height);
        const alt = String(node.alt || '').trim();
        const role = String(node.getAttribute('role') || '').toLowerCase();
        const srcHint = src.toLowerCase();
        const inPrimaryContent = node.closest('article, main, [role="main"]') !== null;
        const inPageChrome = node.closest('header, nav, footer, aside, [role="navigation"]') !== null;
        const checkVisibility =
          typeof node.checkVisibility === 'function'
            ? node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            : true;
        const hidden =
          !node.isConnected ||
          !checkVisibility ||
          node.hidden ||
          node.getAttribute('aria-hidden') === 'true' ||
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse' ||
          Number.parseFloat(style.opacity || '1') === 0 ||
          node.getClientRects().length === 0 ||
          renderedWidth <= 0 ||
          renderedHeight <= 0;
        if (hidden) continue;

        const trackingPixel = renderedWidth <= 2 || renderedHeight <= 2;
        const decorativeRole = role === 'presentation' || role === 'none';
        const decorativeAsset = /(?:^|[\W_])(beacon|favicon|pixel|spacer|tracking)(?:[\W_]|$)/iu.test(
          srcHint,
        );
        const smallUnlabelledAsset = renderedWidth <= 48 && renderedHeight <= 48 && alt === '';
        const pageChromeAsset =
          inPageChrome && renderedWidth <= 320 && renderedHeight <= 160 && !inPrimaryContent;
        if (
          trackingPixel ||
          decorativeAsset ||
          (decorativeRole && alt === '') ||
          smallUnlabelledAsset ||
          pageChromeAsset
        )
          continue;

        seen.add(src);
        const area = Math.min(renderedWidth * renderedHeight, 4_000_000);
        candidates.push({
          src,
          alt,
          width: Number(node.naturalWidth || renderedWidth || node.width || 0) || undefined,
          height: Number(node.naturalHeight || renderedHeight || node.height || 0) || undefined,
          score:
            area +
            (alt === '' ? 0 : 250_000) +
            (inPrimaryContent ? 1_000_000 : 0) -
            (inPageChrome ? 500_000 : 0),
          documentOrder,
        });
      }

      candidates.sort(
        (left, right) => right.score - left.score || left.documentOrder - right.documentOrder,
      );

      const results = [];
      for (const image of candidates.slice(0, limit)) {
        const entry = { src: image.src, alt: image.alt, width: image.width, height: image.height };

        if (includeData) {
          try {
            if (image.src.startsWith('data:')) {
              const mimeMatch = image.src.match(/^data:([^;,]+)[;,]/i);
              const isBase64 = /;base64,/i.test(image.src);
              const payload = image.src.slice(image.src.indexOf(',') + 1);
              const estimatedBytes = isBase64 ? Math.floor((payload.length * 3) / 4) : payload.length;
              entry.mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
              entry.bytes = estimatedBytes;
              if (estimatedBytes <= maxBytes) {
                entry.dataUrl = image.src;
              } else {
                entry.dataSkipped = 'max_bytes_exceeded';
              }
            } else {
              const response = await fetch(image.src, { credentials: 'include' });
              if (response.ok) {
                const blob = await response.blob();
                entry.mimeType = blob.type || 'application/octet-stream';
                entry.bytes = blob.size;
                if (blob.size <= maxBytes) {
                  entry.dataUrl = await toDataUrl(blob);
                } else {
                  entry.dataSkipped = 'max_bytes_exceeded';
                }
              } else {
                entry.fetchError = `http_${response.status}`;
              }
            }
          } catch (err) {
            entry.fetchError = String(err?.message || err || 'image_fetch_failed');
          }
        }

        results.push(entry);
      }

      return results;
    },
    { includeData, maxBytes, limit },
  );
}

export { extractPageImages };
