# AGENTS.md

## Project: Casto Tools Chrome Extension

Read `CODEX_TASK.md` in the project root FIRST — it is the complete specification. Everything below supplements it.

## Working Agreements

- This is a Chrome Extension (Manifest V3). No build tools, no npm, no bundlers. Plain JS files loaded via "Load unpacked."
- All user-facing text is in French. Comments and variable names in English.
- Follow the phased development order in CODEX_TASK.md (Phase 0 → 7). Complete each phase fully before starting the next.
- Reference scripts in `/reference-scripts/` are for understanding BUSINESS LOGIC and API contracts only. Do not copy their code patterns — rewrite cleanly.
- After completing each phase, verify it works by checking the phase's "Done when" criteria.
- When in doubt about behavior, the reference script is the source of truth.

## Code Style

- Use modern JS (ES2020+, async/await, optional chaining, nullish coalescing). No TypeScript.
- Each module in its own directory under `/src/modules/`.
- Shared code in `/src/shared/`.
- Background service worker at `/src/background/`.
- File naming: `kebab-case.js`.
- Functions: `camelCase`. Constants: `UPPER_SNAKE_CASE`. Classes (if any): `PascalCase`.
- Every file starts with a brief JSDoc comment explaining its purpose.
- Console logs use module prefix: `console.log('[ModuleName]', ...)`.

## Architecture Constraints

- Content scripts communicate with background via `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`.
- ALL cross-origin fetches go through the background service worker. Content scripts NEVER call `fetch()` to external APIs directly.
- Auth headers captured in background via `chrome.webRequest.onBeforeSendHeaders`, stored in-memory in background, served to content scripts on request.
- Storage: `chrome.storage.local` only. Keys namespaced by module.
- No external dependencies except Chart.js (loaded as web-accessible resource from `/lib/`).

## Testing

- After each phase, manually verify by loading the extension and checking against the success criteria.
- If you write test scripts, put them in `/tests/` but they are not required.

## Reference Scripts Location

Place the original Tampermonkey scripts in `/reference-scripts/` for consultation:
- `caddie-magique.user.js`
- `coliweb-calculator.user.js`
- `gev.user.js`
- `provisionnes.user.js`
- `sur-mesure-scraper.user.js`
