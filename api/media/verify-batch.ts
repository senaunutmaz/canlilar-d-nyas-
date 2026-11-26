function isSafeExternalImageUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      !host ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host === '::1' ||
      host === '[::1]' ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^0\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      /^\[?(fe80|fc00|fd)/i.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isUsableImageThumbnailUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  if (/^https:\/\/ids\.si\.edu\//i.test(url)) return false;
  if (/\.(svg|pdf|html|htm|cfm)(?:$|\?)/i.test(url)) return false;
  if (/\/(?:range|distribution|status_iucn|red_list|cladogram|phylogeny|commons-logo|flag_of|question_book|ambox|disambig)/i.test(url)) {
    return false;
  }
  if (/image_details\.cfm/i.test(url)) return false;
  return true;
}

function detectImageMagicBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1') return 'image/heic';
  }
  return null;
}

function looksLikeTextOrHtmlPrefix(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  const sample = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 64)).trimStart().toLowerCase();
  return sample.startsWith('<!doctype') || sample.startsWith('<html') || sample.startsWith('<xml') || sample.startsWith('<?xml') || sample.startsWith('{');
}

async function verifySingleImage(rawUrl: string, timeoutMs = 3800) {
  if (!rawUrl || !isSafeExternalImageUrl(rawUrl)) {
    return { verified: false, status: 0, contentType: null, magicType: null, reason: 'INVALID_OR_UNSAFE_URL' };
  }
  if (!isUsableImageThumbnailUrl(rawUrl)) {
    return { verified: false, status: 0, contentType: null, magicType: null, reason: 'INVALID_IMAGE_URL' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Response | null = null;
    let finalUrl = rawUrl;
    let lastReason = 'NETWORK_ERROR';

    for (let attempt = 0; attempt < 2; attempt++) {
      if (controller.signal.aborted) break;
      try {
        let currentUrl = rawUrl;
        let hopRes: Response | null = null;
        for (let hop = 0; hop < 4; hop++) {
          if (!isSafeExternalImageUrl(currentUrl)) {
            return {
              verified: false,
              status: 0,
              contentType: null,
              magicType: null,
              reason: hop === 0 ? 'INVALID_OR_UNSAFE_URL' : 'UNSAFE_REDIRECT_URL',
            };
          }
          const r = await fetch(currentUrl, {
            method: 'GET',
            redirect: 'manual',
            headers: {
              'User-Agent': 'CanliAtlasi/1.0 (https://github.com/canli-atlasi; educational-biodiversity-project)',
              Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
            },
            signal: controller.signal,
          });
          if (r.status >= 300 && r.status < 400) {
            const loc = r.headers.get('location');
            try { await r.body?.cancel(); } catch { /* ignore */ }
            if (!loc) {
              return { verified: false, status: r.status, contentType: r.headers.get('content-type'), magicType: null, reason: `HTTP_${r.status}` };
            }
            currentUrl = new URL(loc, currentUrl).toString();
            continue;
          }
          hopRes = r;
          finalUrl = currentUrl;
          break;
        }
        if (!hopRes) {
          return { verified: false, status: 0, contentType: null, magicType: null, reason: 'TOO_MANY_REDIRECTS' };
        }
        res = hopRes;
        if ((res.status === 429 || res.status >= 500) && attempt === 0 && !controller.signal.aborted) {
          try { await res.body?.cancel(); } catch { /* ignore */ }
          res = null;
          await new Promise((r) => setTimeout(r, 180));
          continue;
        }
        break;
      } catch (err: any) {
        lastReason = err?.name === 'AbortError' || controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR';
        if (attempt === 0 && lastReason === 'NETWORK_ERROR' && !controller.signal.aborted) {
          await new Promise((r) => setTimeout(r, 180));
          continue;
        }
      }
    }

    if (!res) {
      return { verified: false, status: 0, contentType: null, magicType: null, reason: lastReason };
    }

    const contentType = res.headers.get('content-type');
    const ctLower = (contentType || '').toLowerCase();

    if (!res.ok) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return { verified: false, status: res.status, contentType, magicType: null, reason: `HTTP_${res.status}` };
    }

    const corpHeader = (res.headers.get('cross-origin-resource-policy') || '').toLowerCase().trim();
    if (corpHeader === 'same-origin' || corpHeader === 'same-site' || /(?:^|\/\/)ids\.si\.edu\//i.test(finalUrl)) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return { verified: false, status: res.status, contentType, magicType: null, reason: 'CORP_BLOCKED_IN_BROWSER' };
    }

    if (ctLower && !ctLower.startsWith('image/')) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return { verified: false, status: res.status, contentType, magicType: null, reason: 'NON_IMAGE_CONTENT_TYPE' };
    }

    let headBytes = new Uint8Array(0);
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      try {
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (total < 32) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          chunks.push(value);
          total += value.length;
        }
        const combined = new Uint8Array(Math.min(total, 64));
        let offset = 0;
        for (const ch of chunks) {
          const take = Math.min(ch.length, combined.length - offset);
          combined.set(ch.subarray(0, take), offset);
          offset += take;
          if (offset >= combined.length) break;
        }
        headBytes = combined;
      } finally {
        try { await reader.cancel(); } catch { /* ignore */ }
      }
    }

    const magicType = detectImageMagicBytes(headBytes);
    if (headBytes.length > 0 && (looksLikeTextOrHtmlPrefix(headBytes) || (!magicType && !ctLower.startsWith('image/')))) {
      return { verified: false, status: res.status, contentType, magicType, reason: 'HTML_OR_NON_IMAGE_BYTES' };
    }
    if (headBytes.length >= 4 && !magicType) {
      return { verified: false, status: res.status, contentType, magicType: null, reason: 'UNRECOGNIZED_IMAGE_MAGIC' };
    }

    return {
      verified: true,
      status: res.status,
      contentType,
      magicType: magicType || (ctLower.startsWith('image/') ? ctLower.split(';')[0].trim() : null),
    };
  } catch (err: any) {
    return {
      verified: false,
      status: 0,
      contentType: null,
      magicType: null,
      reason: err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function parseRequestJsonBody(req: any): Promise<any> {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  if (Buffer.isBuffer(req.body)) {
    try { return JSON.parse(req.body.toString('utf8')); } catch { return {}; }
  }
  if (req && typeof req.on === 'function') {
    const raw = await new Promise<string>((resolve) => {
      let data = '';
      req.on('data', (chunk: any) => {
        data += String(chunk);
        if (data.length > 256 * 1024) resolve(data);
      });
      req.on('end', () => resolve(data));
      req.on('error', () => resolve(''));
    });
    if (raw) {
      try { return JSON.parse(raw); } catch { return {}; }
    }
  }
  return {};
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = await parseRequestJsonBody(req);
  const urlsInput: unknown[] = Array.isArray(body?.urls) ? body.urls : [];
  const filteredUrls: string[] = urlsInput
    .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    .map((u) => u.trim());
  const uniqueUrls: string[] = Array.from(new Set<string>(filteredUrls)).slice(0, 24);

  const results: Record<string, any> = {};
  const validUrls: string[] = [];

  for (const u of uniqueUrls) {
    if (!isSafeExternalImageUrl(u)) {
      results[u] = {
        verified: false,
        status: 0,
        contentType: null,
        magicType: null,
        reason: 'INVALID_OR_UNSAFE_URL',
      };
    } else {
      validUrls.push(u);
    }
  }

  const concurrency = 10;
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, validUrls.length) }, async () => {
    while (idx < validUrls.length) {
      const current = validUrls[idx++];
      try {
        results[current] = await verifySingleImage(current, 3800);
      } catch {
        results[current] = {
          verified: false,
          status: 0,
          contentType: null,
          magicType: null,
          reason: 'VERIFY_ERROR',
        };
      }
    }
  });

  await Promise.all(workers);
  res.status(200).json({ results });
}
