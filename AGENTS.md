# Agent Instructions

This repository contains a Chrome Extension for syncing Google Calendar events with Jira worklogs.

## 1. Build, Lint, and Test

### Build

Always use bun

To build the extension for production:

```bash
bun run build
```

This runs TypeScript compilation, Vite build (for app and content scripts), and patches the manifest.

### Lint

To run the linter:

```bash
bun run lint
bun run lint:fix
```

This uses ESLint with TypeScript and React rules.

### Test

Currently, there are no automated tests configured in this repository.

- If adding tests, prefer using `bun test` or `vitest`.
- Ensure any new logic is verified manually by building and loading the extension in Chrome if automated tests are not feasible.

## 2. Code Style and Guidelines

### General

- **Language**: TypeScript (Strict mode enabled).
- **Framework**: React (Functional components + Hooks).
- **State Management**: Zustand (`src/store/`).
- **Data Fetching**: TanStack Query (React Query).
- **Styling**: Tailwind CSS.
- **Icons**: Lucide React.
- **Bundler**: Vite.
- **Runtime**: Bun (preferred for scripts/tooling) or Node.js.

### Formatting

- **Indentation**: 2 spaces.
- **Semicolons**: Avoid semicolons at the end of statements (ASI).
- **Quotes**: Use single quotes `'` where possible.
- **Trailing Commas**: ES5 trailing commas (objects, arrays, etc.).

### Naming Conventions

- **Files**:
  - React Components: PascalCase (e.g., `App.tsx`, `ContentApp.tsx`).
  - Utilities/Hooks/Stores: camelCase (e.g., `jira.ts`, `useConfigStore.ts`).
- **Components**: PascalCase (e.g., `function App() { ... }`).
- **Variables/Functions**: camelCase.
- **Types/Interfaces**: PascalCase.
- **Constants**: UPPER_CASE for global constants, camelCase for local.

### Project Structure

- `src/background/`: Background service worker scripts.
  - Handles API requests to Jira (to avoid CORS issues in content scripts).
  - Manages extension state and events.
- `src/content/`: Content scripts (run on web pages).
  - `ContentApp.tsx`: React root for content script UI (injected into page).
  - `scraper.ts`: Logic for scraping data from the DOM.
- `src/popup/`: Extension popup UI.
  - Main entry point for user interaction.
- `src/components/`: Shared UI components (shadcn/ui style).
- `src/lib/`: Utility functions and API clients (e.g., `jira.ts`).
- `src/store/`: Global state stores (Zustand).
- `src/types/`: TypeScript type definitions.

### Imports

- Use the `@/` alias for imports from `src/`.

  ```typescript
  import { Button } from "@/components/ui/button";
  ```

- Group imports:
  1. External libraries (React, Lucide, etc.)
  2. Internal components/hooks/stores
  3. Types/Styles

### Error Handling

- Use `try/catch` blocks for async operations, especially API calls and message passing.
- Log errors to the console with descriptive prefixes (e.g., `[Jira Sync] Failed to...`).
- In UI components, handle loading and error states gracefully (e.g., using `isPending`, `isError` from React Query).

### Chrome Extension Specifics

- **Message Passing**:
  - Use `chrome.runtime.sendMessage` to communicate from Content Script/Popup to Background Script.
  - Use `chrome.tabs.sendMessage` to communicate from Background/Popup to Content Script.
  - Define message types in `src/types/messages.ts`.
- **Storage**:
  - Use `chrome.storage.local` or `chrome.storage.sync` for persistence.
  - Zustand stores may need to sync with Chrome storage.
- **Manifest V3**:
  - Background script is a service worker (ephemeral).
  - Use alarms for periodic tasks instead of `setInterval`.

### Best Practices

- **Type Safety**: Avoid `any` where possible. Define interfaces for API responses and message payloads.
- **Performance**: Use `useQuery` for caching and state management of async data.
- **Clean Code**: Keep components small and focused. Extract logic into hooks or utility functions.
- **Security**:
  - Do not store sensitive credentials in plain text if possible.
  - Be careful with `innerHTML` or `dangerouslySetInnerHTML`.

### Common Workflows

1. **Adding a new feature**:
   - Define types in `src/types/`.
   - Implement logic in `src/lib/` or `src/background/`.
   - Create UI in `src/popup/` or `src/content/`.
   - Add message handlers if cross-context communication is needed.
2. **Modifying the UI**:
   - Use Tailwind CSS for styling.
   - Reuse components from `src/components/ui/`.
   - Ensure responsiveness and accessibility.
