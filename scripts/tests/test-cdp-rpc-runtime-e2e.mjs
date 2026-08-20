import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRuntimeE2eCdpRpc,
  RUNTIME_E2E_CDP_REQUEST_TIMEOUT_MS,
} from '../lib/cdp-rpc.mjs';

class FakeWebSocket {
  constructor() {
    this.listeners = { open: [], message: [], close: [], error: [] };
    this.sent = [];
    this.readyState = 0;
  }

  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  open() {
    this.readyState = 1;
    for (const fn of this.listeners.open) fn();
  }

  respond(payload) {
    for (const fn of this.listeners.message) fn({ data: JSON.stringify(payload) });
  }

  close(code = 1006) {
    this.readyState = 3;
    for (const fn of this.listeners.close) fn({ code, reason: 'test close' });
  }
}

async function openSession(options = {}) {
  const ws = new FakeWebSocket();
  const rpc = createRuntimeE2eCdpRpc(ws, options);
  ws.open();
  await rpc.opened;
  return { ws, rpc };
}

test('runtime-e2e factory default timeout is the stream-timeout magnitude', () => {
  assert.equal(RUNTIME_E2E_CDP_REQUEST_TIMEOUT_MS, 180_000);
});

test('runtime-e2e send() resolves a matching CDP result', async () => {
  const { ws, rpc } = await openSession();
  const pending = rpc.send('Runtime.enable');
  assert.equal(ws.sent[0].method, 'Runtime.enable');
  ws.respond({ id: ws.sent[0].id, result: { ok: true } });
  assert.deepEqual(await pending, { ok: true });
});

test('runtime-e2e send() rejects on socket close and names the waiting method', async () => {
  const { ws, rpc } = await openSession();
  const pending = rpc.send('Runtime.evaluate', { expression: '1' });
  ws.close(1006);
  await assert.rejects(pending, (error) => {
    assert.match(error.message, /closed while waiting/i);
    assert.match(error.message, /Runtime\.evaluate/);
    return true;
  });
  assert.equal(rpc.pending.size, 0);
});

test('runtime-e2e close rejects every pending request and lists their methods', async () => {
  const { ws, rpc } = await openSession();
  const first = rpc.send('Runtime.evaluate');
  const second = rpc.send('Page.captureScreenshot');
  ws.close();
  const expectBoth = (error) => {
    assert.match(error.message, /closed while waiting/i);
    assert.match(error.message, /Runtime\.evaluate/);
    assert.match(error.message, /Page\.captureScreenshot/);
    return true;
  };
  await assert.rejects(first, expectBoth);
  await assert.rejects(second, expectBoth);
});

test('runtime-e2e send() times out and names the method', async () => {
  const { rpc } = await openSession({ requestTimeoutMs: 30 });
  await assert.rejects(rpc.send('Page.enable'), (error) => {
    assert.match(error.message, /Page\.enable/);
    assert.match(error.message, /timed out after 30ms/);
    return true;
  });
  assert.equal(rpc.pending.size, 0);
});
