# Soul Painter

A terminal-themed AI image generation tool supporting text-to-image, image-to-image editing, and inpainting with mask painting.

## Features

- **Text-to-Image** — Describe what you want, generate images via API
- **Image-to-Image** — Upload reference images and describe edits
- **Inpainting** — Paint a mask on the reference image to limit edits to specific regions
- **Multi-Image Chat** — Send multiple reference images in a single request
- **Single Image Selection** — Select one image from multiple for focused editing
- **Batch Mode** — Process multiple reference images independently in parallel
- **Auto Compression** — Oversized images (>1.5MB or >2048px) are automatically downscaled
- **Base64 Decoder** — Paste base64 strings or data URLs to preview and download images
- **Chat History** — View past generations with lightbox preview and download options
- **Persistent Settings** — All configuration auto-saves to localStorage, restored on reload
- **Debug Panel** — Toggle to inspect raw API responses for troubleshooting

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local — set your DEFAULT_API_KEY and DEFAULT_BASE_URL

# Start dev server
npm run dev
# → http://localhost:3010
```

### Environment Variables

| Variable | Description |
|---|---|
| `DEFAULT_API_KEY` | API key used when the frontend doesn't provide one |
| `DEFAULT_BASE_URL` | OpenAI-compatible/image base URL; include the provider's version prefix when required, e.g. `https://api.openai.com/v1` |
| `DEFAULT_CHAT_API_KEY` | Optional chat-specific API key; falls back to `DEFAULT_API_KEY` |
| `DEFAULT_CHAT_BASE_URL` | Optional OpenAI-compatible chat base URL; falls back to `DEFAULT_BASE_URL` |
| `OPENAI_CHAT_MODELS` | Comma-separated OpenAI Compatible chat models shown in the selector |
| `DEFAULT_OPENAI_CHAT_MODEL` | Default OpenAI Compatible chat model; defaults to the first configured OpenAI model |
| `DEFAULT_OPENAI_TITLE_MODEL` | OpenAI Compatible model used to generate chat titles; defaults to the last configured OpenAI model |
| `DEFAULT_CLAUDE_API_KEY` | Optional Claude-specific API key; falls back to `DEFAULT_CHAT_API_KEY` |
| `DEFAULT_CLAUDE_BASE_URL` | Optional Claude Compatible base URL; normally `https://api.anthropic.com/v1` |
| `CLAUDE_CHAT_MODELS` | Comma-separated Claude Compatible chat models shown in the selector |
| `DEFAULT_CLAUDE_CHAT_MODEL` | Default Claude Compatible chat model; defaults to the first configured Claude model |
| `DEFAULT_CLAUDE_TITLE_MODEL` | Claude Compatible model used to generate chat titles; defaults to the last configured Claude model |
| `SERVER_ACCESS_TOKEN` | Required in production when a browser uses server-default API keys; enter the same value in Connection Settings |
| `ALLOW_ANONYMOUS_DEFAULT_API_KEY` | Explicitly allows anonymous use of server-default keys; disabled by default |
| `UPSTREAM_HOST_ALLOWLIST` | Comma-separated private hosts allowed as custom upstreams; configured default Base URLs are trusted automatically |
| `ALLOW_PRIVATE_UPSTREAMS` | Disables private-address SSRF blocking globally; use only on a trusted network |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to read proxy responses cross-origin; same-origin requests need no entry |
| `MODEL_GATE_ENABLED` | Enables the header-tap gate for model access |
| `MODEL_GATE_SECRET` | Secret used to sign the model-gate unlock cookie |
| `CHAT_ASSET_MAX_IMAGE_BYTES` | Maximum size of a single server-stored chat image; defaults to 8 MB |
| `CHAT_ASSET_SESSION_MAX_BYTES` | Maximum chat image storage per browser session; defaults to 256 MB |
| `CHAT_ASSET_SESSION_MAX_FILES` | Maximum saved chat image files per browser session; defaults to 200 |
| `CHAT_ASSET_SESSION_MAX_AGE_DAYS` | Removes inactive chat image sessions after this many days; defaults to 30 |
| `CHAT_ASSET_MAX_BODY_BYTES` | Maximum JSON upload body accepted by the chat asset route |
| `CHAT_ASSET_CACHE_MAX_AGE_SECONDS` | Browser cache lifetime for private chat asset responses; defaults to 3600 |
| `CHAT_ASSET_COOKIE_SECURE` | `auto`, `true`, or `false`; controls whether chat asset cookies require HTTPS |
| `CHAT_ASSET_REMOTE_FETCH_TIMEOUT_MS` | Timeout for server-side remote image mirroring; defaults to 15000 |
| `CHAT_ASSET_REMOTE_FETCH_MAX_REDIRECTS` | Maximum redirects followed while mirroring remote images; defaults to 3 |

### API Key Sources

The app supports four ways to provide API credentials, in priority order:

1. **URL query params** — `?apiKey=sk-xxx&baseurl=https://...`
2. **User input** — Enter in Settings modal (saved to localStorage)
3. **Server default** — Set `DEFAULT_API_KEY` and `SERVER_ACCESS_TOKEN` in `.env.local`, then enter the access token in Connection Settings
4. **None** — Requests return a 401 error until configured

Chat settings can save separate OpenAI Compatible and Claude Compatible credentials at the same time. The selected chat model automatically chooses the matching API format. To use Claude directly, select a Claude model, set **Claude Base URL** to `https://api.anthropic.com/v1`, and use an Anthropic API key.

## Usage

### Text-to-Image

1. Type a prompt in the input field
2. Adjust parameters: size, quality, format, N (count), model, background, moderation
3. Press **Enter** or **Ctrl+Enter** to send

### Image-to-Image

1. **Drag & drop**, **paste**, or click the **attachment button** to add reference images
2. Optionally click an image to open the mask editor — paint red overlay on areas to modify
3. Type instructions describing the desired edits
4. Send

### Batch Mode

When 2+ reference images are added and batch mode is enabled, each image gets an independent request (concurrency ≤ 5).

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `Enter` | Send prompt |
| `Ctrl+Enter` | Send prompt |
| `Shift+Enter` | New line |
| `F1` | Open settings |
| `Esc` | Close modal / lightbox |

## Architecture

- **Framework**: Next.js 16 (App Router) + React 19
- **Styling**: Tailwind CSS v4, monospace terminal aesthetic
- **State**: React Context (Config, Chat, Image)
- **Workflow orchestration**: `useRunPrompt` coordinates request lifecycle, retries, streaming, title generation, and context updates
- **Local persistence**: IndexedDB via `idb-keyval` stores chat sessions, image history, sync tombstones, and stream capability cache; localStorage/sessionStorage are reserved for lightweight settings, prompts, and sync auth metadata
- **Server persistence**: Prisma + SQLite store chat sync metadata in `data/chat-sync.db`; chat image assets are stored on local disk under `data/chat-assets`
- **API Proxy**: Next.js API routes forward requests to an OpenAI Compatible or Claude Compatible API, injecting auth from client headers or server env

### API Routes

| Route | Upstream Endpoint | Body Type |
|---|---|---|
| `/api/chat/completions` | OpenAI: `{baseUrl}/chat/completions`; Claude: `{baseUrl}/messages` | JSON |
| `/api/images/generations` | `{baseUrl}/images/generations` | JSON |
| `/api/images/edits` | `{baseUrl}/images/edits` | multipart/form-data |
| `/api/config` | — | Returns server-side key status |
| `/api/chat-assets` | — | Stores or clears local chat image assets |
| `/api/chat-assets/[assetId]` | — | Serves local chat image assets |
| `/api/chat-sync` | — | Syncs chat sessions through Prisma/SQLite |
| `/api/model-gate` | — | Reads or updates model gate state |

### Runtime Notes

The server routes that touch Prisma, SQLite, local chat assets, Node streams, or filesystem APIs run on the Node.js runtime, not the Edge runtime. Deployments need persistent local storage for `data/` or equivalent replacements for SQLite and chat asset files. Serverless platforms without durable local disks require moving sync storage to a managed database and chat assets to object storage.

### Tests

The project uses Vitest for unit coverage of parser, streaming, and sync delta helpers.

## Scripts

```bash
npm run dev      # Dev server (port 3010)
npm run build    # Production build
npm run start    # Production server (port 3010)
npm run lint     # ESLint
npm run test     # Vitest unit tests
```

## Credits

Inspired by 米醋画图.

## License

MIT
