// Storage for all captured requests, organized by tab
let requests = {};
// Active panel connections
let ports = {};
// Temporary storage for request details being assembled (webRequest flow)
let requestDetails = {};
// Per-tab capture state: absent/true = capturing, false = paused
const captureState = {};
// Maximum number of requests to keep per tab
const MAX_REQUESTS_PER_TAB = 1000;

// ─── Debugger state ──────────────────────────────────────────────────────────
// Numeric tabIds with an active chrome.debugger attachment
const debuggerAttached = new Set();
// In-flight CDP requests: numericTabId → { cdpRequestId → partialRequest }
const cdpPending = {};

function log(...a) {
  console.log("[Lotus]", ...a);
}

// ─── Debounced storage persistence ───────────────────────────────────────────
// Coalesces rapid bursts of requests (page load) into a single storage write
// instead of one write per request, which would serialize megabytes repeatedly.
let _saveTimer = null;
function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    chrome.storage.local.set({ lotusRequests: requests });
  }, 300);
}

// Load saved requests from storage
chrome.storage.local.get(["lotusRequests"], (result) => {
  if (result.lotusRequests) {
    requests = result.lotusRequests;
    log("Loaded requests from storage");
  }
});

// Clean up data when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  const id = String(tabId);
  if (requests[id]) {
    delete requests[id];
    chrome.storage.local.set({ lotusRequests: requests });
    log("Cleaned up requests for closed tab", id);
  }
  delete captureState[id];
  detachDebugger(tabId);
});

// ─── Debugger management ─────────────────────────────────────────────────────
async function attachDebugger(tabId) {
  const numId = typeof tabId === "number" ? tabId : parseInt(tabId, 10);
  if (isNaN(numId) || debuggerAttached.has(numId)) return;
  try {
    await chrome.debugger.attach({ tabId: numId }, "1.3");
    await chrome.debugger.sendCommand({ tabId: numId }, "Network.enable", {
      maxPostDataSize: 65536,
    });
    debuggerAttached.add(numId);
    log("Debugger attached to tab", numId);
  } catch (err) {
    log("Failed to attach debugger to tab", numId, err.message);
  }
}

async function detachDebugger(tabId) {
  const numId = typeof tabId === "number" ? tabId : parseInt(tabId, 10);
  if (isNaN(numId) || !debuggerAttached.has(numId)) return;
  debuggerAttached.delete(numId);
  delete cdpPending[numId];
  try {
    await chrome.debugger.detach({ tabId: numId });
    log("Debugger detached from tab", numId);
  } catch (err) {
    log("Error detaching debugger from tab", numId, err.message);
  }
}

// Handle external detachment (e.g. user opens native DevTools on the same tab)
chrome.debugger.onDetach.addListener((source) => {
  const numId = source.tabId;
  if (!numId) return;
  debuggerAttached.delete(numId);
  delete cdpPending[numId];
  // Notify the panel so it can update its Full Capture button state
  const tabIdStr = String(numId);
  if (ports[tabIdStr]) {
    ports[tabIdStr].postMessage({ type: "FULL_CAPTURE_STATE", enabled: false });
  }
  log("Debugger detached externally for tab", numId);
});

// ─── CDP event handler ───────────────────────────────────────────────────────
const BODY_LIMIT = 512 * 1024;

chrome.debugger.onEvent.addListener((source, method, params) => {
  const numId = source.tabId;
  if (!numId || !debuggerAttached.has(numId)) return;
  const tabIdStr = String(numId);

  if (method === "Network.requestWillBeSent") {
    if (!cdpPending[numId]) cdpPending[numId] = {};
    if (params.redirectResponse && cdpPending[numId][params.requestId]) {
      // Redirect: update URL/method on existing entry, keep original headers/body
      cdpPending[numId][params.requestId].url = params.request.url;
      cdpPending[numId][params.requestId].method = params.request.method;
    } else {
      cdpPending[numId][params.requestId] = {
        url: params.request.url,
        method: params.request.method,
        requestHeaders: Object.entries(params.request.headers || {}).map(
          ([name, value]) => ({ name, value })
        ),
        requestBody: params.request.postData || null,
        timestamp: params.wallTime
          ? new Date(params.wallTime * 1000).toISOString()
          : new Date().toISOString(),
      };
    }
  } else if (method === "Network.responseReceived") {
    const entry = cdpPending[numId]?.[params.requestId];
    if (!entry) return;
    entry.status = params.response.status;
    entry.statusCode = params.response.status;
    entry.statusText = params.response.statusText || String(params.response.status);
    entry.responseHeaders = Object.entries(params.response.headers || {}).map(
      ([name, value]) => ({ name, value })
    );
    const contentType =
      Object.entries(params.response.headers || {}).find(
        ([k]) => k.toLowerCase() === "content-type"
      )?.[1] || "";
    entry._captureBody =
      params.response.status >= 200 &&
      params.response.status < 300 &&
      /json|text|xml|javascript|html/.test(contentType);
  } else if (method === "Network.loadingFinished") {
    const entry = cdpPending[numId]?.[params.requestId];
    if (!entry) return;
    delete cdpPending[numId][params.requestId];

    if (captureState[tabIdStr] === false) return;

    const shouldCapture = entry._captureBody;
    delete entry._captureBody;

    if (!shouldCapture) {
      storeAndSendRequest(tabIdStr, entry);
      return;
    }

    chrome.debugger
      .sendCommand({ tabId: numId }, "Network.getResponseBody", {
        requestId: params.requestId,
      })
      .then((result) => {
        let body = result.base64Encoded ? atob(result.body) : result.body;
        if (body.length > BODY_LIMIT) {
          body =
            body.slice(0, BODY_LIMIT) +
            "\n[truncated — response exceeded 512 KB]";
        }
        entry.responseBody = body;
      })
      .catch(() => {
        // Body unavailable (redirect terminal, empty body, etc.)
      })
      .finally(() => {
        storeAndSendRequest(tabIdStr, entry);
      });
  } else if (method === "Network.loadingFailed") {
    delete cdpPending[numId]?.[params.requestId];
  }
});

// ─── Store and broadcast a completed request ─────────────────────────────────
function storeAndSendRequest(tabId, entry) {
  const request = {
    ...entry,
    requestId: crypto.randomUUID(),
  };

  if (!requests[tabId]) requests[tabId] = [];
  if (requests[tabId].length >= MAX_REQUESTS_PER_TAB) {
    requests[tabId] = requests[tabId].slice(-MAX_REQUESTS_PER_TAB + 1);
  }
  requests[tabId].push(request);
  scheduleSave();

  if (ports[tabId]) {
    ports[tabId].postMessage({ type: "NEW", data: request });
  }
}

// ─── webRequest handlers (skip tabs handled by debugger) ─────────────────────

// Capture request body
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0 || debuggerAttached.has(details.tabId)) return;
    const requestId = details.requestId;
    if (!requestDetails[requestId]) requestDetails[requestId] = {};
    requestDetails[requestId].requestBody = details.requestBody;
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

// Capture request headers
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (details.tabId < 0 || debuggerAttached.has(details.tabId)) return;
    const requestId = details.requestId;
    if (!requestDetails[requestId]) requestDetails[requestId] = {};
    requestDetails[requestId].requestHeaders = details.requestHeaders;
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders"]
);

// Capture response headers
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || debuggerAttached.has(details.tabId)) return;
    const requestId = details.requestId;
    if (!requestDetails[requestId]) requestDetails[requestId] = {};
    requestDetails[requestId].responseHeaders = details.responseHeaders;
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Clean up requestDetails for failed/cancelled requests to prevent memory leaks
chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    delete requestDetails[details.requestId];
  },
  { urls: ["<all_urls>"] }
);

// Capture completed requests
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0 || debuggerAttached.has(details.tabId)) {
      delete requestDetails[details.requestId];
      return;
    }
    const tabId = String(details.tabId);
    const requestId = details.requestId;

    // Respect per-tab pause state
    if (captureState[tabId] === false) {
      delete requestDetails[requestId];
      return;
    }

    const reqDetails = requestDetails[requestId] || {};

    const request = {
      url: details.url,
      method: details.method,
      status: details.statusCode,
      statusText: details.statusLine,
      requestHeaders: reqDetails.requestHeaders || [],
      requestBody: reqDetails.requestBody || null,
      responseHeaders: reqDetails.responseHeaders || [],
      timestamp: new Date().toISOString(),
      requestId: requestId,
    };

    if (!requests[tabId]) requests[tabId] = [];
    if (requests[tabId].length >= MAX_REQUESTS_PER_TAB) {
      requests[tabId] = requests[tabId].slice(-MAX_REQUESTS_PER_TAB + 1);
    }
    requests[tabId].push(request);
    scheduleSave();

    if (ports[tabId]) {
      ports[tabId].postMessage({ type: "NEW", data: request });
    }

    delete requestDetails[requestId];
  },
  { urls: ["<all_urls>"] }
);

// ─── Handle panel connections ─────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith("lotus-")) return;

  const tabId = port.name.split("-")[1];
  if (!tabId || !/^\d+$/.test(tabId)) return;

  ports[tabId] = port;
  log("Panel connected", tabId);

  port.postMessage({
    type: "INIT",
    data: requests[tabId] || [],
    capturing: captureState[tabId] !== false,
    fullCapture: debuggerAttached.has(parseInt(tabId, 10)),
  });

  port.onMessage.addListener((msg) => {
    if (msg.type === "CLEAR") {
      requests[tabId] = [];
      chrome.storage.local.set({ lotusRequests: requests });
      log("Cleared requests for tab", tabId);
    } else if (msg.type === "HEARTBEAT") {
      port.postMessage({ type: "HEARTBEAT_ACK" });
    } else if (msg.type === "PAUSE") {
      captureState[tabId] = false;
      log("Capture paused for tab", tabId);
    } else if (msg.type === "RESUME") {
      captureState[tabId] = true;
      log("Capture resumed for tab", tabId);
    } else if (msg.type === "FULL_CAPTURE_ENABLE") {
      attachDebugger(parseInt(tabId, 10));
    } else if (msg.type === "FULL_CAPTURE_DISABLE") {
      detachDebugger(parseInt(tabId, 10));
    } else if (msg.type === "DELETE") {
      const ids = new Set(msg.ids || []);
      if (requests[tabId]) {
        requests[tabId] = requests[tabId].filter((r) => !ids.has(r.requestId));
        chrome.storage.local.set({ lotusRequests: requests });
      }
    } else if (msg.type === "STORE") {
      if (msg.data) {
        if (!requests[tabId]) requests[tabId] = [];
        requests[tabId].push(msg.data);
        chrome.storage.local.set({ lotusRequests: requests });
      }
    }
  });

  port.onDisconnect.addListener(() => {
    delete ports[tabId];
    log("Panel disconnected", tabId);
    detachDebugger(parseInt(tabId, 10));
  });
});
