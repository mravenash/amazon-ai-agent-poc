## API reference

Base URL (local dev): http://localhost:8787

### GET /api/status
Returns backend mode.

Response 200
```
{ "backend": "mock" | "bedrock" }
```

### GET /api/catalog/search?q=QUERY
Search the catalog. Supports synonyms and fuzzy matching; results are image-enhanced.

Response 200
```
{ "items": [ { "id": "A100", "title": "AirPods Pro", "price": 249.99, "image": "..." }, ... ] }
```

### POST /api/orders
Create an order.

Request JSON
```
{ "itemId": "A100", "quantity": 2 }
```

Response 200
```
{ "orderId": "ORD-ABC123", "item": { "id": "A100", "title": "AirPods Pro", "price": 249.99, "image": "..." }, "quantity": 2, "total": 499.98 }
```

### GET /api/orders
List previously created orders.

Response 200
```
{ "orders": [ { "orderId": "ORD-ABC123", "item": { ... }, "quantity": 2, "total": 499.98, "createdAt": "2025-10-06T12:34:56.000Z" }, ... ] }
```

### POST /api/admin/reload-catalog
Dev-only endpoint to reload the local catalog JSON.

Response 200
```
{ "ok": true, "count": 12 }
```

## SSE: POST /api/chat
Streams assistant output and structured events.

Request JSON
```
{ "prompt": "find airpods", "clientId": "abc123" }
```

Stream format
- Tokens: `data: <text>` frames (space-delimited tokens)
- Events:
  - Catalog
    ```
    event: catalog
    data: { "items": [ { "id": "A100", "title": "AirPods Pro", "price": 249.99, "image": "..." }, ... ] }
    ```
  - Order
    ```
    event: order
    data: { "orderId": "ORD-XYZ789", "item": { ... }, "quantity": 2, "total": 499.98 }
    ```
- Completion: `event: done` + `data: end`
- Error (server-side): `event: error` with JSON payload

Client behavior
- The frontend accumulates tokens into the last assistant message.
- On `catalog`, it renders a catalog card; if one item, it sets it as pending and applies any quantity parsed from the prompt to the item selectors.
- On `order`, it removes the previous catalog card and adds an order card message, then refreshes the sidebar orders list.
- SSE retries with exponential backoff and jitter; the StatusBar shows reconnect attempts.
