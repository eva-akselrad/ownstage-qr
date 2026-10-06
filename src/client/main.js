import QRCode from "qrcode";

let currentUser = null;
let usage = null;

function show(id) {
  for (const el of document.querySelectorAll(".page-view")) {
    el.classList.toggle("hidden", el.id !== id);
  }
  document.body.classList.toggle("has-landing-hero", id === "view-create");
}

async function drawQr(canvas, text) {
  await QRCode.toCanvas(canvas, text, {
    width: canvas.width,
    margin: 2,
    color: { dark: "#0e0c0a", light: "#ffffff" },
  });
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
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

function updateNav() {
  const guest = document.getElementById("nav-auth-guest");
  const userNav = document.getElementById("nav-auth-user");
  if (currentUser) {
    guest.classList.add("hidden");
    userNav.classList.remove("hidden");
    document.getElementById("nav-user-email").textContent = currentUser.email;
  } else {
    guest.classList.remove("hidden");
    userNav.classList.add("hidden");
  }
}

function updateCreateView() {
  const signedIn = Boolean(currentUser);
  document.getElementById("create-signin-prompt").classList.toggle("hidden", signedIn);
  document.getElementById("create-form").classList.toggle("hidden", !signedIn);
  const hint = document.getElementById("usage-hint");
  if (signedIn && usage) {
    hint.textContent = `${usage.links} of ${usage.limit} QR codes on ${currentUser.plan} plan`;
  } else {
    hint.textContent = "";
  }
}

async function refreshMe() {
  try {
    const data = await api("/api/auth/me");
    currentUser = data.user;
    usage = data.usage;
  } catch {
    currentUser = null;
    usage = null;
  }
  updateNav();
  updateCreateView();
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

async function openDashboard() {
  if (!currentUser) {
    history.pushState({}, "", "/login");
    showAuth("login");
    return;
  }
  await refreshMe();
  show("view-dashboard");
  const data = await api("/api/links");
  document.getElementById("dashboard-usage").textContent =
    `${data.links.length} saved QR code${data.links.length === 1 ? "" : "s"} · ${currentUser.plan} plan`;
  const list = document.getElementById("link-list");
  list.innerHTML = "";
  const empty = document.getElementById("link-list-empty");
  if (!data.links.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  for (const link of data.links) {
    const li = document.createElement("li");
    li.className = "link-list-item";
    const title = link.label || link.destination;
    li.innerHTML = `
      <div class="link-list-main">
        <strong>${escapeHtml(title)}</strong>
        <code>${escapeHtml(link.shortUrl)}</code>
        <span class="link-list-dest">${escapeHtml(link.destination)}</span>
      </div>
      <div class="link-list-actions">
        <a class="btn btn--ghost btn--sm" href="/manage/${link.id}">Edit</a>
      </div>
    `;
    list.appendChild(li);
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showAuth(mode) {
  show("view-auth");
  const isSignup = mode === "signup";
  document.getElementById("auth-eyebrow").textContent = isSignup ? "Get started" : "Welcome back";
  document.getElementById("auth-title").textContent = isSignup ? "Create account" : "Sign in";
  document.getElementById("auth-lede").textContent = isSignup
    ? "Free account — save QR codes and change destinations anytime."
    : "Access your saved dynamic QR codes from any device.";
  document.getElementById("auth-submit").textContent = isSignup ? "Create account" : "Sign in";
  document.getElementById("auth-password").autocomplete = isSignup ? "new-password" : "current-password";
  document.getElementById("auth-switch").innerHTML = isSignup
    ? `Already have an account? <a href="/login">Sign in</a>`
    : `New here? <a href="/signup">Create a free account</a>`;
  document.getElementById("auth-error").classList.add("hidden");
  document.getElementById("auth-form").dataset.mode = mode;
}

async function openManage(id, bearerToken = null) {
  const info = await api(`/api/links/${id}`);
  show("view-manage");
  document.getElementById("manage-short-url").textContent = info.shortUrl;
  document.getElementById("new-destination").value = info.destination;
  document.getElementById("new-label").value = info.label || "";
  await drawQr(document.getElementById("manage-qr"), info.shortUrl);

  const form = document.getElementById("update-form");
  const status = document.getElementById("manage-status");
  form.onsubmit = async (e) => {
    e.preventDefault();
    status.textContent = "Saving…";
    status.classList.remove("error");
    const headers = bearerToken ? { authorization: `Bearer ${bearerToken}` } : {};
    try {
      await api(`/api/links/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          url: document.getElementById("new-destination").value,
          label: document.getElementById("new-label").value,
        }),
      });
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
    await openManage(id, token);
  };
}

async function showResult(data) {
  show("view-result");
  document.getElementById("short-url").textContent = data.shortUrl;
  document.getElementById("current-dest").textContent = data.destination;
  document.getElementById("manage-link").href = `/manage/${data.id}`;

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

  downloadBtn.onclick = () => {
    const link = document.createElement("a");
    link.download = `ownstage-qr-${data.id}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  document.getElementById("new-qr").onclick = () => {
    history.pushState({}, "", "/");
    route();
  };
}

async function route() {
  const path = location.pathname.replace(/\/$/, "") || "/";

  if (path === "/login") {
    showAuth("login");
    return;
  }
  if (path === "/signup") {
    showAuth("signup");
    return;
  }
  if (path === "/dashboard") {
    await openDashboard();
    return;
  }

  const manageMatch = path.match(/^\/manage\/([^/]+)$/);
  if (manageMatch) {
    const id = manageMatch[1];
    try {
      await openManage(id);
    } catch {
      show("view-unlock");
      setupUnlock(id);
    }
    return;
  }

  show("view-create");
  updateCreateView();
}

document.getElementById("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const mode = e.target.dataset.mode;
  const err = document.getElementById("auth-error");
  err.classList.add("hidden");
  const email = document.getElementById("auth-email").value;
  const password = document.getElementById("auth-password").value;
  const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
  try {
    await api(endpoint, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    await refreshMe();
    history.pushState({}, "", "/dashboard");
    await openDashboard();
  } catch (authErr) {
    err.textContent = authErr.message;
    err.classList.remove("hidden");
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  currentUser = null;
  usage = null;
  updateNav();
  history.pushState({}, "", "/");
  route();
});

document.getElementById("create-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Creating…";
  try {
    const data = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({
        url: document.getElementById("destination").value,
        label: document.getElementById("label").value,
      }),
    });
    await refreshMe();
    history.pushState({}, "", `/manage/${data.id}`);
    await showResult(data);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Create QR code";
  }
});

window.addEventListener("popstate", () => {
  route();
});

await refreshMe();
route();
