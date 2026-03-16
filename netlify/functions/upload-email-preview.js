/**
 * Netlify serverless function: upload product-builder design preview for order confirmation email.
 *
 * Receives: POST body { "image": "data:image/png;base64,..." }
 * Uploads to Imgbb (free), returns { "url": "https://i.ibb.co/..." } for use as _preview_image_url.
 *
 * Required env var in Netlify: IMGBB_API_KEY (get a free key at https://api.imgbb.com/)
 */

const IMGBB_UPLOAD = 'https://api.imgbb.com/1/upload';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function jsonResponse(body, statusCode = 200, headers = {}) {
  return {
    statusCode,
    headers: { ...corsHeaders('*'), ...headers },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event, context) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event.headers?.origin || '*'), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const key = process.env.IMGBB_API_KEY;
  if (!key) {
    return jsonResponse({ error: 'IMGBB_API_KEY not configured' }, 500);
  }

  let body;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const dataUrl = body?.image;
  if (!dataUrl || typeof dataUrl !== 'string') {
    return jsonResponse({ error: 'Missing or invalid "image" field' }, 400);
  }

  const comma = dataUrl.indexOf(',');
  if (comma === -1 || dataUrl.indexOf('data:image') !== 0) {
    return jsonResponse({ error: 'Invalid image data URL' }, 400);
  }
  const base64 = dataUrl.substring(comma + 1);

  const form = new URLSearchParams();
  form.set('image', base64);

  try {
    const res = await fetch(`${IMGBB_UPLOAD}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data = await res.json();

    if (!res.ok || !data?.data?.url) {
      const err = data?.error?.message || data?.error || res.statusText;
      return jsonResponse({ error: err || 'Imgbb upload failed' }, res.ok ? 500 : res.status);
    }

    return jsonResponse({ url: data.data.url });
  } catch (err) {
    return jsonResponse({ error: err.message || 'Upload failed' }, 500);
  }
};
