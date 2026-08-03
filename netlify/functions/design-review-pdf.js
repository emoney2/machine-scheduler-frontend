/**
 * Proxy Google Drive PDFs with CORS + HTTP Range so pdf.js can show page 1
 * without shipping the file through Google Apps Script.
 *
 * GET /.netlify/functions/design-review-pdf?id=DRIVE_FILE_ID
 * File must be shared as "Anyone with the link" (Viewer).
 */

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Range, Content-Length, Content-Type',
  };
}

function driveUrls(id) {
  return [
    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`,
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}&confirm=t`,
  ];
}

function looksLikeHtml(buf) {
  if (!buf || buf.length < 20) return false;
  const head = buf.slice(0, 80).toString('utf8').toLowerCase();
  return head.includes('<!doctype') || head.includes('<html') || head.includes('confirm=');
}

function isPdfStart(buf) {
  return buf && buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

async function fetchOnce(url, rangeHeader) {
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; JRCO-DesignReview/1.0)' };
  if (rangeHeader) headers.Range = rangeHeader;
  const res = await fetch(url, { headers, redirect: 'follow' });
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, buf };
}

async function fetchDrive(id, rangeHeader) {
  let lastErr = null;

  for (const url of driveUrls(id)) {
    try {
      let { res, buf } = await fetchOnce(url, rangeHeader);

      if (looksLikeHtml(buf)) {
        const html = buf.toString('utf8');
        const confirm = html.match(/confirm=([0-9A-Za-z_-]+)/);
        if (confirm) {
          const confirmUrl =
            `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}&confirm=${confirm[1]}`;
          ({ res, buf } = await fetchOnce(confirmUrl, rangeHeader));
        }
      }

      if (!res.ok && res.status !== 206) {
        lastErr = new Error(`Drive HTTP ${res.status}`);
        continue;
      }

      if (looksLikeHtml(buf)) {
        lastErr = new Error(
          'Drive returned HTML instead of PDF. Share the review copy as Anyone with the link (Viewer).'
        );
        continue;
      }

      // Full PDF start, or a mid-file range (won't start with %PDF)
      if (isPdfStart(buf) || (rangeHeader && buf.length > 0)) {
        return { res, buf };
      }

      lastErr = new Error('Unexpected Drive response');
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('Could not download PDF from Drive');
}

function parseTotalSize(contentRange, contentLength, bufLen) {
  if (contentRange) {
    const m = String(contentRange).match(/\/(\d+)\s*$/);
    if (m) return Number(m[1]);
  }
  if (contentLength) {
    const n = Number(contentLength);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return bufLen;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
    return {
      statusCode: 405,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const id = (event.queryStringParameters && event.queryStringParameters.id) || '';
  if (!id || !/^[a-zA-Z0-9_-]{10,}$/.test(id)) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing or invalid Drive file id' }),
    };
  }

  const clientRange = event.headers.range || event.headers.Range || '';

  try {
    // Always use Range against Drive so large files never fill the function memory.
    // If the browser didn't send Range, fetch the first 512KB and advertise total size.
    const driveRange = clientRange || 'bytes=0-524287';
    const { res, buf } = await fetchDrive(id, driveRange);

    const driveCR = res.headers.get('content-range') || res.headers.get('Content-Range') || '';
    const driveCL = res.headers.get('content-length') || res.headers.get('Content-Length') || '';
    const total = parseTotalSize(driveCR, driveCL, buf.length);

    const headers = {
      ...corsHeaders(),
      'Content-Type': 'application/pdf',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
      'Content-Length': String(buf.length),
    };

    let statusCode = 200;
    if (clientRange || total > buf.length) {
      statusCode = 206;
      const end = Math.min(buf.length - 1, total - 1);
      headers['Content-Range'] = driveCR || `bytes 0-${end}/${total}`;
    }

    if (event.httpMethod === 'HEAD') {
      // pdf.js probes size; prefer advertising full length when known
      if (total > 0) headers['Content-Length'] = String(total);
      return { statusCode: total > buf.length ? 206 : 200, headers, body: '' };
    }

    return {
      statusCode,
      headers,
      body: buf.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: (err && err.message) || 'Drive proxy failed' }),
    };
  }
};
