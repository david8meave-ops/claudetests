# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

UIGen is an AI-powered React component generator with live preview. The user describes a component in chat; the AI authors files into an in-memory virtual file system; a sandboxed iframe renders them via Babel-in-browser. **No generated files are ever written to disk** — they live in `VirtualFileSystem` instances and (for logged-in users) are persisted as JSON blobs in SQLite.

## Commands

```bash
npm run setup        # install + prisma generate + prisma migrate dev (run after clone)
npm run dev          # next dev --turbopack on :3000
npm run dev:daemon   # same, backgrounded with logs to logs.txt
npm run build        # next build
npm run lint         # next lint
npm test             # vitest (jsdom env)
npm run db:reset     # prisma migrate reset --force (wipes dev.db)
```

Run a single test file: `npx vitest run src/lib/__tests__/file-system.test.ts`
Watch a single file: `npx vitest src/lib/__tests__/file-system.test.ts`

All Next/Node scripts inject `NODE_OPTIONS='--require ./node-compat.cjs'`. That shim deletes the global `localStorage`/`sessionStorage` Node 25 exposes by default — without it, dependencies that feature-detect `localStorage` to decide "am I in a browser?" crash during SSR. Don't remove it unless you're upgrading off Node 25.

## Architecture

### The virtual file system is the source of truth
`src/lib/file-system.ts` defines `VirtualFileSystem` — an in-memory tree backed by a flat `Map<path, FileNode>`. Every read/write the AI performs goes through this class, never `fs`. Two surfaces consume it:

- **Server (`/api/chat`)**: reconstructs a fresh `VirtualFileSystem` per request from the serialized `files` field in the request body, hands it to the tool implementations, then on `onFinish` re-serializes and persists to `Project.data` if `projectId` is set.
- **Client (`FileSystemProvider`)**: holds a long-lived `VirtualFileSystem` and applies the AI's tool calls *optimistically* via `handleToolCall` so the editor and preview update mid-stream. The server's authoritative copy and the client's optimistic copy must stay in sync — both interpret `str_replace_editor` and `file_manager` arguments using the same `VirtualFileSystem` methods.

When you change file-system semantics (path normalization, edit ops, serialization), update both `src/lib/tools/*` (server execute) and `src/lib/contexts/file-system-context.tsx` (`handleToolCall`).

### Provider auto-falls-back to a mock
`src/lib/provider.ts#getLanguageModel` returns the real Anthropic model only when `ANTHROPIC_API_KEY` is set; otherwise it returns `MockLanguageModel`, which streams a hardcoded counter/form/card scenario in 3–4 steps. The route halves `maxSteps` (4 vs 40) when the mock is active to avoid loops. Treat the mock as a deterministic fixture for offline dev — don't add features that assume real model behavior without checking `process.env.ANTHROPIC_API_KEY` is present.

### Preview is fully client-side, no bundler
`src/components/preview/PreviewFrame.tsx` + `src/lib/transform/jsx-transformer.ts` compile each `.jsx`/`.tsx` file with `@babel/standalone`, wrap each output in a blob URL, and assemble a browser `<script type="importmap">` so the iframe can `import` user code by path. The `@/` alias is resolved by registering every file under multiple keys (`/foo.jsx`, `foo.jsx`, `@/foo.jsx`, plus extension-stripped variants). Third-party imports route to `https://esm.sh/<pkg>`. Missing local imports become placeholder `<div/>` modules so the preview never crashes on a half-finished tree. The iframe uses `srcdoc` with `sandbox="allow-scripts allow-same-origin allow-forms"`.

### Auth + persistence
- JWT in an httpOnly `auth-token` cookie, signed with `JWT_SECRET` (falls back to `"development-secret-key"`) via `jose`. `src/lib/auth.ts` is the only entry point — it's `import "server-only"`.
- `src/middleware.ts` gates `/api/projects` and `/api/filesystem` on a valid session; it does *not* gate `/api/chat`, since anonymous users can chat.
- Anonymous work is held in `sessionStorage` via `src/lib/anon-work-tracker.ts`. On sign-in, that data is meant to be promoted into a real `Project` row.
- Prisma client is generated to `src/generated/prisma` (custom `output` in `schema.prisma`) — import it from `@/lib/prisma`, not `@prisma/client`. SQLite file is `prisma/dev.db`.

### System prompt for the generator
`src/lib/prompts/generation.tsx` is the system prompt sent on every chat turn. It enforces the contract the rest of the system depends on: every project must have `/App.jsx` exporting a default React component, all styling is Tailwind, imports use the `@/` alias. If you change this prompt, also re-check `PreviewFrame`'s entry-point fallback list and the mock provider's hardcoded files.
