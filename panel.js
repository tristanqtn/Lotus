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
const deleteRequestButton = document.getElementById("delete-request");
const groupRelatedToggle = document.getElementById("group-related");

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
  // Ensure we have a valid ID that's consistent across the object
  const id = req.requestId || `req-${index}`;
  
  return {
    ...req,
    id: id,
    statusCode: req.status,
    requestHeaders: toHeaderObject(req.requestHeaders),
    responseHeaders: toHeaderObject(req.responseHeaders),
    time: new Date(req.timestamp || Date.now()).getTime(),
    // Add source tracking (default to 'page' for requests from the web page)
    source: req.source || "page",
    // Add parent ID for tracking relationships between requests
    parentId: req.parentId || null,
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
  
  // Create a map of requests that have modified versions
  const requestsWithModifiedVersions = new Set();
  const requestsWithParents = new Set();
  
  // Track which requests have modifications and which are modifications
  for (const request of sortedRequests) {
    if (request.source === "modified" && request.parentId) {
      requestsWithModifiedVersions.add(request.parentId);
      requestsWithParents.add(request.id);
    }
  }
  for (const request of sortedRequests) {
    // Skip child requests when groupByRelated is enabled (they'll be shown under parents)
    if (groupRelatedRequests && request.source === "modified" && request.parentId) {
      continue; // Skip modified requests, they'll be displayed under their parents
    }
    
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

    // Add appropriate class based on source
    if (request.source === "modified") {
      requestElement.classList.add("modified-request");
    } else if (requestsWithModifiedVersions.has(request.id)) {
      requestElement.classList.add("has-modified-versions");
    }

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
      // Prepare source indicator
    let sourceIndicator = '';
    if (request.source === "modified") {
      let title = "Modified request";
      if (request.originalDeleted) {
        title = "Modified request (original deleted)";
      }
      sourceIndicator = `<span class="source-indicator modified-indicator" title="${title}">M</span>`;
    } else if (requestsWithModifiedVersions.has(request.id)) {
      sourceIndicator = '<span class="source-indicator original-with-mods-indicator" title="Has modified versions">+</span>';
    }

    requestElement.innerHTML = `
      <div class="request-url">${urlDisplay}</div>
      <div class="request-meta">
        ${sourceIndicator}
        <span class="method">${request.method}</span>
        <span class="time">${time}</span>
        <span class="status ${getStatusClass(request.statusCode)}">${
      request.statusCode || "-"
    }</span>
      </div>
    `;    requestElement.addEventListener("click", () => {
      selectRequest(request.id);
    });

    requestsContainer.appendChild(requestElement);
      // If grouping is enabled and this request has modified versions, add them below
    if (groupRelatedRequests && requestsWithModifiedVersions.has(request.id)) {
      const modifiedVersions = sortedRequests.filter(req => req.parentId === request.id && req.source === "modified");
      
      if (modifiedVersions.length > 0) {
        try {
          // Create a container for child requests
          const childContainer = document.createElement("div");
          childContainer.classList.add("child-requests-container");
          
          for (const childRequest of modifiedVersions) {
            const childElement = document.createElement("div");
            childElement.classList.add("request-item", "child-request-item", "modified-request");
            childElement.dataset.id = childRequest.id;
            
            if (selectedRequestId === childRequest.id) {
              childElement.classList.add("selected");
            }
            
            // Format URL (just the path)
            let childUrlDisplay;
            try {
              const url = new URL(childRequest.url);
              childUrlDisplay = url.pathname + url.search;
            } catch {
              childUrlDisplay = childRequest.url;
            }
            
            // Format timestamp
            const childTime = new Date(childRequest.time || Date.now()).toLocaleTimeString();
            
            childElement.innerHTML = `
              <div class="request-url">${childUrlDisplay}</div>
              <div class="request-meta">
                <span class="source-indicator modified-indicator" title="Modified request">M</span>
                <span class="method">${childRequest.method}</span>
                <span class="time">${childTime}</span>
                <span class="status ${getStatusClass(childRequest.statusCode)}">${
                  childRequest.statusCode || "-"
                }</span>
              </div>
            `;
            
            childElement.addEventListener("click", (e) => {
              e.stopPropagation(); // Prevent event bubbling
              selectRequest(childRequest.id);
            });
            
            childContainer.appendChild(childElement);
          }
          
          requestsContainer.appendChild(childContainer);
        } catch (error) {
          console.error("Error rendering child requests:", error);
        }
      }
    }
  }
}

// Select a request and display its details
function selectRequest(requestId) {
  selectedRequestId = requestId;

  // Update selected item in the list
  const items = document.querySelectorAll(".request-item");
  items.forEach((item) => {
    item.classList.toggle("selected", item.dataset.id === requestId);
  });

  const request = requests.find((req) => req.id === requestId);
  if (!request) return;
  
  // Check for related requests
  const isModified = request.source === "modified";
  const parentRequest = request.parentId ? requests.find(req => req.id === request.parentId) : null;
  const modifiedVersions = requests.filter(req => req.parentId === request.id && req.source === "modified");
  // Update request details
  reqMethod.textContent = request.method || "-";
  reqUrl.textContent = request.url || "-";
    // Display relationship info if applicable
  const requestPanel = document.querySelector(".request-panel");
  // Remove any existing relationship info
  const existingRelInfo = requestPanel.querySelector(".relationship-info");
  if (existingRelInfo) {
    existingRelInfo.remove();
  }
    try {
    if (isModified) {
      const relInfo = document.createElement("div");
      relInfo.classList.add("relationship-info");
      
      if (parentRequest) {
        relInfo.innerHTML = `
          <span>Modified from original request:</span>
          <a class="parent-link" data-id="${request.parentId}" title="View original request">View original</a>
        `;
      } else if (request.parentId) {
        // Parent exists in the ID but not in the actual requests (was deleted)
        relInfo.innerHTML = `
          <span>Modified from original request:</span>
          <span class="deleted-parent" title="Original request was deleted">Original deleted</span>
        `;
      }
      
      const tabsElement = requestPanel.querySelector(".tabs");
      if (tabsElement) {
        requestPanel.insertBefore(relInfo, tabsElement);
        
        // Add click handler for parent link if parent exists
        const parentLink = relInfo.querySelector(".parent-link");
        if (parentLink) {
          parentLink.addEventListener("click", (e) => {
            selectRequest(e.target.dataset.id);
          });
        }
      }
    } else if (modifiedVersions.length > 0) {
      const relInfo = document.createElement("div");
      relInfo.classList.add("relationship-info");
      
      const links = modifiedVersions.map((mod, index) => 
        `<a class="child-link" data-id="${mod.id}" title="View modified version ${index + 1}">Version ${index + 1}</a>`
      ).join(", ");
      
      relInfo.innerHTML = `
        <span>Has ${modifiedVersions.length} modified version${modifiedVersions.length > 1 ? 's' : ''}:</span>
        ${links}
      `;
      
      const tabsElement = requestPanel.querySelector(".tabs");
      if (tabsElement) {
        requestPanel.insertBefore(relInfo, tabsElement);
        
        // Add click handlers for child links
        relInfo.querySelectorAll(".child-link").forEach(link => {
          link.addEventListener("click", (e) => {
            selectRequest(e.target.dataset.id);
          });
        });
      }
    }
  } catch (error) {
    console.error("Error displaying relationship info:", error);
  }
  
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

// Delete Request functionality
deleteRequestButton.addEventListener("click", () => {
  const request = requests.find((req) => req.id === selectedRequestId);
  if (!request) {
    alert("No request selected");
    return;
  }
  if (confirm(`Are you sure you want to delete this ${request.method} request to ${request.url}?`)) {
    // Track which request IDs should be deleted
    const requestsToDelete = new Set([request.id]);
    
    // Check if the request is a parent request with modified versions
    const modifiedVersions = requests.filter(req => req.parentId === request.id);
    
    if (modifiedVersions.length > 0 && request.source === "page") {
      const deleteChildren = confirm(`This request has ${modifiedVersions.length} modified version(s). Delete those as well?`);
      
      if (deleteChildren) {
        // Add child IDs to the delete set
        modifiedVersions.forEach(modReq => {
          requestsToDelete.add(modReq.id);
        });
      } else {
        // Keep modified versions but mark them as orphaned
        modifiedVersions.forEach(modReq => {
          modReq.originalDeleted = true;
        });
      }
    }
    
    // If this is a modified request, update the parent's status if needed
    if (request.source === "modified" && request.parentId) {
      const parent = requests.find(req => req.id === request.parentId);
      if (parent) {
        // Check if there are other modified versions of the parent
        const otherModifications = requests.filter(req => 
          req.parentId === request.parentId && req.id !== request.id
        );
        
        // If this was the last modified version, update the parent
        if (otherModifications.length === 0) {
          // No need to mark the parent in any way - the rendering code will detect this
        }
      }
    }
    
    // Remove only the requests that should be deleted
    requests = requests.filter(req => !requestsToDelete.has(req.id));
    
    // If the selected request is being deleted, clear the selection
    if (selectedRequestId === request.id) {
      selectedRequestId = null;
      
      // Clear details panel
      reqMethod.textContent = "-";
      reqUrl.textContent = "-";
      reqHeadersPre.textContent = "";
      reqBodyPre.textContent = "";
      respStatus.textContent = "-";
      respHeadersPre.textContent = "";
      respBodyPre.textContent = "";
      
      // Remove any relationship info
      const requestPanel = document.querySelector(".request-panel");
      const existingRelInfo = requestPanel?.querySelector(".relationship-info");
      if (existingRelInfo) {
        existingRelInfo.remove();
      }
    }
    
    // Re-render the requests list
    renderRequestsList();
  }
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
    } catch {}    // Create a new request object to add to the UI
    const timestamp = Date.now();
    const newRequestId = `modified-${timestamp}`;
    const newRequest = {
      requestId: newRequestId, // Set requestId for proper tracking
      id: newRequestId,
      url,
      method,
      statusCode: response.status,
      statusText: response.statusText,
      requestHeaders: headers,
      requestBody: body,
      responseHeaders: Object.fromEntries([...response.headers.entries()]),
      responseBody: formattedBody,
      time: timestamp,
      timestamp: new Date(timestamp).toISOString(),
      // Mark as modified and track original request
      source: "modified",
      parentId: selectedRequestId,
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
let groupRelatedRequests = false;
let requestFormattingState = {
  req: true, // true = pretty, false = raw
  resp: true, // true = pretty, false = raw
};

// Format type state (json, xml, html, js, css)
let requestFormatType = {
  req: "json",
  resp: "json",
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

// Group Related toggle functionality
if (groupRelatedToggle) {
  groupRelatedToggle.addEventListener("click", () => {
    groupRelatedRequests = !groupRelatedRequests;
    
    // Update button appearance
    if (groupRelatedRequests) {
      groupRelatedToggle.classList.add("active");
      groupRelatedToggle.textContent = "Ungroup Related";
    } else {
      groupRelatedToggle.classList.remove("active");
      groupRelatedToggle.textContent = "Group Related";
    }
    
    // Save preference to localStorage
    localStorage.setItem("lotus-group-related", groupRelatedRequests ? "true" : "false");
    
    // Re-render requests list
    renderRequestsList();
  });
  
  // Load saved grouping preference
  if (localStorage.getItem("lotus-group-related") === "true") {
    groupRelatedRequests = true;
    groupRelatedToggle.classList.add("active");
    groupRelatedToggle.textContent = "Ungroup Related";
  }
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

// Format type dropdown functionality
const formatTypeButtons = document.querySelectorAll(".format-type-button");
const formatOptions = document.querySelectorAll(".format-option");

// Load saved format type preferences
const savedReqFormat = localStorage.getItem("lotus-req-format-type");
const savedRespFormat = localStorage.getItem("lotus-resp-format-type");

if (savedReqFormat) {
  requestFormatType.req = savedReqFormat;
}
if (savedRespFormat) {
  requestFormatType.resp = savedRespFormat;
}

// Initialize format type buttons text
formatTypeButtons.forEach((button) => {
  const target = button.dataset.target;
  button.textContent = `Format: ${requestFormatType[target].toUpperCase()}`;
});

// Add click handlers for format options
formatOptions.forEach((option) => {
  option.addEventListener("click", () => {
    const target = option.dataset.target;
    const format = option.dataset.format;

    // Update format type state
    requestFormatType[target] = format;

    // Update button text
    const button = document.querySelector(
      `.format-type-button[data-target="${target}"]`
    );
    button.textContent = `Format: ${format.toUpperCase()}`;

    // Save preference to localStorage
    localStorage.setItem(`lotus-${target}-format-type`, format);

    // Apply formatting if in pretty mode
    if (requestFormattingState[target] && selectedRequestId) {
      toggleFormatting(target);
    }
  });
});

// Toggle between raw and pretty formatting with format type support
function toggleFormatting(target) {
  if (target === "req") {
    if (requestFormattingState.req) {
      // Pretty format with selected format type
      prettifyContent("reqHeaders", originalContent.reqHeaders);
      prettifyContent("reqBody", originalContent.reqBody);
    } else {
      // Raw format
      showRawContent("reqHeaders", originalContent.reqHeaders);
      showRawContent("reqBody", originalContent.reqBody);
    }
  } else if (target === "resp") {
    if (requestFormattingState.resp) {
      // Pretty format with selected format type
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

  // Get the target type (req or resp)
  const targetType = targetId.startsWith("req") ? "req" : "resp";
  const formatType = requestFormatType[targetType];

  try {
    if (targetId.includes("Headers")) {
      // For headers, always format as JSON
      const obj = typeof content === "object" ? content : JSON.parse(content);
      preElement.textContent = JSON.stringify(obj, null, 2);
    } else if (targetId.includes("Body")) {
      // For body, use the selected format type
      if (typeof content === "string" && content.trim() === "") {
        preElement.textContent = "";
        return;
      }

      // Remove any previous syntax highlighting classes
      preElement.className = "";

      switch (formatType) {
        case "json":
          try {
            const obj =
              typeof content === "object" ? content : JSON.parse(content);
            preElement.textContent = JSON.stringify(obj, null, 2);
            preElement.classList.add("language-json");
          } catch (e) {
            // Not valid JSON, show as text
            preElement.textContent = content;
          }
          break;

        case "xml":
          try {
            // Simple XML formatting with indentation
            if (typeof content === "string" && content.includes("<")) {
              // Basic XML pretty printing
              preElement.textContent = formatXML(content);
              preElement.classList.add("language-xml");
            } else {
              preElement.textContent = content;
            }
          } catch (e) {
            preElement.textContent = content;
          }
          break;

        case "html":
          try {
            // Simple HTML formatting
            if (typeof content === "string" && content.includes("<")) {
              preElement.textContent = formatXML(content); // HTML can use the same formatter
              preElement.classList.add("language-html");
            } else {
              preElement.textContent = content;
            }
          } catch (e) {
            preElement.textContent = content;
          }
          break;

        case "js":
          try {
            // For JavaScript, we attempt to format it
            if (typeof content === "string") {
              // Try to evaluate and format as an object if it's valid JS
              try {
                // This is unsafe but it's just for formatting display
                const obj = new Function(`return ${content}`)();
                preElement.textContent =
                  typeof obj === "object"
                    ? JSON.stringify(obj, null, 2)
                    : content;
              } catch (e) {
                // Just display as is if we can't format it
                preElement.textContent = content;
              }
              preElement.classList.add("language-javascript");
            } else {
              preElement.textContent = JSON.stringify(content, null, 2);
            }
          } catch (e) {
            preElement.textContent = content;
          }
          break;

        case "css":
          try {
            // Simple CSS formatting
            if (typeof content === "string" && content.includes("{")) {
              // Basic CSS formatting
              preElement.textContent = formatCSS(content);
              preElement.classList.add("language-css");
            } else {
              preElement.textContent = content;
            }
          } catch (e) {
            preElement.textContent = content;
          }
          break;

        default:
          // Default to displaying as is
          preElement.textContent =
            typeof content === "string" ? content : JSON.stringify(content);
      }
    }
  } catch (e) {
    // Fallback if formatting fails
    preElement.textContent =
      typeof content === "string" ? content : JSON.stringify(content, null, 2);
  }
}

// Format XML/HTML with indentation
function formatXML(xml) {
  let formatted = "";
  let indent = "";
  const tab = "  "; // 2 spaces

  xml = xml.trim().replace(/(>)(<)(\/*)/g, "$1\n$2$3");
  xml.split(/\n/).forEach((line) => {
    if (line.match(/^<\/\w/)) {
      // If this line is a closing tag, decrease indent
      indent = indent.substring(tab.length);
    }

    formatted += indent + line + "\n";

    if (line.match(/^<\w[^>]*[^\/]>.*$/)) {
      // If this line is an opening tag, increase indent
      indent += tab;
    }
  });

  return formatted.trim();
}

// Simple CSS formatter
function formatCSS(css) {
  // Replace } with }\n to create line breaks
  let formatted = css
    .replace(/\}/g, "}\n")
    .replace(/\{/g, " {\n  ")
    .replace(/\;/g, ";\n  ")
    .replace(/\n  \}/g, "\n}")
    .replace(/\,[\r\n\s]+/g, ", ");

  // Remove multiple line breaks
  formatted = formatted.replace(/\n\s*\n/g, "\n");

  return formatted;
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
