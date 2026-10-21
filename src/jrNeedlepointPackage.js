/** JR Needlepoint Studio `.jrneedlepoint.json` helpers for Order Submission. */

export const STUDIO_PACKAGE_KIND = "jr-needlepoint-studio-package";

export function isStudioPackageFileName(name) {
  const n = String(name || "").toLowerCase();
  return n.endsWith(".jrneedlepoint.json") || n.endsWith(".json");
}

/**
 * Parse a Studio package File / text. Returns null if not a package with a customer preview.
 * @returns {Promise<{
 *   designName: string,
 *   customerName: string,
 *   customerViewPng: string | null,
 *   gridViewPdf: string | null,
 *   leather: string,
 *   buckle: string,
 * } | null>}
 */
export async function parseStudioPackageFile(file) {
  if (!file) return null;
  const name = String(file.name || "");
  if (!isStudioPackageFileName(name) && file.type !== "application/json") {
    return null;
  }
  let text;
  try {
    text = await file.text();
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || parsed.kind !== STUDIO_PACKAGE_KIND) return null;
  const order = parsed.order && typeof parsed.order === "object" ? parsed.order : {};
  const png =
    typeof order.customerViewPng === "string" && order.customerViewPng.startsWith("data:image/")
      ? order.customerViewPng
      : null;
  const pdf =
    typeof order.gridViewPdf === "string" &&
    order.gridViewPdf.startsWith("data:application/pdf")
      ? order.gridViewPdf
      : null;
  if (!png && !pdf) return null;
  return {
    designName: String(order.designName || parsed.document?.name || "").trim(),
    customerName: String(order.customerName || "").trim(),
    customerViewPng: png,
    gridViewPdf: pdf,
    leather: String(order.leather || "").trim(),
    buckle: String(order.buckle || "").trim(),
  };
}
