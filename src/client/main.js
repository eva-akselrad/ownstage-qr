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
  } else {
    guest.classList.remove("hidden");
    userNav.classList.add("hidden");
  }
}

function updateUsageHints() {
  const hint = document.getElementById("usage-hint");
  if (!usage || !currentUser) {
    hint.classList.add("hidden");
    hint.textContent = "";
    return;
  }
  if (usage.limit - usage.links <= 50) {
    hint.textContent = `${usage.links} / ${usage.limit} codes`;
    hint.classList.remove("hidden");
  } else {
    hint.classList.add("hidden");
  }
}

function updateCreateView() {
  const signedIn = Boolean(currentUser);
  document.getElementById("create-signin-prompt").classList.toggle("hidden", signedIn);
  document.getElementById("create-form").classList.toggle("hidden", !signedIn);
  updateUsageHints();
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

function wireCopyButton(buttonId, getText) {
  document.getElementById(buttonId).onclick = async () => {
    const btn = document.getElementById(buttonId);
    await navigator.clipboard.writeText(getText());
    const prev = btn.textContent;
    btn.textContent = "Copied";
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
  const usageEl = document.getElementById("dashboard-usage");
  if (usage && usage.limit - data.links.length <= 50) {
    usageEl.textContent = `${data.links.length} / ${usage.limit} codes`;
    usageEl.classList.remove("hidden");
  } else {
    usageEl.classList.add("hidden");
  }
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
    let title = link.label;
    if (!title) {
      try {
        title = new URL(link.destination).hostname;
      } catch {
        title = link.destination;
      }
    }
    li.innerHTML = `
      <a class="link-list-hit" href="/manage/${link.id}">
        <span class="link-list-title">${escapeHtml(title)}</span>
        <span class="link-list-dest">${escapeHtml(link.destination)}</span>
      </a>
      <code class="link-list-code">${escapeHtml(link.shortUrl)}</code>
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
  document.getElementById("auth-title").textContent = isSignup ? "Sign up" : "Sign in";
  document.getElementById("auth-submit").textContent = isSignup ? "Create account" : "Sign in";
  document.getElementById("auth-password").autocomplete = isSignup ? "new-password" : "current-password";
  document.getElementById("auth-switch").innerHTML = isSignup
    ? `Have an account? <a href="/login">Sign in</a>`
    : `Need an account? <a href="/signup">Sign up</a>`;
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
      status.textContent = "Saved.";
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
      err.textContent = "Invalid token.";
      err.classList.remove("hidden");
      return;
    }
    await openManage(id, token);
  };
}

async function showResult(data) {
  show("view-result");
  history.replaceState({}, "", `/qr/${data.id}`);
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
    alert("Couldn't render the QR. Refresh and try again.");
  }

  wireCopyButton("copy-short", () => data.shortUrl);

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

  const qrMatch = path.match(/^\/qr\/([^/]+)$/);
  if (qrMatch) {
    try {
      const info = await api(`/api/links/${qrMatch[1]}`);
      await showResult({
        id: info.id,
        shortUrl: info.shortUrl,
        destination: info.destination,
      });
    } catch {
      history.replaceState({}, "", "/");
      show("view-create");
      updateCreateView();
    }
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
    history.pushState({}, "", "/");
    route();
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
  const prev = btn.textContent;
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
    document.getElementById("destination").value = "";
    document.getElementById("label").value = "";
    await showResult(data);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
});

window.addEventListener("popstate", () => {
  route();
});

function initCookieBanner() {
  const key = "osqr-cookie-notice";
  const banner = document.getElementById("cookie-banner");
  const accept = document.getElementById("cookie-accept");
  if (!banner || !accept) return;
  if (localStorage.getItem(key)) return;
  banner.classList.remove("hidden");
  accept.addEventListener("click", () => {
    localStorage.setItem(key, "1");
    banner.classList.add("hidden");
  });
}

initCookieBanner();
await refreshMe();
route();
