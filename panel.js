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
    const siblingTabs = tab.parentElement.querySelectorAll(".tab");
    siblingTabs.forEach((t) => t.classList.remove("active"));

    const container = tab.closest(".request-panel, .response-panel");
    const panes = container.querySelectorAll(".tab-pane");
    panes.forEach((p) => p.classList.remove("active"));

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
  const id = req.requestId || `req-${index}`;

  return {
    ...req,
    id: id,
    statusCode: req.status,
    requestHeaders: toHeaderObject(req.requestHeaders),
    responseHeaders: toHeaderObject(req.responseHeaders),
    time: new Date(req.timestamp || Date.now()).getTime(),
    source: req.source || "page",
    parentId: req.parentId || null,
  };
}

// Connect to background script
function connectToBackgroundScript() {
  try {
    if (port) {
      try {
        port.disconnect();
      } catch (e) {
        console.log("Error disconnecting old port:", e);
      }
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
        renderRequestsList();
      } else if (message.type === "NEW") {
        const newRequest = transformRequest(message.data);
        requests.push(newRequest);
        renderRequestsList();
      } else if (message.type === "UPDATE") {
        const updatedRequest = transformRequest(message.data);
        const index = requests.findIndex((r) => r.id === updatedRequest.id);
        if (index !== -1) {
          requests[index] = updatedRequest;
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
      console.log("Disconnected from background script. Attempting to reconnect...");
      setTimeout(connectToBackgroundScript, 1000);
    });

    // Heartbeat to detect stale connections
    heartbeatInterval = setInterval(() => {
      if (!port) return;
      try {
        connectionHealthy = false;
        port.postMessage({ type: "HEARTBEAT" });

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
    }, 30000);
  } catch (e) {
    console.error("Error connecting to background script:", e);
    setTimeout(connectToBackgroundScript, 2000);
  }
}

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

  const sortedRequests = [...requests].sort((a, b) => b.time - a.time);

  const requestsWithModifiedVersions = new Set();

  for (const request of sortedRequests) {
    if (request.source === "modified" && request.parentId) {
      requestsWithModifiedVersions.add(request.parentId);
    }
  }

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

    const requestElement = document.createElement("div");
    requestElement.classList.add("request-item");
    requestElement.dataset.id = request.id;

    if (request.source === "modified") {
      requestElement.classList.add("modified-request");
    } else if (requestsWithModifiedVersions.has(request.id)) {
      requestElement.classList.add("has-modified-versions");
    }

    if (selectedRequestId === request.id) {
      requestElement.classList.add("selected");
    }

    let urlDisplay;
    try {
      const url = new URL(request.url);
      urlDisplay = url.pathname + url.search;
    } catch {
      urlDisplay = request.url;
    }

    const time = new Date(request.time).toLocaleTimeString();

    let sourceIndicator = "";
    if (request.source === "modified") {
      const title = request.originalDeleted
        ? "Modified request (original deleted)"
        : "Modified request";
      sourceIndicator = `<span class="source-indicator modified-indicator" title="${escapeHtml(title)}">M</span>`;
    } else if (requestsWithModifiedVersions.has(request.id)) {
      sourceIndicator = `<span class="source-indicator original-with-mods-indicator" title="Has modified versions">+</span>`;
    }

    requestElement.innerHTML = `
      <div class="request-url">${escapeHtml(urlDisplay)}</div>
      <div class="request-meta">
        ${sourceIndicator}
        <span class="method">${escapeHtml(request.method)}</span>
        <span class="time">${escapeHtml(time)}</span>
        <span class="status ${getStatusClass(request.statusCode)}">${
      request.statusCode || "-"
    }</span>
      </div>
    `;

    requestElement.addEventListener("click", () => {
      selectRequest(request.id);
    });

    requestsContainer.appendChild(requestElement);

    if (groupRelatedRequests && requestsWithModifiedVersions.has(request.id)) {
      const modifiedVersions = sortedRequests.filter(
        (req) => req.parentId === request.id && req.source === "modified"
      );

      if (modifiedVersions.length > 0) {
        try {
          const childContainer = document.createElement("div");
          childContainer.classList.add("child-requests-container");

          for (const childRequest of modifiedVersions) {
            const childElement = document.createElement("div");
            childElement.classList.add(
              "request-item",
              "child-request-item",
              "modified-request"
            );
            childElement.dataset.id = childRequest.id;

            if (selectedRequestId === childRequest.id) {
              childElement.classList.add("selected");
            }

            let childUrlDisplay;
            try {
              const url = new URL(childRequest.url);
              childUrlDisplay = url.pathname + url.search;
            } catch {
              childUrlDisplay = childRequest.url;
            }

            const childTime = new Date(
              childRequest.time || Date.now()
            ).toLocaleTimeString();

            childElement.innerHTML = `
              <div class="request-url">${escapeHtml(childUrlDisplay)}</div>
              <div class="request-meta">
                <span class="source-indicator modified-indicator" title="Modified request">M</span>
                <span class="method">${escapeHtml(childRequest.method)}</span>
                <span class="time">${escapeHtml(childTime)}</span>
                <span class="status ${getStatusClass(childRequest.statusCode)}">${
              childRequest.statusCode || "-"
            }</span>
              </div>
            `;

            childElement.addEventListener("click", (e) => {
              e.stopPropagation();
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

  const items = document.querySelectorAll(".request-item");
  items.forEach((item) => {
    item.classList.toggle("selected", item.dataset.id === requestId);
  });

  const request = requests.find((req) => req.id === requestId);
  if (!request) return;

  const isModified = request.source === "modified";
  const parentRequest = request.parentId
    ? requests.find((req) => req.id === request.parentId)
    : null;
  const modifiedVersions = requests.filter(
    (req) => req.parentId === request.id && req.source === "modified"
  );

  reqMethod.textContent = request.method || "-";
  reqUrl.textContent = request.url || "-";

  const requestPanel = document.querySelector(".request-panel");
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
          <a class="parent-link" data-id="${escapeHtml(request.parentId)}" title="View original request">View original</a>
        `;
      } else if (request.parentId) {
        relInfo.innerHTML = `
          <span>Modified from original request:</span>
          <span class="deleted-parent" title="Original request was deleted">Original deleted</span>
        `;
      }

      const tabsElement = requestPanel.querySelector(".tabs");
      if (tabsElement) {
        requestPanel.insertBefore(relInfo, tabsElement);

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

      const links = modifiedVersions
        .map(
          (mod, index) =>
            `<a class="child-link" data-id="${escapeHtml(mod.id)}" title="View modified version ${
              index + 1
            }">Version ${index + 1}</a>`
        )
        .join(", ");

      relInfo.innerHTML = `
        <span>Has ${modifiedVersions.length} modified version${
        modifiedVersions.length > 1 ? "s" : ""
      }:</span>
        ${links}
      `;

      const tabsElement = requestPanel.querySelector(".tabs");
      if (tabsElement) {
        requestPanel.insertBefore(relInfo, tabsElement);

        relInfo.querySelectorAll(".child-link").forEach((link) => {
          link.addEventListener("click", (e) => {
            selectRequest(e.target.dataset.id);
          });
        });
      }
    }
  } catch (error) {
    console.error("Error displaying relationship info:", error);
  }

  originalContent.reqHeaders = request.requestHeaders || {};
  originalContent.reqBody = formatRequestBody(request.requestBody);
  originalContent.respHeaders = request.responseHeaders || {};
  originalContent.respBody = request.responseBody || "Response body not available";

  if (!reqHeadersPre || !reqBodyPre || !respHeadersPre || !respBodyPre) {
    console.error("Missing pre elements for display");
    return;
  }

  reqHeadersPre.textContent = JSON.stringify(request.requestHeaders || {}, null, 2);
  reqBodyPre.textContent = formatRequestBody(request.requestBody);
  respHeadersPre.textContent = JSON.stringify(request.responseHeaders || {}, null, 2);
  respBodyPre.textContent = request.responseBody || "Response body not available";

  try {
    if (requestFormattingState.req) {
      prettifyContent("reqHeaders", originalContent.reqHeaders);
      prettifyContent("reqBody", originalContent.reqBody);
    } else {
      showRawContent("reqHeaders", originalContent.reqHeaders);
      showRawContent("reqBody", originalContent.reqBody);
    }

    const statusText = request.statusText
      ? `${request.statusCode} ${request.statusText}`
      : request.statusCode || "-";
    respStatus.textContent = statusText;
    respStatus.className = `status ${getStatusClass(request.statusCode)}`;

    if (requestFormattingState.resp) {
      prettifyContent("respHeaders", originalContent.respHeaders);
      prettifyContent("respBody", originalContent.respBody);
    } else {
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

  for (const [key, value] of Object.entries(headers)) {
    const escapedValue = value.replace(/"/g, '\\"');
    curl += ` \\\n  -H "${key}: ${escapedValue}"`;
  }

  if (body && !["GET", "HEAD"].includes(method.toUpperCase())) {
    const escapedBody = body.replace(/"/g, '\\"');
    curl += ` \\\n  -d "${escapedBody}"`;
  }

  navigator.clipboard.writeText(curl).then(() => {
    const original = copyCurlButton.textContent;
    copyCurlButton.textContent = "Copied!";
    setTimeout(() => {
      copyCurlButton.textContent = original;
    }, 1500);
  }).catch((err) => {
    console.error("Failed to copy cURL command", err);
    alert("Failed to copy cURL command. Please try again.");
  });
});

// Modify & Resend functionality
modifyResendButton.addEventListener("click", () => {
  const request = requests.find((req) => req.id === selectedRequestId);
  if (!request) {
    alert("No request selected");
    return;
  }

  modalMethod.value = request.method || "GET";
  modalUrl.value = request.url || "";
  modalHeaders.value = JSON.stringify(request.requestHeaders || {}, null, 2);
  modalBody.value = formatRequestBody(request.requestBody);

  modifyModal.style.display = "block";
});

// Delete Request functionality
deleteRequestButton.addEventListener("click", () => {
  const request = requests.find((req) => req.id === selectedRequestId);
  if (!request) {
    alert("No request selected");
    return;
  }
  if (
    confirm(
      `Are you sure you want to delete this ${request.method} request to ${request.url}?`
    )
  ) {
    const requestsToDelete = new Set([request.id]);

    const modifiedVersions = requests.filter(
      (req) => req.parentId === request.id
    );

    if (modifiedVersions.length > 0 && request.source === "page") {
      const deleteChildren = confirm(
        `This request has ${modifiedVersions.length} modified version(s). Delete those as well?`
      );

      if (deleteChildren) {
        modifiedVersions.forEach((modReq) => {
          requestsToDelete.add(modReq.id);
        });
      } else {
        modifiedVersions.forEach((modReq) => {
          modReq.originalDeleted = true;
        });
      }
    }

    if (request.source === "modified" && request.parentId) {
      // Nothing extra needed — rendering detects remaining modifications automatically
    }

    requests = requests.filter((req) => !requestsToDelete.has(req.id));

    // Persist deletions to background storage
    if (port) {
      port.postMessage({ type: "DELETE", ids: [...requestsToDelete] });
    }

    if (selectedRequestId === request.id) {
      selectedRequestId = null;

      reqMethod.textContent = "-";
      reqUrl.textContent = "-";
      reqHeadersPre.textContent = "";
      reqBodyPre.textContent = "";
      respStatus.textContent = "-";
      respHeadersPre.textContent = "";
      respBodyPre.textContent = "";

      const requestPanel = document.querySelector(".request-panel");
      const existingRelInfo = requestPanel?.querySelector(".relationship-info");
      if (existingRelInfo) {
        existingRelInfo.remove();
      }
    }

    renderRequestsList();
  }
});

// Close modal
closeModalBtn.addEventListener("click", () => {
  modifyModal.style.display = "none";
});

modalCancel.addEventListener("click", () => {
  modifyModal.style.display = "none";
});

window.addEventListener("click", (event) => {
  if (event.target === modifyModal) {
    modifyModal.style.display = "none";
  }
});

// Send modified request
modalSend.addEventListener("click", async () => {
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

  const options = {
    method,
    headers,
    credentials: "include",
  };

  if (body && !["GET", "HEAD"].includes(method.toUpperCase())) {
    options.body = body;
  }

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
      statusCode: response.status,
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

    // Persist to background storage
    if (port) {
      port.postMessage({ type: "STORE", data: { ...newRequest } });
    }

    renderRequestsList();
    selectRequest(newRequest.id);

    modifyModal.style.display = "none";
  } catch (error) {
    alert(`Error sending request: ${error.message}`);
  }
});

// Theme and formatting state
let isLightMode = false;
let groupRelatedRequests = false;
let requestFormattingState = {
  req: true,
  resp: true,
};

let requestFormatType = {
  req: "json",
  resp: "json",
};

let originalContent = {
  reqHeaders: "",
  reqBody: "",
  respHeaders: "",
  respBody: "",
};

// Theme toggle
const themeToggle = document.getElementById("theme-toggle");
themeToggle.addEventListener("click", () => {
  isLightMode = !isLightMode;
  document.body.classList.toggle("light-mode", isLightMode);
  themeToggle.textContent = isLightMode ? "Dark Mode" : "Light Mode";
  localStorage.setItem("lotus-theme", isLightMode ? "light" : "dark");
});

if (localStorage.getItem("lotus-theme") === "light") {
  isLightMode = true;
  document.body.classList.add("light-mode");
  themeToggle.textContent = "Dark Mode";
} else {
  themeToggle.textContent = "Light Mode";
}

// Group Related toggle
if (groupRelatedToggle) {
  groupRelatedToggle.addEventListener("click", () => {
    groupRelatedRequests = !groupRelatedRequests;

    if (groupRelatedRequests) {
      groupRelatedToggle.classList.add("active");
      groupRelatedToggle.textContent = "Ungroup Related";
    } else {
      groupRelatedToggle.classList.remove("active");
      groupRelatedToggle.textContent = "Group Related";
    }

    localStorage.setItem(
      "lotus-group-related",
      groupRelatedRequests ? "true" : "false"
    );
    renderRequestsList();
  });

  if (localStorage.getItem("lotus-group-related") === "true") {
    groupRelatedRequests = true;
    groupRelatedToggle.classList.add("active");
    groupRelatedToggle.textContent = "Ungroup Related";
  }
}

// Format toggle
const formatToggles = document.querySelectorAll(".format-toggle");
formatToggles.forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const target = toggle.dataset.target;
    requestFormattingState[target] = !requestFormattingState[target];

    toggle.textContent = requestFormattingState[target] ? "Pretty" : "Raw";
    toggle.classList.toggle("active", requestFormattingState[target]);

    if (selectedRequestId) {
      toggleFormatting(target);
    }
  });
});

// Format type dropdown
const formatTypeButtons = document.querySelectorAll(".format-type-button");
const formatOptions = document.querySelectorAll(".format-option");

const savedReqFormat = localStorage.getItem("lotus-req-format-type");
const savedRespFormat = localStorage.getItem("lotus-resp-format-type");

if (savedReqFormat) requestFormatType.req = savedReqFormat;
if (savedRespFormat) requestFormatType.resp = savedRespFormat;

formatTypeButtons.forEach((button) => {
  const target = button.dataset.target;
  button.textContent = `Format: ${requestFormatType[target].toUpperCase()}`;
});

formatOptions.forEach((option) => {
  option.addEventListener("click", () => {
    const target = option.dataset.target;
    const format = option.dataset.format;

    requestFormatType[target] = format;

    const button = document.querySelector(
      `.format-type-button[data-target="${target}"]`
    );
    button.textContent = `Format: ${format.toUpperCase()}`;

    localStorage.setItem(`lotus-${target}-format-type`, format);

    if (requestFormattingState[target] && selectedRequestId) {
      toggleFormatting(target);
    }
  });
});

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
  const preElement = document.querySelector(`#${targetId} pre`);
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
            const obj =
              typeof content === "object" ? content : JSON.parse(content);
            preElement.textContent = JSON.stringify(obj, null, 2);
            preElement.classList.add("language-json");
          } catch (e) {
            preElement.textContent = content;
          }
          break;

        case "xml":
          try {
            if (typeof content === "string" && content.includes("<")) {
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
            if (typeof content === "string" && content.includes("<")) {
              preElement.textContent = formatXML(content);
              preElement.classList.add("language-html");
            } else {
              preElement.textContent = content;
            }
          } catch (e) {
            preElement.textContent = content;
          }
          break;

        case "js":
          // Display as plain text — evaluating arbitrary response content is unsafe
          preElement.textContent =
            typeof content === "string" ? content : JSON.stringify(content, null, 2);
          preElement.classList.add("language-javascript");
          break;

        case "css":
          try {
            if (typeof content === "string" && content.includes("{")) {
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
          preElement.textContent =
            typeof content === "string" ? content : JSON.stringify(content);
      }
    }
  } catch (e) {
    preElement.textContent =
      typeof content === "string" ? content : JSON.stringify(content, null, 2);
  }
}

function formatXML(xml) {
  let formatted = "";
  let indent = "";
  const tab = "  ";

  xml = xml.trim().replace(/(>)(<)(\/*)/g, "$1\n$2$3");
  xml.split(/\n/).forEach((line) => {
    if (line.match(/^<\/\w/)) {
      indent = indent.substring(tab.length);
    }

    formatted += indent + line + "\n";

    if (line.match(/^<\w[^>]*[^/]>.*$/)) {
      indent += tab;
    }
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

  formatted = formatted.replace(/\n\s*\n/g, "\n");

  return formatted;
}

function showRawContent(targetId, content) {
  const preElement = document.querySelector(`#${targetId} pre`);
  if (!preElement) return;

  if (targetId.includes("Headers")) {
    if (typeof content === "object") {
      const headerText = Object.entries(content)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n");
      preElement.textContent = headerText;
    } else {
      preElement.textContent = content;
    }
  } else {
    preElement.textContent =
      typeof content === "string" ? content : JSON.stringify(content);
  }

  if (preElement.className) {
    preElement.className = "";
  }
}
