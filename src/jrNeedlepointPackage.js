/** JR Needlepoint Studio `.jrneedlepoint.json` helpers for Order Submission. */

export const STUDIO_PACKAGE_KIND = "jr-needlepoint-studio-package";

export const STUDIO_PRODUCT_BY_TYPE = {
  belt: "Needle Point Belt",
  "key-fob": "Needle Point Key Fob",
};

export function isStudioPackageFileName(name) {
  const n = String(name || "").toLowerCase();
  return n.endsWith(".jrneedlepoint.json") || n.endsWith(".json");
}

function resolveProductType({ productType, product, fileName } = {}) {
  const type = String(productType || "").trim().toLowerCase();
  if (type === "belt" || type === "key-fob") return type;
  const prod = String(product || "").toLowerCase();
  if (prod.includes("key") && prod.includes("fob")) return "key-fob";
  if (/\bfob\b/.test(prod)) return "key-fob";
  const name = String(fileName || "").toLowerCase();
  if (/key[-_\s]?fob|\bfob\b/.test(name)) return "key-fob";
  return "belt";
}

export function productNameForStudioType(productType) {
  return STUDIO_PRODUCT_BY_TYPE[productType] || STUDIO_PRODUCT_BY_TYPE.belt;
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
 *   productType: "belt" | "key-fob",
 *   product: string,
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
  const preview =
    parsed.document && typeof parsed.document === "object" && parsed.document.preview
      ? parsed.document.preview
      : {};
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
  const productType = resolveProductType({
    productType: order.productType || preview.productType,
    product: order.product,
    fileName: name,
  });
  const product =
    String(order.product || "").trim() || productNameForStudioType(productType);
  return {
    designName: String(order.designName || parsed.document?.name || "").trim(),
    customerName: String(order.customerName || "").trim(),
    customerViewPng: png,
    gridViewPdf: pdf,
    leather: String(order.leather || "").trim(),
    buckle: String(order.buckle || "").trim(),
    productType,
    product,
  };
}
