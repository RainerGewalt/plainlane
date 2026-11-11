# AGENTS.md

This file is the working agreement for coding agents and contributors in the Plainlane repository.

## Product boundary

Plainlane is deliberately small. Preserve these product constraints:

- three lanes only: To Do, In Progress, Done;
- no due dates or due-date metrics;
- no accounts, roles, notifications, mailbox sync, or automation engine;
- SQLite remains the only database;
- AI web research stays optional and scoped to a single In Progress card;
- common actions should remain visible and clickable in the browser.
- keyboard navigation, visible focus, semantic labels, and readable contrast are release requirements.

Do not add features outside this boundary unless the user or maintainer explicitly requests them.

## Repository map

- `src/App.jsx`: boards, cards, filters, drag and drop, import, and export
- `src/CardModal.jsx`: card editing, comments, attachments, and research
- `src/BoardModal.jsx`: create and edit boards
- `src/dialog.js`: keyboard focus containment for modal dialogs
- `src/seed.js`: neutral starter board content and visual labels
- `server/index.js`: schema, migrations, REST API, file storage, and research calls
- `compose.yml`: production-style local stack
- `nginx/default.conf`: static hosting and API proxy
- `start.sh`: friendly Docker entry point

## Commands

```bash
npm install
npm run dev
npm test
npm run build
node --check server/index.js
docker compose config
docker compose up --build -d
```

Run the smallest relevant checks after every change. For API or persistence changes, also test against a temporary SQLite database.

## Data and privacy rules

- Never commit `.env`, API keys, SQLite files, exported boards, uploaded documents, or real personal data.
- Starter data and examples must be fictional and neutral.
- Attachments and comments must never be added to an AI request implicitly.
- Document any new field that leaves the local server.
- Public releases must be built from a clean snapshot, not from a private Git history.

## Persistence rules

- Treat existing SQLite databases as user data.
- Schema changes must be additive or include an explicit safe migration.
- Never delete or reset user data during startup.
- Keep board export/import compatible when stored fields change.

## Implementation style

- Prefer simple React state and the existing REST API over new frameworks.
- Keep labels and documentation in English.
- Reuse the current CSS system and browser-native controls.
- Keep secrets server-side; never introduce a `VITE_` secret.
- Avoid new dependencies unless they materially simplify the existing product.
