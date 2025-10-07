import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';

const app = createApp();

describe('server endpoints', () => {
  it('status returns backend mode', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(['mock', 'bedrock']).toContain(res.body.backend);
  });

  it('catalog search returns items', async () => {
    const res = await request(app).get('/api/catalog/search').query({ q: 'airpods' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it('orders validates item id', async () => {
    const bad = await request(app).post('/api/orders').send({ itemId: 'NOPE' });
    expect(bad.status).toBe(404);
  });
});
