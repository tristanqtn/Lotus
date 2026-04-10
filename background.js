// Storage for all captured requests, organized by tab
let requests = {};
// Active panel connections
let ports = {};
// Temporary storage for request details being assembled
let requestDetails = {};
// Per-tab capture state: absent/true = capturing, false = paused
const captureState = {};
// Maximum number of requests to keep per tab
const MAX_REQUESTS_PER_TAB = 1000;

function log(...a) {
  console.log("[Lotus]", ...a);
}

// Load saved requests from storage
chrome.storage.local.get(["lotusRequests"], (result) => {
  if (result.lotusRequests) {
    requests = result.lotusRequests;
    log("Loaded requests from storage");
  }
});

// Clean up data when a tab is closed to prevent unbounded storage growth
chrome.tabs.onRemoved.addListener((tabId) => {
  const id = String(tabId);
  if (requests[id]) {
    delete requests[id];
    chrome.storage.local.set({ lotusRequests: requests });
    log("Cleaned up requests for closed tab", id);
  }
  delete captureState[id];
});

// Capture request body
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
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
    if (details.tabId < 0) return;
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
    if (details.tabId < 0) return;
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
    if (details.tabId < 0) return;
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

    // Try to capture response body using fetch() — GET requests only.
    // Re-fetching non-GET requests would fire them a second time (side effects,
    // double charges, CSRF token exhaustion). On pages with many concurrent
    // requests the original approach spawned dozens of parallel fetches with no
    // size cap, causing memory exhaustion in the service worker and browser crashes.
    try {
      const contentTypeHeader = reqDetails.responseHeaders?.find(
        (h) => h.name.toLowerCase() === "content-type"
      );
      const isTextBased =
        contentTypeHeader &&
        (contentTypeHeader.value.includes("json") ||
          contentTypeHeader.value.includes("text") ||
          contentTypeHeader.value.includes("xml") ||
          contentTypeHeader.value.includes("javascript") ||
          contentTypeHeader.value.includes("html"));
      const shouldCaptureBody =
        isTextBased &&
        details.method === "GET" &&
        details.statusCode >= 200 &&
        details.statusCode < 300;

      if (shouldCaptureBody) {
        const BODY_LIMIT = 512 * 1024;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        fetch(details.url, {
          method: "GET",
          headers:
            reqDetails.requestHeaders?.reduce((obj, h) => {
              obj[h.name] = h.value;
              return obj;
            }, {}) || {},
          credentials: "include",
          signal: controller.signal,
        })
          .then((response) => {
            clearTimeout(timeoutId);
            return response.text();
          })
          .then((responseBody) => {
            const truncated =
              responseBody.length > BODY_LIMIT
                ? responseBody.slice(0, BODY_LIMIT) +
                  "\n[truncated — response exceeded 512 KB]"
                : responseBody;

            const storedRequests = requests[tabId] || [];
            const requestIndex = storedRequests.findIndex(
              (r) => r.requestId === requestId
            );
            if (requestIndex !== -1) {
              storedRequests[requestIndex].responseBody = truncated;
              chrome.storage.local.set({ lotusRequests: requests });
              if (ports[tabId]) {
                ports[tabId].postMessage({
                  type: "UPDATE",
                  data: storedRequests[requestIndex],
                });
              }
            }
          })
          .catch((err) => {
            clearTimeout(timeoutId);
            log("Failed to capture response body", err);
          });
      }
    } catch (err) {
      log("Error attempting to capture response body", err);
    }

    if (!requests[tabId]) requests[tabId] = [];
    if (requests[tabId].length >= MAX_REQUESTS_PER_TAB) {
      requests[tabId] = requests[tabId].slice(-MAX_REQUESTS_PER_TAB + 1);
    }
    requests[tabId].push(request);
    chrome.storage.local.set({ lotusRequests: requests });

    if (ports[tabId]) {
      ports[tabId].postMessage({ type: "NEW", data: request });
    }

    delete requestDetails[requestId];
  },
  { urls: ["<all_urls>"] }
);

// Handle panel connections
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
  });
});
