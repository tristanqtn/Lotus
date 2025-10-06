# Lotus 🪷

Lotus is a powerful browser extension for capturing, examining, modifying, and replaying API requests directly in your browser's DevTools. It helps developers debug API interactions, test endpoints, and streamline API-related workflows.

## Features

- 🪷 **API Request Monitoring**: Automatically captures all API requests made by the current tab.
- 🔍 **Request Inspection**: View complete request and response details including headers, parameters, and status codes.
- 📋 **Copy as cURL**: Export any captured request as a cURL command for use in your terminal or API documentation.
- 🔄 **Real-time Updates**: Requests are displayed in real-time as they occur.
- 🔎 **Filtering**: Quickly find specific requests with the built-in filter.
- 🔁 **Modify & Resend**: Edit captured requests and resend them to test API endpoints.
- 🌓 **Light/Dark Mode**: Switch between light and dark themes based on your preference.
- 🔄 **Raw/Pretty Toggle**: View response data in raw format or beautifully formatted JSON.

## New Features

### Modify & Resend

Edit any captured request and send it again with modified parameters. This is particularly useful for:

- Testing different API payloads without changing your code
- Troubleshooting by isolating request issues
- Exploring API behavior with different inputs

### Theme Support

- **Dark Mode (Default)**: A beautiful Dracula-inspired dark theme that's easy on the eyes for long development sessions
- **Light Mode**: A clean, professional light theme for high-contrast environments
- Your theme preference is remembered between sessions

### Formatting Options

Toggle between pretty-formatted and raw data views:

- **Pretty**: JSON data is automatically formatted with proper indentation and syntax highlighting
- **Raw**: See the exact data as sent or received over the wire, ideal for debugging serialization issues

## Browser Compatibility

Lotus primarily works with Chromium-based browsers:

- ✅ Google Chrome (primary development platform)
- ✅ Microsoft Edge
- ✅ Brave
- ✅ Opera
- ✅ Vivaldi
- ❌ Firefox (not compatible due to different extension API)
- ❌ Safari (not compatible due to different extension API)

## Installation

1. Clone this repository or download the source code.
2. Open a Chromium-based browser and navigate to `chrome://extensions/` (or the equivalent in your browser).
3. Enable "Developer mode" in the top-right corner.
4. Click "Load unpacked" and select the Lotus directory.

## Usage

1. Open DevTools (F12 or right-click > Inspect).
2. Navigate to the "Lotus" panel (you may need to click the "»" overflow menu to find it).
3. Browse the website as normal - all API requests will be automatically captured.
4. Click on any request in the sidebar to view its details.
5. Use the features:
   - **Copy as cURL**: Copy the request as a cURL command for use in your terminal
   - **Modify & Resend**: Change request parameters and send a new request
   - **Theme Toggle**: Switch between dark (Dracula) and light themes
   - **Format Toggle**: Switch between raw and prettified data views

## How It Works

Lotus utilizes the Chrome DevTools Protocol and Extension APIs to intercept, analyze, and manipulate network requests:

1. **Request Capture**: The background script (`background.js`) uses the `chrome.webRequest` API to monitor all outgoing HTTP requests from the current tab.

2. **Data Processing**: Captured requests are processed, with headers and body information extracted and formatted for display.

3. **DevTools Integration**: The extension adds a custom panel to Chrome DevTools where the UI is rendered.

4. **Real-time Communication**: A persistent connection between the DevTools panel and the background script ensures that new requests appear in real-time.

5. **Response Body Capture**: The extension attempts to capture response bodies through a combination of the webRequest API and fetch API when possible.

6. **Storage and State**: Request data is temporarily stored in memory and persisted using `chrome.storage.local` to survive extension restarts.

## Development

To modify or enhance Lotus:

1. Edit `background.js` to change how requests are captured and processed.
2. Edit `panel.js` and `panel.html` to modify the DevTools panel UI.
3. Edit `panel.css` for styling changes and theme modifications.
4. Edit `lib/utils.js` for utility functions used across the extension.
5. Edit `popup.html` to modify the extension popup UI and documentation.
6. Reload the extension in `chrome://extensions/` after making changes.

### Project Structure

```
background.js        # Background script for request interception
devtools.html        # DevTools page setup
devtools.js          # Registers the DevTools panel
manifest.json        # Extension configuration
panel.css           # Styles for the DevTools panel
panel.html          # HTML structure of the DevTools panel
panel.js            # Main UI logic for the panel
popup.html          # Extension popup with documentation
lib/
  utils.js          # Shared utility functions
```

## License

This project is open source and available under the [MIT License](LICENSE).

## Troubleshooting

### Lotus Panel Not Visible

If you don't see the Lotus panel in DevTools:

1. Close and reopen DevTools
2. Check the "»" overflow menu to see if Lotus is hidden there
3. Try disabling and re-enabling the extension in `chrome://extensions/`
4. Ensure you have the latest version of your browser

### Request Data Not Appearing

If you're not seeing API requests in Lotus:

1. Confirm the requests are actually being made (check Network tab)
2. Some requests from other extensions or service workers might not be captured
3. Try refreshing the page to restart the capturing process

### Other Issues

- For CORS-related issues, remember that Lotus can only access what the browser's Network API provides
- Large response bodies might be truncated in the display
- For secure contexts (https), more request data is available than for insecure contexts

## Credits

- Dracula theme colors inspired by the [Dracula Theme](https://draculatheme.com/)
- Icons and styling based on modern design practices for developer tools

---

If you find Lotus useful, consider starring the repository and contributing to its development!
