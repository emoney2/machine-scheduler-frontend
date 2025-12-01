// src/utils/recolorImage.js

// Simple in-memory cache so we don't retint the same thing over and over
const tintCache = new Map();

/**
 * Recolor a base PNG silhouette to a given hex color.
 * @param {string} url - Path to the base PNG (e.g. "/fur-icons/DriverFur.png")
 * @param {string} color - CSS color string (e.g. "#FF0000")
 * @returns {Promise<string>} - A data URL for the tinted PNG
 */
export async function recolorImage(url, color) {
  const key = `${url}__${color}`;
  if (tintCache.has(key)) {
    return tintCache.get(key);
  }

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;

  // Wait for the browser to load the image
  await img.decode();

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  canvas.width = img.width;
  canvas.height = img.height;

  // Draw the original PNG
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  // Apply color overlay inside the non-transparent pixels
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const tintedDataUrl = canvas.toDataURL("image/png");

  tintCache.set(key, tintedDataUrl);
  return tintedDataUrl;
}
