// Storage for all captured requests, organized by tab
let requests = {};
// Active panel connections
let ports = {};
// Temporary storage for request details being assembled
let requestDetails = {};
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

// Capture request headers and body
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const requestId = details.requestId;

    if (!requestDetails[requestId]) {
      requestDetails[requestId] = {};
    }
    requestDetails[requestId].requestBody = details.requestBody;
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const requestId = details.requestId;

    if (!requestDetails[requestId]) {
      requestDetails[requestId] = {};
    }
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

    if (!requestDetails[requestId]) {
      requestDetails[requestId] = {};
    }
    requestDetails[requestId].responseHeaders = details.responseHeaders;
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Capture completed requests
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const tabId = String(details.tabId);
    const requestId = details.requestId;

    // Get the stored request details
    const reqDetails = requestDetails[requestId] || {};

    // Create a complete request object
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
    }; // Try to capture response body using fetch()
    // This is a best-effort approach, may not work for all responses
    try {
      // Only attempt for certain content types and successful responses
      const contentTypeHeader = reqDetails.responseHeaders?.find(
        (h) => h.name.toLowerCase() === "content-type"
      );

      // Check if it's a text-based content type we should try to capture
      const shouldCaptureBody =
        contentTypeHeader &&
        (contentTypeHeader.value.includes("json") ||
          contentTypeHeader.value.includes("text") ||
          contentTypeHeader.value.includes("xml") ||
          contentTypeHeader.value.includes("javascript") ||
          contentTypeHeader.value.includes("html")) &&
        details.statusCode >= 200 &&
        details.statusCode < 300;

      if (shouldCaptureBody) {
        // We'll use fetch to try to get the response body
        // This is an async operation that will update the request later
        fetch(details.url, {
          method: details.method,
          headers:
            reqDetails.requestHeaders?.reduce((obj, h) => {
              obj[h.name] = h.value;
              return obj;
            }, {}) || {},
          body: reqDetails.requestBody
            ? JSON.stringify(reqDetails.requestBody)
            : undefined,
          credentials: "include",
        })
          .then((response) => response.text())
          .then((responseBody) => {
            // Find the request in storage and update it
            const storedRequests = requests[tabId] || [];
            const requestIndex = storedRequests.findIndex(
              (r) => r.requestId === requestId
            );

            if (requestIndex !== -1) {
              storedRequests[requestIndex].responseBody = responseBody;

              // Save to storage
              chrome.storage.local.set({ lotusRequests: requests });

              // Notify panel if connected
              if (ports[tabId]) {
                ports[tabId].postMessage({
                  type: "UPDATE",
                  data: storedRequests[requestIndex],
                });
              }
            }
          })
          .catch((err) => {
            log("Failed to capture response body", err);
          });
      }
    } catch (err) {
      log("Error attempting to capture response body", err);
    }

    // Store the request
    if (!requests[tabId]) {
      requests[tabId] = [];
    }

    // Limit the number of stored requests per tab
    if (requests[tabId].length >= MAX_REQUESTS_PER_TAB) {
      requests[tabId] = requests[tabId].slice(-MAX_REQUESTS_PER_TAB + 1);
    }

    requests[tabId].push(request);

    // Save to persistent storage
    chrome.storage.local.set({ lotusRequests: requests });

    // Send to panel if connected
    if (ports[tabId]) {
      ports[tabId].postMessage({ type: "NEW", data: request });
    }

    // Clean up to avoid memory leaks
    delete requestDetails[requestId];
  },
  { urls: ["<all_urls>"] }
);

// Handle panel connections
chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith("lotus-")) return;

  const tabId = port.name.split("-")[1];
  ports[tabId] = port;
  log("Panel connected", tabId);

  // Send initial data to the panel
  port.postMessage({ type: "INIT", data: requests[tabId] || [] });

  // Listen for messages from the panel
  port.onMessage.addListener((msg) => {
    if (msg.type === "CLEAR") {
      requests[tabId] = [];
      // Update persistent storage
      chrome.storage.local.set({ lotusRequests: requests });
      log("Cleared requests for tab", tabId);
    } else if (msg.type === "HEARTBEAT") {
      // Respond to heartbeat to confirm connection is alive
      port.postMessage({ type: "HEARTBEAT_ACK" });
    }
  });

  port.onDisconnect.addListener(() => {
    delete ports[tabId];
    log("Panel disconnected", tabId);
  });
});
