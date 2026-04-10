// filepath: c:\Users\trist\Playground\Lotus\panel.js
import {
  toHeaderObject,
  formatRequestBody,
} from "./lib/utils.js";

// Escape user/network-supplied strings before inserting into innerHTML
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── DOM references ────────────────────────────────────────────────────────
const requestsContainer  = document.getElementById("requests");
const filterInput        = document.getElementById("filter");
const clearButton        = document.getElementById("clear");
const copyCurlButton     = document.getElementById("copy-curl");
const modifyResendButton = document.getElementById("modify-resend");
const deleteRequestButton = document.getElementById("delete-request");
const groupRelatedToggle  = document.getElementById("group-related");
const pauseButton         = document.getElementById("pause-capture");
const requestCountEl      = document.getElementById("request-count");
const themeToggle         = document.getElementById("theme-toggle");

// Modal
const modifyModal  = document.getElementById("modify-modal");
const modalMethod  = document.getElementById("modal-method");
const modalUrl     = document.getElementById("modal-url");
const modalHeaders = document.getElementById("modal-headers");
const modalBody    = document.getElementById("modal-body");
const modalCancel  = document.getElementById("modal-cancel");
const modalSend    = document.getElementById("modal-send");
const closeModalBtn = document.querySelector(".close-modal");

// Request details
const reqMethod     = document.getElementById("req-method");
const reqUrl        = document.getElementById("req-url");
const reqHeadersPre = document.querySelector("#req-headers pre");
const reqBodyPre    = document.querySelector("#req-body pre");

// Response details
const respStatus     = document.getElementById("resp-status");
const respHeadersPre = document.querySelector("#resp-headers pre");
const respBodyPre    = document.querySelector("#resp-body pre");

// ─── Tab switching ──────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    tab.parentElement.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    const container = tab.closest(".request-panel, .response-panel");
    container.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.target).classList.add("active");
  });
});

// ─── State ─────────────────────────────────────────────────────────────────
let currentTabId = String(chrome.devtools.inspectedWindow.tabId);
let requests = [];
let selectedRequestId = null;
let port = null;
let connectionHealthy = true;
let heartbeatInterval = null;
let captureEnabled = true;

// Formatting state — declared early so pref loader can mutate before first render
let isLightMode = false;
let groupRelatedRequests = false;
let requestFormattingState = { req: true, resp: true };
let requestFormatType = { req: "json", resp: "json" };
let originalContent = { reqHeaders: "", reqBody: "", respHeaders: "", respBody: "" };

// ─── Toast notifications ────────────────────────────────────────────────────
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast${type !== "info" ? ` toast-${type}` : ""}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 220);
  }, 2500);
}

// ─── Two-step confirm ───────────────────────────────────────────────────────
const confirmPending = new Map();

function requireConfirm(buttonEl, action) {
  if (confirmPending.has(buttonEl)) {
    const { timer, restore } = confirmPending.get(buttonEl);
    clearTimeout(timer);
    restore();
    action();
    return;
  }
  const originalText = buttonEl.textContent.trim();
  buttonEl.textContent = "Confirm?";
  buttonEl.classList.add("confirming");

  const restore = () => {
    buttonEl.textContent = originalText;
    buttonEl.classList.remove("confirming");
    confirmPending.delete(buttonEl);
  };
  const timer = setTimeout(restore, 3000);
  confirmPending.set(buttonEl, { timer, restore });
}

function cancelAllConfirms() {
  confirmPending.forEach(({ timer, restore }) => {
    clearTimeout(timer);
    restore();
  });
  confirmPending.clear();
}

// ─── Request count ──────────────────────────────────────────────────────────
function updateRequestCount(total, visible) {
  if (!requestCountEl) return;
  if (visible < total) {
    requestCountEl.textContent = `${visible} / ${total} requests`;
  } else {
    requestCountEl.textContent = `${total} request${total !== 1 ? "s" : ""}`;
  }
}

// ─── Transform request ──────────────────────────────────────────────────────
function transformRequest(req, index) {
  const id = req.requestId || `req-${index}`;
  return {
    ...req,
    id,
    // Modified requests stored by the panel use statusCode; background-captured
    // requests use status. Support both so panel reloads don't lose status.
    statusCode: req.status ?? req.statusCode,
    requestHeaders: toHeaderObject(req.requestHeaders),
    responseHeaders: toHeaderObject(req.responseHeaders),
    time: new Date(req.timestamp || Date.now()).getTime(),
    source: req.source || "page",
    parentId: req.parentId || null,
  };
}

// ─── Background connection ──────────────────────────────────────────────────
function connectToBackgroundScript() {
  try {
    if (port) {
      try { port.disconnect(); } catch (e) { /* ignore */ }
    }
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    port = chrome.runtime.connect({ name: `lotus-${currentTabId}` });

    port.onMessage.addListener((message) => {
      if (!message || !message.type) return;

      if (message.type === "INIT") {
        requests = (message.data || []).map(transformRequest);
        // Sync pause state from background
        captureEnabled = message.capturing !== false;
        updatePauseButton();
        renderRequestsList();
      } else if (message.type === "NEW") {
        requests.push(transformRequest(message.data));
        renderRequestsList();
      } else if (message.type === "UPDATE") {
        const updated = transformRequest(message.data);
        const idx = requests.findIndex((r) => r.id === updated.id);
        if (idx !== -1) {
          requests[idx] = updated;
          if (selectedRequestId === updated.id) selectRequest(selectedRequestId);
        }
      } else if (message.type === "HEARTBEAT_ACK") {
        connectionHealthy = true;
      }
    });

    port.onDisconnect.addListener(() => {
      connectionHealthy = false;
      setTimeout(connectToBackgroundScript, 1000);
    });

    heartbeatInterval = setInterval(() => {
      if (!port) return;
      try {
        connectionHealthy = false;
        port.postMessage({ type: "HEARTBEAT" });
        setTimeout(() => {
          if (!connectionHealthy) connectToBackgroundScript();
        }, 5000);
      } catch (e) {
        connectToBackgroundScript();
      }
    }, 30000);
  } catch (e) {
    console.error("Error connecting to background script:", e);
    setTimeout(connectToBackgroundScript, 2000);
  }
}

connectToBackgroundScript();

// ─── Helpers ────────────────────────────────────────────────────────────────
function getStatusClass(status) {
  if (!status) return "";
  if (status >= 200 && status < 300) return "status-2xx";
  if (status >= 300 && status < 400) return "status-3xx";
  if (status >= 400 && status < 500) return "status-4xx";
  if (status >= 500) return "status-5xx";
  return "";
}

function clearDetailsPanel() {
  reqMethod.textContent = "-";
  reqUrl.textContent = "-";
  reqHeadersPre.textContent = "";
  reqBodyPre.textContent = "";
  respStatus.textContent = "-";
  respHeadersPre.textContent = "";
  respBodyPre.textContent = "";
  const existingRelInfo = document.querySelector(".request-panel .relationship-info");
  if (existingRelInfo) existingRelInfo.remove();
}

// ─── Render request list ────────────────────────────────────────────────────
function renderRequestsList() {
  const filter = filterInput.value.trim().toLowerCase();

  const sortedRequests = [...requests].sort((a, b) => b.time - a.time);

  // Build sets for relationship badges
  const hasModifiedVersions = new Set();
  for (const req of sortedRequests) {
    if (req.source === "modified" && req.parentId) {
      hasModifiedVersions.add(req.parentId);
    }
  }

  // Build into a DocumentFragment — one DOM write at the end
  const fragment = document.createDocumentFragment();
  let visibleCount = 0;

  for (const request of sortedRequests) {
    if (groupRelatedRequests && request.source === "modified" && request.parentId) {
      continue;
    }
    if (
      filter &&
      !request.url.toLowerCase().includes(filter) &&
      !request.method.toLowerCase().includes(filter)
    ) {
      continue;
    }

    visibleCount++;
    fragment.appendChild(buildRequestItem(request, hasModifiedVersions));

    // Grouped children
    if (groupRelatedRequests && hasModifiedVersions.has(request.id)) {
      const children = sortedRequests.filter(
        (r) => r.parentId === request.id && r.source === "modified"
      );
      if (children.length > 0) {
        const childContainer = document.createElement("div");
        childContainer.classList.add("child-requests-container");
        for (const child of children) {
          childContainer.appendChild(buildRequestItem(child, hasModifiedVersions));
        }
        fragment.appendChild(childContainer);
      }
    }
  }

  requestsContainer.innerHTML = "";
  requestsContainer.appendChild(fragment);
  updateRequestCount(requests.length, visibleCount);
}

function buildRequestItem(request, hasModifiedVersions) {
  const el = document.createElement("div");
  el.classList.add("request-item");
  el.dataset.id = request.id;

  if (request.source === "modified") el.classList.add("modified-request");
  else if (hasModifiedVersions.has(request.id)) el.classList.add("has-modified-versions");
  if (selectedRequestId === request.id) el.classList.add("selected");

  let urlDisplay;
  try {
    const u = new URL(request.url);
    urlDisplay = u.pathname + u.search;
  } catch {
    urlDisplay = request.url;
  }

  const time = new Date(request.time).toLocaleTimeString();

  let badge = "";
  if (request.source === "modified") {
    const title = request.originalDeleted
      ? "Modified request (original deleted)"
      : "Modified request";
    badge = `<span class="source-indicator modified-indicator" title="${escapeHtml(title)}">M</span>`;
  } else if (hasModifiedVersions.has(request.id)) {
    badge = `<span class="source-indicator original-with-mods-indicator" title="Has modified versions">+</span>`;
  }

  el.innerHTML = `
    <div class="request-url">${escapeHtml(urlDisplay)}</div>
    <div class="request-meta">
      ${badge}
      <span class="method" data-method="${escapeHtml(request.method)}">${escapeHtml(request.method)}</span>
      <span class="time">${escapeHtml(time)}</span>
      <span class="status ${getStatusClass(request.statusCode)}">${request.statusCode || "-"}</span>
    </div>
  `;

  el.addEventListener("click", (e) => {
    e.stopPropagation();
    selectRequest(request.id);
  });
  return el;
}

// ─── Select request ─────────────────────────────────────────────────────────
function selectRequest(requestId) {
  cancelAllConfirms();
  selectedRequestId = requestId;

  document.querySelectorAll(".request-item").forEach((item) => {
    item.classList.toggle("selected", item.dataset.id === requestId);
  });

  const request = requests.find((r) => r.id === requestId);
  if (!request) return;

  reqMethod.textContent = request.method || "-";
  reqUrl.textContent = request.url || "-";

  // Relationship info
  const requestPanel = document.querySelector(".request-panel");
  requestPanel.querySelector(".relationship-info")?.remove();

  const isModified = request.source === "modified";
  const parentRequest = request.parentId
    ? requests.find((r) => r.id === request.parentId)
    : null;
  const modifiedVersions = requests.filter(
    (r) => r.parentId === request.id && r.source === "modified"
  );

  try {
    if (isModified) {
      const relInfo = document.createElement("div");
      relInfo.classList.add("relationship-info");
      if (parentRequest) {
        relInfo.innerHTML = `
          <span>Modified from:</span>
          <a class="parent-link" data-id="${escapeHtml(request.parentId)}" title="View original">View original</a>
        `;
      } else if (request.parentId) {
        relInfo.innerHTML = `
          <span>Modified from:</span>
          <span class="deleted-parent">Original deleted</span>
        `;
      }
      const tabsEl = requestPanel.querySelector(".tabs");
      if (tabsEl) {
        requestPanel.insertBefore(relInfo, tabsEl);
        relInfo.querySelector(".parent-link")?.addEventListener("click", (e) => {
          selectRequest(e.target.dataset.id);
        });
      }
    } else if (modifiedVersions.length > 0) {
      const relInfo = document.createElement("div");
      relInfo.classList.add("relationship-info");
      const links = modifiedVersions
        .map((mod, i) => `<a class="child-link" data-id="${escapeHtml(mod.id)}">Version ${i + 1}</a>`)
        .join(", ");
      relInfo.innerHTML = `<span>${modifiedVersions.length} modified version${modifiedVersions.length > 1 ? "s" : ""}:</span> ${links}`;
      const tabsEl = requestPanel.querySelector(".tabs");
      if (tabsEl) {
        requestPanel.insertBefore(relInfo, tabsEl);
        relInfo.querySelectorAll(".child-link").forEach((link) => {
          link.addEventListener("click", (e) => selectRequest(e.target.dataset.id));
        });
      }
    }
  } catch (err) {
    console.error("Error displaying relationship info:", err);
  }

  // Store raw content for toggle
  originalContent.reqHeaders = request.requestHeaders || {};
  originalContent.reqBody = formatRequestBody(request.requestBody);
  originalContent.respHeaders = request.responseHeaders || {};
  originalContent.respBody = request.responseBody
    || (["GET", "HEAD"].includes(request.method?.toUpperCase())
      ? "Response body not available"
      : "Response body capture is disabled for non-GET requests to prevent side effects");

  // Base display (overridden by formatting below)
  reqHeadersPre.textContent = JSON.stringify(request.requestHeaders || {}, null, 2);
  reqBodyPre.textContent = formatRequestBody(request.requestBody);
  respHeadersPre.textContent = JSON.stringify(request.responseHeaders || {}, null, 2);
  respBodyPre.textContent = originalContent.respBody;

  const statusText = request.statusText
    ? `${request.statusCode} ${request.statusText}`
    : request.statusCode || "-";
  respStatus.textContent = statusText;
  respStatus.className = `status ${getStatusClass(request.statusCode)}`;

  try {
    if (requestFormattingState.req) {
      prettifyContent("reqHeaders", originalContent.reqHeaders);
      prettifyContent("reqBody", originalContent.reqBody);
    } else {
      showRawContent("reqHeaders", originalContent.reqHeaders);
      showRawContent("reqBody", originalContent.reqBody);
    }
    if (requestFormattingState.resp) {
      prettifyContent("respHeaders", originalContent.respHeaders);
      prettifyContent("respBody", originalContent.respBody);
    } else {
      showRawContent("respHeaders", originalContent.respHeaders);
      showRawContent("respBody", originalContent.respBody);
    }
  } catch (err) {
    console.error("Error formatting content:", err);
  }
}

// ─── Filter ─────────────────────────────────────────────────────────────────
filterInput.addEventListener("input", renderRequestsList);

// ─── Clear ──────────────────────────────────────────────────────────────────
clearButton.addEventListener("click", () => {
  requireConfirm(clearButton, () => {
    if (port) port.postMessage({ type: "CLEAR" });
    requests = [];
    selectedRequestId = null;
    clearDetailsPanel();
    renderRequestsList();
  });
});

// ─── Copy as cURL ────────────────────────────────────────────────────────────
copyCurlButton.addEventListener("click", () => {
  const request = requests.find((r) => r.id === selectedRequestId);
  if (!request) { showToast("No request selected", "error"); return; }

  const method = request.method || "GET";
  const headers = request.requestHeaders || {};
  const body = formatRequestBody(request.requestBody);

  let curl = `curl -X ${method} "${request.url}"`;
  for (const [key, value] of Object.entries(headers)) {
    curl += ` \\\n  -H "${key}: ${value.replace(/"/g, '\\"')}"`;
  }
  if (body && !["GET", "HEAD"].includes(method.toUpperCase())) {
    curl += ` \\\n  -d "${body.replace(/"/g, '\\"')}"`;
  }

  navigator.clipboard.writeText(curl).then(() => {
    const orig = copyCurlButton.textContent;
    copyCurlButton.textContent = "Copied!";
    setTimeout(() => { copyCurlButton.textContent = orig; }, 1500);
  }).catch(() => showToast("Failed to copy to clipboard", "error"));
});

// ─── Modify & Resend ────────────────────────────────────────────────────────
modifyResendButton.addEventListener("click", () => {
  const request = requests.find((r) => r.id === selectedRequestId);
  if (!request) { showToast("No request selected", "error"); return; }

  modalMethod.value = request.method || "GET";
  modalUrl.value = request.url || "";
  modalHeaders.value = JSON.stringify(request.requestHeaders || {}, null, 2);
  modalBody.value = formatRequestBody(request.requestBody);
  modifyModal.style.display = "block";
});

// ─── Delete request ──────────────────────────────────────────────────────────
deleteRequestButton.addEventListener("click", () => {
  const request = requests.find((r) => r.id === selectedRequestId);
  if (!request) { showToast("No request selected", "error"); return; }

  requireConfirm(deleteRequestButton, () => {
    const toDelete = new Set([request.id]);
    const children = requests.filter((r) => r.parentId === request.id);
    children.forEach((c) => toDelete.add(c.id));

    requests = requests.filter((r) => !toDelete.has(r.id));

    if (port) port.postMessage({ type: "DELETE", ids: [...toDelete] });

    if (children.length > 0) {
      showToast(`Deleted request and ${children.length} modified version${children.length > 1 ? "s" : ""}`);
    }

    if (toDelete.has(selectedRequestId)) {
      selectedRequestId = null;
      clearDetailsPanel();
    }
    renderRequestsList();
  });
});

// ─── Modal close ─────────────────────────────────────────────────────────────
closeModalBtn.addEventListener("click", () => { modifyModal.style.display = "none"; });
modalCancel.addEventListener("click", () => { modifyModal.style.display = "none"; });
window.addEventListener("click", (e) => {
  if (e.target === modifyModal) modifyModal.style.display = "none";
});

// ─── Send modified request ───────────────────────────────────────────────────
modalSend.addEventListener("click", async () => {
  const method = modalMethod.value;
  const url = modalUrl.value;

  let headers = {};
  try {
    headers = JSON.parse(modalHeaders.value);
  } catch {
    showToast("Invalid JSON in headers field", "error");
    return;
  }

  const body = modalBody.value;
  const options = { method, headers, credentials: "include" };
  if (body && !["GET", "HEAD"].includes(method.toUpperCase())) options.body = body;

  try {
    const response = await fetch(url, options);
    const responseText = await response.text();

    let formattedBody = responseText;
    try {
      if (response.headers.get("content-type")?.includes("json")) {
        formattedBody = JSON.stringify(JSON.parse(responseText), null, 2);
      }
    } catch { /* non-JSON body — use raw text */ }

    const timestamp = Date.now();
    const newRequestId = `modified-${timestamp}`;
    const newRequest = {
      requestId: newRequestId,
      id: newRequestId,
      url,
      method,
      status: response.status,       // used by transformRequest on reload
      statusCode: response.status,   // used directly by panel
      statusText: response.statusText,
      requestHeaders: headers,
      requestBody: body,
      responseHeaders: Object.fromEntries([...response.headers.entries()]),
      responseBody: formattedBody,
      time: timestamp,
      timestamp: new Date(timestamp).toISOString(),
      source: "modified",
      parentId: selectedRequestId,
    };

    requests.unshift(newRequest);
    if (port) port.postMessage({ type: "STORE", data: { ...newRequest } });

    renderRequestsList();
    selectRequest(newRequest.id);
    modifyModal.style.display = "none";
  } catch (err) {
    showToast(`Request failed: ${err.message}`, "error");
  }
});

// ─── Pause / Resume ──────────────────────────────────────────────────────────
function updatePauseButton() {
  if (!pauseButton) return;
  if (captureEnabled) {
    pauseButton.textContent = "Pause";
    pauseButton.classList.remove("paused");
    pauseButton.title = "Pause request capture";
  } else {
    pauseButton.textContent = "Resume";
    pauseButton.classList.add("paused");
    pauseButton.title = "Resume request capture";
  }
}

pauseButton?.addEventListener("click", () => {
  captureEnabled = !captureEnabled;
  updatePauseButton();
  if (port) port.postMessage({ type: captureEnabled ? "RESUME" : "PAUSE" });
  showToast(captureEnabled ? "Capture resumed" : "Capture paused");
});

// ─── Theme toggle ─────────────────────────────────────────────────────────────
themeToggle.addEventListener("click", () => {
  isLightMode = !isLightMode;
  document.body.classList.toggle("light-mode", isLightMode);
  themeToggle.textContent = isLightMode ? "Dark Mode" : "Light Mode";
  chrome.storage.local.set({ "lotus-theme": isLightMode ? "light" : "dark" });
});

// ─── Group related toggle ─────────────────────────────────────────────────────
if (groupRelatedToggle) {
  groupRelatedToggle.addEventListener("click", () => {
    groupRelatedRequests = !groupRelatedRequests;
    groupRelatedToggle.classList.toggle("active", groupRelatedRequests);
    groupRelatedToggle.textContent = groupRelatedRequests ? "Ungroup Related" : "Group Related";
    chrome.storage.local.set({ "lotus-group-related": groupRelatedRequests ? "true" : "false" });
    renderRequestsList();
  });
}

// ─── Format toggles (pretty / raw) ───────────────────────────────────────────
document.querySelectorAll(".format-toggle").forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const target = toggle.dataset.target;
    requestFormattingState[target] = !requestFormattingState[target];
    toggle.textContent = requestFormattingState[target] ? "Pretty" : "Raw";
    toggle.classList.toggle("active", requestFormattingState[target]);
    if (selectedRequestId) toggleFormatting(target);
  });
});

// ─── Format type dropdown (click-toggled) ────────────────────────────────────
const formatTypeButtons = document.querySelectorAll(".format-type-button");
const formatOptions = document.querySelectorAll(".format-option");

formatTypeButtons.forEach((button) => {
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    const dropdown = button.closest(".format-type-dropdown");
    const isOpen = dropdown.classList.contains("open");
    document.querySelectorAll(".format-type-dropdown.open").forEach((d) => d.classList.remove("open"));
    if (!isOpen) dropdown.classList.add("open");
  });
});

document.addEventListener("click", () => {
  document.querySelectorAll(".format-type-dropdown.open").forEach((d) => d.classList.remove("open"));
});

formatOptions.forEach((option) => {
  option.addEventListener("click", (e) => {
    e.stopPropagation();
    const target = option.dataset.target;
    const format = option.dataset.format;

    requestFormatType[target] = format;
    document.querySelector(`.format-type-button[data-target="${target}"]`).textContent = `Format: ${format.toUpperCase()}`;
    document.querySelectorAll(`.format-option[data-target="${target}"]`).forEach((o) => o.classList.remove("active"));
    option.classList.add("active");
    option.closest(".format-type-dropdown").classList.remove("open");

    chrome.storage.local.set({ [`lotus-${target}-format-type`]: format });
    if (requestFormattingState[target] && selectedRequestId) toggleFormatting(target);
  });
});

// ─── Load preferences from chrome.storage ────────────────────────────────────
chrome.storage.local.get(
  ["lotus-theme", "lotus-group-related", "lotus-req-format-type", "lotus-resp-format-type"],
  (prefs) => {
    // Theme
    if (prefs["lotus-theme"] === "light") {
      isLightMode = true;
      document.body.classList.add("light-mode");
      themeToggle.textContent = "Dark Mode";
    } else {
      themeToggle.textContent = "Light Mode";
    }

    // Grouping
    if (prefs["lotus-group-related"] === "true" && groupRelatedToggle) {
      groupRelatedRequests = true;
      groupRelatedToggle.classList.add("active");
      groupRelatedToggle.textContent = "Ungroup Related";
    }

    // Format types
    if (prefs["lotus-req-format-type"])  requestFormatType.req  = prefs["lotus-req-format-type"];
    if (prefs["lotus-resp-format-type"]) requestFormatType.resp = prefs["lotus-resp-format-type"];

    // Initialise format type button labels and active options
    formatTypeButtons.forEach((button) => {
      button.textContent = `Format: ${requestFormatType[button.dataset.target].toUpperCase()}`;
    });
    formatOptions.forEach((option) => {
      option.classList.toggle(
        "active",
        option.dataset.format === requestFormatType[option.dataset.target]
      );
    });
  }
);

// ─── Formatting functions ─────────────────────────────────────────────────────
function toggleFormatting(target) {
  if (target === "req") {
    if (requestFormattingState.req) {
      prettifyContent("reqHeaders", originalContent.reqHeaders);
      prettifyContent("reqBody", originalContent.reqBody);
    } else {
      showRawContent("reqHeaders", originalContent.reqHeaders);
      showRawContent("reqBody", originalContent.reqBody);
    }
  } else if (target === "resp") {
    if (requestFormattingState.resp) {
      prettifyContent("respHeaders", originalContent.respHeaders);
      prettifyContent("respBody", originalContent.respBody);
    } else {
      showRawContent("respHeaders", originalContent.respHeaders);
      showRawContent("respBody", originalContent.respBody);
    }
  }
}

function prettifyContent(targetId, content) {
  const elementId = targetId.replace(/([A-Z])/g, "-$1").toLowerCase();
  const preElement = document.querySelector(`#${elementId} pre`);
  if (!preElement) return;

  const targetType = targetId.startsWith("req") ? "req" : "resp";
  const formatType = requestFormatType[targetType];

  try {
    if (targetId.includes("Headers")) {
      const obj = typeof content === "object" ? content : JSON.parse(content);
      preElement.textContent = JSON.stringify(obj, null, 2);
    } else if (targetId.includes("Body")) {
      if (typeof content === "string" && content.trim() === "") {
        preElement.textContent = "";
        return;
      }
      preElement.className = "";

      switch (formatType) {
        case "json":
          try {
            const obj = typeof content === "object" ? content : JSON.parse(content);
            preElement.textContent = JSON.stringify(obj, null, 2);
            preElement.classList.add("language-json");
          } catch {
            preElement.textContent = typeof content === "string" ? content : JSON.stringify(content);
          }
          break;

        case "xml":
        case "html":
          try {
            preElement.textContent = typeof content === "string" && content.includes("<")
              ? formatXML(content)
              : content;
            preElement.classList.add(`language-${formatType}`);
          } catch {
            preElement.textContent = content;
          }
          break;

        case "js":
          preElement.textContent =
            typeof content === "string" ? content : JSON.stringify(content, null, 2);
          preElement.classList.add("language-javascript");
          break;

        case "css":
          try {
            preElement.textContent = typeof content === "string" && content.includes("{")
              ? formatCSS(content)
              : content;
            preElement.classList.add("language-css");
          } catch {
            preElement.textContent = content;
          }
          break;

        default:
          preElement.textContent =
            typeof content === "string" ? content : JSON.stringify(content);
      }
    }
  } catch {
    preElement.textContent =
      typeof content === "string" ? content : JSON.stringify(content, null, 2);
  }
}

function showRawContent(targetId, content) {
  const elementId = targetId.replace(/([A-Z])/g, "-$1").toLowerCase();
  const preElement = document.querySelector(`#${elementId} pre`);
  if (!preElement) return;

  if (targetId.includes("Headers") && typeof content === "object") {
    preElement.textContent = Object.entries(content)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
  } else {
    preElement.textContent =
      typeof content === "string" ? content : JSON.stringify(content);
  }
  preElement.className = "";
}

function formatXML(xml) {
  let formatted = "";
  let indent = "";
  const tab = "  ";
  xml = xml.trim().replace(/(>)(<)(\/*)/g, "$1\n$2$3");
  xml.split(/\n/).forEach((line) => {
    if (line.match(/^<\/\w/)) indent = indent.substring(tab.length);
    formatted += indent + line + "\n";
    if (line.match(/^<\w[^>]*[^/]>.*$/)) indent += tab;
  });
  return formatted.trim();
}

function formatCSS(css) {
  let formatted = css
    .replace(/\}/g, "}\n")
    .replace(/\{/g, " {\n  ")
    .replace(/;/g, ";\n  ")
    .replace(/\n {2}}/g, "\n}")
    .replace(/,[\r\n\s]+/g, ", ");
  return formatted.replace(/\n\s*\n/g, "\n");
}
