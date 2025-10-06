/**
 * Safely parse a JSON string
 * @param {string} str - The string to parse
 * @returns {object|null} The parsed object or null if invalid
 */
export function safeParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/**
 * Convert an array of headers to an object
 * @param {Array} headersArray - Array of header objects with name/value properties
 * @returns {object} Object with header names as keys
 */
export function toHeaderObject(headersArray) {
  const out = {};
  if (!headersArray) return out;
  for (const header of headersArray) {
    if (typeof header.name === "string") {
      out[header.name] = header.value;
    }
  }
  return out;
}

/**
 * Format a request body for display
 * @param {*} body - The request body
 * @returns {string} Formatted body string
 */
export function formatRequestBody(body) {
  if (!body) return "";

  // Handle form data
  if (body.formData) {
    return JSON.stringify(body.formData, null, 2);
  }

  // Handle raw binary data
  if (body.raw && Array.isArray(body.raw)) {
    try {
      const decoder = new TextDecoder();
      const rawData = body.raw
        .map((item) => {
          if (item.bytes) {
            return decoder.decode(new Uint8Array(item.bytes));
          }
          return "";
        })
        .join("");

      return formatTextContent(rawData);
    } catch (err) {
      console.error("Error formatting raw body:", err);
      return JSON.stringify(body, null, 2);
    }
  }

  // Handle string body
  if (typeof body === "string") {
    return formatTextContent(body);
  }

  // Default: stringify the object
  try {
    return JSON.stringify(body, null, 2);
  } catch (err) {
    console.error("Error stringifying body:", err);
    return String(body);
  }
}

/**
 * Format text content based on its type
 * @param {string} text - The text content to format
 * @returns {string} Formatted text
 */
export function formatTextContent(text) {
  if (!text) return "";

  // Try to parse as JSON
  try {
    const jsonObj = JSON.parse(text);
    return JSON.stringify(jsonObj, null, 2);
  } catch {
    // Not JSON, return as is
    return text;
  }
}
