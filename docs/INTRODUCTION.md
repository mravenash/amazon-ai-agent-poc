# Applied AI Agent POC — Introduction

This project is a conversational shopping assistant with streaming responses, a browsable catalog, and inline ordering.

## Features
- Chat-first experience with streaming tokens (SSE)
- Structured UI cards in the chat for:
  - Catalog results (uniform, compact cards with images, price, and actions)
  - Order confirmations (summary with image, qty, and total)
- Buy via click or text (e.g., “buy A100 qty 2”), with pending confirmation flow
  - Conversational buy detection with synonyms/keywords (e.g., “I want to buy earphones”)
- Per-item quantity selection persisted per session
- Orders sidebar grouped by session (collapsible), with live refresh; clicking an order switches to that session, scrolls to the confirmation in chat, and opens details in the footer
- Developer Tools footer (toggle at the bottom): read-only catalog browser and order detail viewer
- Search quality:
  - Synonyms support (e.g., earphones/earbuds)
  - Per-item keywords in the local catalog
  - Optional public catalog (DummyJSON) fallback
- Image handling:
  - Default to curated catalog images (configurable via IMAGE_SOURCE; default is `catalog`)
  - Safe fallbacks with lazy loading
- Accessibility and UX:
  - Sticky input area, auto-scroll on stream and card insert
  - Centered spinners for loading states

## UI at a glance
Screenshots or a short GIF can be added later if needed.

## Architecture overview
- Frontend: React 19 + TypeScript + Vite, Cloudscape components, TanStack Virtual, Zustand
- Backend: Express 5 + CORS; SSE streaming; optional AWS Bedrock proxy
- Data: Local JSON catalog and orders files (auto-reload on change)

## Configuration
- IMAGE_SOURCE=catalog|unsplash|picsum (default: catalog)
- PUBLIC_CATALOG_SOURCE=dummyjson (optional)
- BEDROCK_MODEL_ID and AWS_REGION (optional) for real model streaming
- FUZZY_SHORT_MAX_DISTANCE and FUZZY_LONG_MAX_DISTANCE (optional) to tune typo tolerance

## Development
- Start dev: `npm run dev:all`
- Build: `npm run build`
- Test: `npm run test`

## Example prompts
- find airpods
- I want to buy earphones
- can I buy airpods qty 2?
- please order A100 x2
- confirm

Notes:
- Minor typos are tolerated (e.g., “earins” will match earbuds/earphones).
- Quantity hints in prompts (e.g., `qty 2`, `x2`) apply to the catalog result’s quantity selectors; for multiple results, the quantity is applied to all listed items.