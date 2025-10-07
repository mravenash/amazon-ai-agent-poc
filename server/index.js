import { createApp } from './app.js';

const app = createApp();
const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`[sse] listening on http://localhost:${port}`));
