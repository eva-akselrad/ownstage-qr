import QRCode from "qrcode";

const storageKey = (id) => `ownstage-qr:${id}`;

function show(id) {
  for (const el of document.querySelectorAll(".hero")) {
    el.classList.toggle("hidden", el.id !== id);
  }
}

async function drawQr(canvas, text) {
  await QRCode.toCanvas(canvas, text, {
    width: canvas.width,
    margin: 2,
    color: { dark: "#070b12", light: "#ffffff" },
  });
}

function saveSession(id, editToken, shortUrl, destination) {
  localStorage.setItem(
    storageKey(id),
    JSON.stringify({ editToken, shortUrl, destination }),
  );
}

function loadSession(id) {
  try {
    const raw = localStorage.getItem(storageKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function route() {
  const path = location.pathname.replace(/\/$/, "") || "/";
  const manageMatch = path.match(/^\/manage\/([^/]+)$/);
  if (manageMatch) {
    const id = manageMatch[1];
    const params = new URLSearchParams(location.search);
    const tokenFromUrl = params.get("token");
    const session = loadSession(id);
    if (tokenFromUrl) {
      saveSession(id, tokenFromUrl, session?.shortUrl || "", session?.destination || "");
      history.replaceState({}, "", `/manage/${id}`);
    }
    const token = tokenFromUrl || session?.editToken;
    if (token) {
      openManage(id, token).catch((err) => {
        show("view-unlock");
        document.getElementById("unlock-error").textContent = err.message;
        document.getElementById("unlock-error").classList.remove("hidden");
        setupUnlock(id);
      });
    } else {
      show("view-unlock");
      setupUnlock(id);
    }
    return;
  }
  show("view-create");
}

async function openManage(id, editToken) {
  const info = await api(`/api/links/${id}`);
  show("view-manage");
  document.getElementById("manage-short-url").textContent = info.shortUrl;
  document.getElementById("new-destination").value = info.destination;
  const canvas = document.getElementById("manage-qr");
  await drawQr(canvas, info.shortUrl);

  const form = document.getElementById("update-form");
  const status = document.getElementById("manage-status");
  form.onsubmit = async (e) => {
    e.preventDefault();
    status.textContent = "Saving…";
    status.classList.remove("error");
    try {
      const updated = await api(`/api/links/${id}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${editToken}` },
        body: JSON.stringify({ url: document.getElementById("new-destination").value }),
      });
      saveSession(id, editToken, updated.shortUrl, updated.destination);
      status.textContent = "Saved. Scans now go to the new URL.";
    } catch (err) {
      status.textContent = err.message;
      status.classList.add("error");
    }
  };
}

function setupUnlock(id) {
  const form = document.getElementById("unlock-form");
  const err = document.getElementById("unlock-error");
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.classList.add("hidden");
    const token = document.getElementById("edit-token").value.trim();
    try {
      await api(`/api/links/${id}/verify`, {
        method: "POST",
        body: JSON.stringify({ token }),
      });
    } catch {
      err.textContent = "That token doesn’t match this QR.";
      err.classList.remove("hidden");
      return;
    }
    saveSession(id, token, "", "");
    await openManage(id, token);
  };
}

function wireCopyButton(buttonId, getText, doneLabel = "Copied") {
  document.getElementById(buttonId).onclick = async () => {
    const btn = document.getElementById(buttonId);
    await navigator.clipboard.writeText(getText());
    const prev = btn.textContent;
    btn.textContent = doneLabel;
    setTimeout(() => {
      btn.textContent = prev;
    }, 1500);
  };
}

async function showResult(data) {
  show("view-result");
  document.getElementById("short-url").textContent = data.shortUrl;
  document.getElementById("current-dest").textContent = data.destination;
  document.getElementById("edit-token-display").textContent = data.editToken;
  const manageHref = `/manage/${data.id}?token=${encodeURIComponent(data.editToken)}`;
  const manageUrl = `${location.origin}${manageHref}`;
  document.getElementById("manage-url-display").textContent = manageUrl;
  document.getElementById("manage-link").href = manageHref;

  const canvas = document.getElementById("qr-canvas");
  const downloadBtn = document.getElementById("download-png");
  downloadBtn.disabled = true;
  try {
    await drawQr(canvas, data.shortUrl);
    downloadBtn.disabled = false;
  } catch (err) {
    console.error(err);
    alert("Could not draw the QR code. Try refreshing the page.");
  }

  wireCopyButton("copy-short", () => data.shortUrl, "Copied");
  wireCopyButton("copy-token", () => data.editToken, "Copied");
  wireCopyButton("copy-manage", () => manageUrl, "Copied");

  downloadBtn.onclick = () => {
    const link = document.createElement("a");
    link.download = `ownstage-qr-${data.id}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  document.getElementById("new-qr").onclick = () => {
    history.pushState({}, "", "/");
    show("view-create");
    document.getElementById("destination").focus();
  };
}

document.getElementById("create-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  btn.textContent = "Creating…";
  try {
    const data = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ url: document.getElementById("destination").value }),
    });
    saveSession(data.id, data.editToken, data.shortUrl, data.destination);
    await showResult(data);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Create QR code";
  }
});

window.addEventListener("popstate", route);
route();
