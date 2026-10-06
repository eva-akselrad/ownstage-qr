import QRCode from "qrcode";

const QR_COLOR = { dark: "#0e0c0a", light: "#ffffff" };

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image."));
    img.src = src;
  });
}

export async function renderQrCanvas(canvas, text, logoDataUrl = null) {
  await QRCode.toCanvas(canvas, text, {
    width: canvas.width,
    margin: 2,
    errorCorrectionLevel: logoDataUrl ? "H" : "M",
    color: QR_COLOR,
  });
  if (!logoDataUrl) return;
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  const logoSize = Math.floor(size * 0.22);
  const pad = Math.max(4, Math.floor(size * 0.02));
  const box = logoSize + pad * 2;
  const x = (size - box) / 2;
  const img = await loadImage(logoDataUrl);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, x, box, box);
  ctx.drawImage(img, x + pad, x + pad, logoSize, logoSize);
}

export async function buildSvg(text, logoDataUrl = null) {
  let svg = await QRCode.toString(text, {
    type: "svg",
    margin: 2,
    errorCorrectionLevel: logoDataUrl ? "H" : "M",
    color: QR_COLOR,
  });
  if (!logoDataUrl) return svg;

  const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
  if (!viewBoxMatch) return svg;
  const [, , w, h] = viewBoxMatch[1].split(/\s+/).map(Number);
  const logoFrac = 0.22;
  const lw = w * logoFrac;
  const lh = h * logoFrac;
  const lx = (w - lw) / 2;
  const ly = (h - lh) / 2;
  const pad = w * 0.02;
  const overlay = `
  <rect x="${lx - pad}" y="${ly - pad}" width="${lw + pad * 2}" height="${lh + pad * 2}" fill="#ffffff"/>
  <image href="${logoDataUrl}" x="${lx}" y="${ly}" width="${lw}" height="${lh}" preserveAspectRatio="xMidYMid meet"/>`;
  return svg.replace("</svg>", `${overlay}\n</svg>`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadPngFromCanvas(canvas, filename) {
  const a = document.createElement("a");
  a.download = filename;
  a.href = canvas.toDataURL("image/png");
  a.click();
}

export async function downloadSvg(text, logoDataUrl, filename) {
  const svg = await buildSvg(text, logoDataUrl);
  downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), filename);
}

const LOGO_KEY = (id) => `osqr-logo:${id}`;
const MAX_STORED = 450_000;

export function loadLogo(linkId) {
  try {
    return localStorage.getItem(LOGO_KEY(linkId));
  } catch {
    return null;
  }
}

export function saveLogo(linkId, dataUrl) {
  if (dataUrl) localStorage.setItem(LOGO_KEY(linkId), dataUrl);
  else localStorage.removeItem(LOGO_KEY(linkId));
}

export function resizeImageFile(file, maxDim = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        c.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("Invalid image."));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

export async function processLogoFile(file) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("Choose a PNG, JPG, or other image.");
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error("Image must be under 2 MB.");
  }
  const dataUrl = await resizeImageFile(file);
  if (dataUrl.length > MAX_STORED) {
    throw new Error("Image is still too large for browser storage. Use a smaller file.");
  }
  return dataUrl;
}
