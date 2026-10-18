import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { HealthModule } from '../src/health/health.module';

test('health: GET y HEAD responden 200 sin caché (solo el módulo, sin base)', async () => {
  const app = await NestFactory.create(HealthModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const url = `${await app.getUrl()}/health`;
  try {
    const get = await fetch(url);
    assert.equal(get.status, 200);
    assert.equal(get.headers.get('cache-control'), 'no-store');
    const body = await get.json();
    assert.equal(body.ok, true);
    assert.ok(Number.isInteger(body.uptimeS));
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.status, 200);
  } finally {
    await app.close();
  }
});
