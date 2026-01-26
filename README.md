# Jira Calendar Sync Extension

A browser extension that syncs Jira tasks with Google Calendar.

## Features

- **Setup & Configuration**: Securely store Jira credentials and select projects/spaces to sync.
- **Task Linking**: Fuzzy search Jira tasks directly from Google Calendar event modal.
- **Task Creation**: Create new Jira tasks on the fly.
- **Worklog Sync**: Automatically log time to Jira based on calendar event duration.
- **Offline Support**: Caches tasks locally for fast searching.

## Development

### Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- Node.js (v18+)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   bun install
   ```

### Build

To build the extension for production:

```bash
bun run build
```

This command performs a multi-step build:
1. `tsc -b`: Type checking
2. `vite build`: Builds the popup, setup page, and background script (using CRXJS)
3. `vite build -c vite.content.config.ts`: Builds the content script as a standalone IIFE (to satisfy CSP)
4. `bun scripts/patch-manifest.js`: Updates the manifest to include the content script

The output will be in the `dist` directory.

### Loading in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `dist` directory

## Architecture

- **Frontend**: React + TypeScript + Tailwind CSS
- **State Management**: Zustand (persisted to chrome.storage)
- **Build Tool**: Vite + CRXJS
- **Content Script**: Injected into Google Calendar to modify the DOM and inject the React app.

## Troubleshooting

### CSP Errors / Dynamic Import Errors

If you see errors like `net::ERR_FILE_NOT_FOUND` for `index.tsx-loader...` or CSP violations regarding `eval`:
- Ensure you are using the latest build process (`bun run build`).
- Clear the `dist` directory before building (`rm -rf dist`).
- Reload the extension in Chrome.

### Trusted Types

The extension uses a Trusted Types policy `jira-sync-policy` to safely inject HTML and Styles into the DOM.
