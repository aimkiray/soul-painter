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
| `DEFAULT_BASE_URL` | Upstream API base URL (e.g. `https://api.avemujica.moe`) |
| `DEFAULT_CHAT_API_KEY` | Optional chat-specific API key; falls back to `DEFAULT_API_KEY` |
| `DEFAULT_CHAT_BASE_URL` | Optional chat-specific base URL; falls back to `DEFAULT_BASE_URL` |
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
3. **Server default** — Set in `.env.local` as `DEFAULT_API_KEY`
4. **None** — Requests return a 401 error until configured

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
- **API Proxy**: 4 Next.js API routes that forward requests to an OpenAI-compatible API, injecting auth from client headers or server env

### API Routes

| Route | Upstream Endpoint | Body Type |
|---|---|---|
| `/api/chat/completions` | `{baseUrl}/v1/chat/completions` | JSON |
| `/api/images/generations` | `{baseUrl}/v1/images/generations` | JSON |
| `/api/images/edits` | `{baseUrl}/v1/images/edits` | multipart/form-data |
| `/api/config` | — | Returns server-side key status |

## Scripts

```bash
npm run dev      # Dev server (port 3010)
npm run build    # Production build
npm run start    # Production server (port 3010)
npm run lint     # ESLint
```

## Credits

Inspired by 米醋画图.

## License

MIT
