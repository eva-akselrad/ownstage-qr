import {
  downloadPngFromCanvas,
  downloadSvg,
  loadLogo,
  processLogoFile,
  renderQrCanvas,
  saveLogo,
} from "./qr-export.js";

export function initQrPanel({ getCtx, canvasId, logoInputId, logoClearId, logoPreviewId, pngBtnId, svgBtnId }) {
  const canvas = document.getElementById(canvasId);
  const fileInput = document.getElementById(logoInputId);
  const clearBtn = document.getElementById(logoClearId);
  const preview = document.getElementById(logoPreviewId);
  const pngBtn = document.getElementById(pngBtnId);
  const svgBtn = document.getElementById(svgBtnId);

  let logo = null;

  const syncPreviewUi = () => {
    const { id } = getCtx();
    if (!preview || !clearBtn) return;
    if (logo) {
      preview.src = logo;
      preview.classList.remove("hidden");
      clearBtn.classList.remove("hidden");
    } else {
      preview.classList.add("hidden");
      preview.removeAttribute("src");
      clearBtn.classList.add("hidden");
    }
  };

  const reloadLogoFromStore = () => {
    const { id } = getCtx();
    logo = id ? loadLogo(id) : null;
    syncPreviewUi();
  };

  const refresh = async () => {
    const { id, shortUrl } = getCtx();
    if (!id || !shortUrl || !canvas) return;
    reloadLogoFromStore();
    await renderQrCanvas(canvas, shortUrl, logo);
  };

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    const { id } = getCtx();
    if (!file || !id) return;
    try {
      logo = await processLogoFile(file);
      saveLogo(id, logo);
      syncPreviewUi();
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });

  clearBtn?.addEventListener("click", async () => {
    const { id } = getCtx();
    if (!id) return;
    logo = null;
    saveLogo(id, null);
    syncPreviewUi();
    await refresh();
  });

  pngBtn?.addEventListener("click", async () => {
    const { id } = getCtx();
    if (!id) return;
    await refresh();
    downloadPngFromCanvas(canvas, `ownstage-qr-${id}.png`);
  });

  svgBtn?.addEventListener("click", async () => {
    const { id, shortUrl } = getCtx();
    if (!id || !shortUrl) return;
    reloadLogoFromStore();
    await downloadSvg(shortUrl, logo, `ownstage-qr-${id}.svg`);
  });

  return { refresh };
}
