// filepath: c:\Users\trist\GitHub\Lotus\panel.js
import {
  safeParseJSON,
  toHeaderObject,
  formatRequestBody,
} from "./lib/utils.js";

// DOM Elements
const requestsContainer = document.getElementById("requests");
const filterInput = document.getElementById("filter");
const clearButton = document.getElementById("clear");
const copyCurlButton = document.getElementById("copy-curl");
const modifyResendButton = document.getElementById("modify-resend");

// Modal elements
const modifyModal = document.getElementById("modify-modal");
const modalMethod = document.getElementById("modal-method");
const modalUrl = document.getElementById("modal-url");
const modalHeaders = document.getElementById("modal-headers");
const modalBody = document.getElementById("modal-body");
const modalCancel = document.getElementById("modal-cancel");
const modalSend = document.getElementById("modal-send");
const closeModalBtn = document.querySelector(".close-modal");

// Request details elements
const reqMethod = document.getElementById("req-method");
const reqUrl = document.getElementById("req-url");
const reqHeadersPre = document.querySelector("#req-headers pre");
const reqBodyPre = document.querySelector("#req-body pre");

// Response details elements
const respStatus = document.getElementById("resp-status");
const respHeadersPre = document.querySelector("#resp-headers pre");
const respBodyPre = document.querySelector("#resp-body pre");

// Tab switching
const tabs = document.querySelectorAll(".tab");
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    // Deactivate all tabs in the same group
    const siblingTabs = tab.parentElement.querySelectorAll(".tab");
    siblingTabs.forEach((t) => t.classList.remove("active"));

    // Deactivate all panes
    const container = tab.closest(".request-panel, .response-panel");
    const panes = container.querySelectorAll(".tab-pane");
    panes.forEach((p) => p.classList.remove("active"));

    // Activate the clicked tab and its target pane
    tab.classList.add("active");
    const targetId = tab.dataset.target;
    document.getElementById(targetId).classList.add("active");
  });
});

// State
let currentTabId = String(chrome.devtools.inspectedWindow.tabId);
let requests = [];
let selectedRequestId = null;
let port = null;
let connectionHealthy = true;
let heartbeatInterval = null;

// Transform a raw request from the background script to the display format
function transformRequest(req, index) {
  return {
    ...req,
    id: req.requestId || `req-${index}`,
    statusCode: req.status,
    requestHeaders: toHeaderObject(req.requestHeaders),
    responseHeaders: toHeaderObject(req.responseHeaders),
    time: new Date(req.timestamp).getTime(),
  };
}

// Connect to background script
function connectToBackgroundScript() {
  try {
    // Clear any existing connection
    if (port) {
      try {
        port.disconnect();
      } catch (e) {
        console.log("Error disconnecting old port:", e);
      }
    }

    // Clear any existing heartbeat interval
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }

    // Create new connection
    port = chrome.runtime.connect({ name: `lotus-${currentTabId}` });

    port.onMessage.addListener((message) => {
      if (!message || !message.type) return;

      if (message.type === "INIT") {
        requests = (message.data || []).map(transformRequest);
        renderRequestsList();
      } else if (message.type === "NEW") {
        const newRequest = transformRequest(message.data);
        requests.push(newRequest);
        renderRequestsList();
      } else if (message.type === "UPDATE") {
        // Handle response body updates
        const updatedRequest = transformRequest(message.data);
        const index = requests.findIndex((r) => r.id === updatedRequest.id);
        if (index !== -1) {
          requests[index] = updatedRequest;

          // If this request is currently selected, update the details view
          if (selectedRequestId === updatedRequest.id) {
            selectRequest(selectedRequestId);
          }
        }
      } else if (message.type === "HEARTBEAT_ACK") {
        connectionHealthy = true;
      }
    });

    port.onDisconnect.addListener(() => {
      connectionHealthy = false;
      console.log(
        "Disconnected from background script. Attempting to reconnect..."
      );

      // Attempt to reconnect after a delay
      setTimeout(connectToBackgroundScript, 1000);
    });

    // Start heartbeat to check connection health
    heartbeatInterval = setInterval(() => {
      if (port) {
        try {
          // Set connection health to false, will be set to true on acknowledgement
          connectionHealthy = false;
          port.postMessage({ type: "HEARTBEAT" });

          // If no ack received within 5 seconds, attempt reconnection
          setTimeout(() => {
            if (!connectionHealthy) {
              console.log("No heartbeat response, reconnecting...");
              connectToBackgroundScript();
            }
          }, 5000);
        } catch (e) {
          console.log("Error sending heartbeat:", e);
          connectToBackgroundScript();
        }
      }
    }, 30000); // Check every 30 seconds
  } catch (e) {
    console.error("Error connecting to background script:", e);
    setTimeout(connectToBackgroundScript, 2000);
  }
}

// Initialize connection
connectToBackgroundScript();

// Get status class for styling
function getStatusClass(status) {
  if (!status) return "";
  if (status >= 200 && status < 300) return "status-2xx";
  if (status >= 300 && status < 400) return "status-3xx";
  if (status >= 400 && status < 500) return "status-4xx";
  if (status >= 500) return "status-5xx";
  return "";
}

// Render the requests list
function renderRequestsList() {
  const filter = filterInput.value.trim().toLowerCase();
  requestsContainer.innerHTML = "";

  // Sort requests by time (newest first)
  const sortedRequests = [...requests].sort((a, b) => b.time - a.time);

  for (const request of sortedRequests) {
    // Apply filter if any
    if (
      filter &&
      !request.url.toLowerCase().includes(filter) &&
      !request.method.toLowerCase().includes(filter)
    ) {
      continue;
    }

    const requestElement = document.createElement("div");
    requestElement.classList.add("request-item");
    requestElement.dataset.id = request.id;

    if (selectedRequestId === request.id) {
      requestElement.classList.add("selected");
    }

    // Format URL (just the path)
    let urlDisplay;
    try {
      const url = new URL(request.url);
      urlDisplay = url.pathname + url.search;
    } catch {
      urlDisplay = request.url;
    }

    // Format timestamp
    const time = new Date(request.time).toLocaleTimeString();

    requestElement.innerHTML = `
      <div class="request-url">${urlDisplay}</div>
      <div class="request-meta">
        <span class="method">${request.method}</span>
        <span class="time">${time}</span>
        <span class="status ${getStatusClass(request.statusCode)}">${
      request.statusCode || "-"
    }</span>
      </div>
    `;

    requestElement.addEventListener("click", () => {
      selectRequest(request.id);
    });

    requestsContainer.appendChild(requestElement);
  }
}

// Select a request and display its details
function selectRequest(requestId) {
  selectedRequestId = requestId;

  // Update selected item in the list
  const items = requestsContainer.querySelectorAll(".request-item");
  items.forEach((item) => {
    item.classList.toggle("selected", item.dataset.id === requestId);
  });

  const request = requests.find((req) => req.id === requestId);
  if (!request) return;

  // Update request details
  reqMethod.textContent = request.method || "-";
  reqUrl.textContent = request.url || "-";

  // Store original content for raw/pretty toggle
  originalContent.reqHeaders = request.requestHeaders || {};
  originalContent.reqBody = formatRequestBody(request.requestBody);
  originalContent.respHeaders = request.responseHeaders || {};

  if (request.responseBody) {
    originalContent.respBody = request.responseBody;
  } else {
    originalContent.respBody = "Response body not available";
  }

  // Ensure all pre elements exist before continuing
  if (!reqHeadersPre || !reqBodyPre || !respHeadersPre || !respBodyPre) {
    console.error("Missing pre elements for display");
    return;
  }

  // Always display basic content to avoid blank panels
  reqHeadersPre.textContent = JSON.stringify(
    request.requestHeaders || {},
    null,
    2
  );
  reqBodyPre.textContent = formatRequestBody(request.requestBody);
  respHeadersPre.textContent = JSON.stringify(
    request.responseHeaders || {},
    null,
    2
  );
  respBodyPre.textContent =
    request.responseBody || "Response body not available";

  // Then attempt to apply formatting based on current state
  try {
    // Display formatted or raw content based on current toggle state
    if (requestFormattingState.req) {
      // Pretty format for request
      prettifyContent("reqHeaders", originalContent.reqHeaders);
      prettifyContent("reqBody", originalContent.reqBody);
    } else {
      // Raw format for request
      showRawContent("reqHeaders", originalContent.reqHeaders);
      showRawContent("reqBody", originalContent.reqBody);
    }

    // Response status
    const statusText = request.statusText
      ? `${request.statusCode} ${request.statusText}`
      : request.statusCode || "-";
    respStatus.textContent = statusText;
    respStatus.className = `status ${getStatusClass(request.statusCode)}`;

    // Display formatted or raw content based on current toggle state
    if (requestFormattingState.resp) {
      // Pretty format for response
      prettifyContent("respHeaders", originalContent.respHeaders);
      prettifyContent("respBody", originalContent.respBody);
    } else {
      // Raw format for response
      showRawContent("respHeaders", originalContent.respHeaders);
      showRawContent("respBody", originalContent.respBody);
    }
  } catch (error) {
    console.error("Error formatting request/response:", error);
  }
}

// Filter functionality
filterInput.addEventListener("input", renderRequestsList);

// Clear functionality
clearButton.addEventListener("click", () => {
  if (confirm("Clear all captured requests?")) {
    if (port) {
      port.postMessage({ type: "CLEAR" });
      requests = [];
      renderRequestsList();

      // Clear details panel
      reqMethod.textContent = "-";
      reqUrl.textContent = "-";
      reqHeadersPre.textContent = "";
      reqBodyPre.textContent = "";
      respStatus.textContent = "-";
      respHeadersPre.textContent = "";
      respBodyPre.textContent = "";

      selectedRequestId = null;
    }
  }
});

// Copy as cURL functionality
copyCurlButton.addEventListener("click", () => {
  const request = requests.find((req) => req.id === selectedRequestId);
  if (!request) {
    alert("No request selected");
    return;
  }

  const method = request.method || "GET";
  const url = request.url;
  const headers = request.requestHeaders || {};
  const body = formatRequestBody(request.requestBody);

  let curl = `curl -X ${method} "${url}"`;

  // Add headers
  for (const [key, value] of Object.entries(headers)) {
    // Escape quotes in header value
    const escapedValue = value.replace(/"/g, '\\"');
    curl += ` \\\n  -H "${key}: ${escapedValue}"`;
  }

  // Add body if not GET/HEAD
  if (body && !["GET", "HEAD"].includes(method.toUpperCase())) {
    // Escape quotes in body
    const escapedBody = body.replace(/"/g, '\\"');
    curl += ` \\\n  -d "${escapedBody}"`;
  }

  // Use a more reliable clipboard approach for Chrome extensions
  const textarea = document.createElement("textarea");
  textarea.value = curl;
  textarea.style.position = "fixed"; // Prevent scrolling to bottom
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const successful = document.execCommand("copy");
    if (successful) {
      alert("Copied cURL command to clipboard");
    } else {
      throw new Error("Copy command failed");
    }
  } catch (err) {
    console.error("Failed to copy cURL command", err);
    alert("Failed to copy cURL command. Please try again.");
  } finally {
    document.body.removeChild(textarea);
  }
});

// Modify & Resend functionality
modifyResendButton.addEventListener("click", () => {
  const request = requests.find((req) => req.id === selectedRequestId);
  if (!request) {
    alert("No request selected");
    return;
  }

  // Populate modal with request data
  modalMethod.value = request.method || "GET";
  modalUrl.value = request.url || "";

  // Format headers as JSON
  modalHeaders.value = JSON.stringify(request.requestHeaders || {}, null, 2);

  // Populate body
  const body = formatRequestBody(request.requestBody);
  modalBody.value = body;

  // Show modal
  modifyModal.style.display = "block";
});

// Close modal when clicking the close button
closeModalBtn.addEventListener("click", () => {
  modifyModal.style.display = "none";
});

// Close modal when clicking cancel
modalCancel.addEventListener("click", () => {
  modifyModal.style.display = "none";
});

// Close modal when clicking outside of it
window.addEventListener("click", (event) => {
  if (event.target === modifyModal) {
    modifyModal.style.display = "none";
  }
});

// Send modified request
modalSend.addEventListener("click", async () => {
  // Get values from modal
  const method = modalMethod.value;
  const url = modalUrl.value;

  let headers = {};
  try {
    headers = JSON.parse(modalHeaders.value);
  } catch (e) {
    alert("Invalid JSON in headers field");
    return;
  }

  const body = modalBody.value;

  // Create fetch options
  const options = {
    method,
    headers,
    credentials: "include",
  };

  // Add body for non-GET/HEAD requests
  if (body && !["GET", "HEAD"].includes(method.toUpperCase())) {
    options.body = body;
  }

  try {
    // Execute the request
    const response = await fetch(url, options);

    // Get response data
    const responseText = await response.text();

    // Format response body for display
    let formattedBody = responseText;
    try {
      if (response.headers.get("content-type")?.includes("json")) {
        formattedBody = JSON.stringify(JSON.parse(responseText), null, 2);
      }
    } catch {}

    // Create a new request object to add to the UI
    const newRequest = {
      id: `modified-${Date.now()}`,
      url,
      method,
      statusCode: response.status,
      statusText: response.statusText,
      requestHeaders: headers,
      requestBody: body,
      responseHeaders: Object.fromEntries([...response.headers.entries()]),
      responseBody: formattedBody,
      time: new Date().getTime(),
      timestamp: new Date().toISOString(),
    };

    // Add to requests list and select it
    requests.unshift(newRequest);
    renderRequestsList();
    selectRequest(newRequest.id);

    // Close modal
    modifyModal.style.display = "none";
  } catch (error) {
    alert(`Error sending request: ${error.message}`);
  }
});

// Theme and formatting state
let isLightMode = false;
let requestFormattingState = {
  req: true, // true = pretty, false = raw
  resp: true, // true = pretty, false = raw
};

// Original content storage for raw mode
let originalContent = {
  reqHeaders: "",
  reqBody: "",
  respHeaders: "",
  respBody: "",
};

// Theme toggle functionality
const themeToggle = document.getElementById("theme-toggle");
themeToggle.addEventListener("click", () => {
  isLightMode = !isLightMode;
  document.body.classList.toggle("light-mode", isLightMode);

  // Update button text based on current mode
  themeToggle.textContent = isLightMode ? "Dark Mode" : "Light Mode";

  // Save preference to localStorage
  localStorage.setItem("lotus-theme", isLightMode ? "light" : "dark");
});

// Load saved theme preference
if (localStorage.getItem("lotus-theme") === "light") {
  isLightMode = true;
  document.body.classList.add("light-mode");
  themeToggle.textContent = "Dark Mode"; // Update initial button text
} else {
  themeToggle.textContent = "Light Mode";
}

// Format toggle functionality
const formatToggles = document.querySelectorAll(".format-toggle");
formatToggles.forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const target = toggle.dataset.target;
    requestFormattingState[target] = !requestFormattingState[target];

    // Update button text
    toggle.textContent = requestFormattingState[target] ? "Pretty" : "Raw";
    toggle.classList.toggle("active", requestFormattingState[target]);

    // If we have a selected request, update the display
    if (selectedRequestId) {
      toggleFormatting(target);
    }
  });
});

// Toggle between raw and pretty formatting
function toggleFormatting(target) {
  if (target === "req") {
    if (requestFormattingState.req) {
      // Pretty format
      prettifyContent("reqHeaders", originalContent.reqHeaders);
      prettifyContent("reqBody", originalContent.reqBody);
    } else {
      // Raw format
      showRawContent("reqHeaders", originalContent.reqHeaders);
      showRawContent("reqBody", originalContent.reqBody);
    }
  } else if (target === "resp") {
    if (requestFormattingState.resp) {
      // Pretty format
      prettifyContent("respHeaders", originalContent.respHeaders);
      prettifyContent("respBody", originalContent.respBody);
    } else {
      // Raw format
      showRawContent("respHeaders", originalContent.respHeaders);
      showRawContent("respBody", originalContent.respBody);
    }
  }
}

// Format content to look pretty
function prettifyContent(targetId, content) {
  const preElement = document.querySelector(`#${targetId} pre`);
  if (!preElement) return;

  try {
    if (targetId.includes("Headers")) {
      // For headers, try to parse as JSON and format
      const obj = typeof content === "object" ? content : JSON.parse(content);
      preElement.textContent = JSON.stringify(obj, null, 2);
    } else if (targetId.includes("Body")) {
      // For body, try to detect JSON and format
      try {
        if (typeof content === "string" && content.trim() === "") {
          preElement.textContent = "";
          return;
        }

        const obj = typeof content === "object" ? content : JSON.parse(content);
        preElement.textContent = JSON.stringify(obj, null, 2);
      } catch (e) {
        // Not valid JSON, just show the content
        preElement.textContent = content;
      }
    }
  } catch (e) {
    // Fallback if formatting fails
    preElement.textContent =
      typeof content === "string" ? content : JSON.stringify(content, null, 2);
  }
}

// Show raw unformatted content
function showRawContent(targetId, content) {
  const preElement = document.querySelector(`#${targetId} pre`);
  if (!preElement) return;

  if (targetId.includes("Headers")) {
    // For headers, convert to plain text
    if (typeof content === "object") {
      const headerText = Object.entries(content)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n");
      preElement.textContent = headerText;
    } else {
      preElement.textContent = content;
    }
  } else {
    // For body, just show raw text
    preElement.textContent =
      typeof content === "string" ? content : JSON.stringify(content);
  }

  // Remove syntax highlighting if any
  if (preElement.className) {
    preElement.className = "";
  }
}
