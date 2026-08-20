import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createKitProbeCdpRpc,
  KIT_PROBE_CDP_REQUEST_TIMEOUT_MS,
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
  const rpc = createKitProbeCdpRpc(ws, options);
  ws.open();
  await rpc.opened;
  return { ws, rpc };
}

test('kit-message-probe factory default timeout is the ready-timeout magnitude', () => {
  assert.equal(KIT_PROBE_CDP_REQUEST_TIMEOUT_MS, 90_000);
});

test('kit-message-probe send() resolves a matching CDP result', async () => {
  const { ws, rpc } = await openSession();
  const pending = rpc.send('Runtime.evaluate', { expression: '__statsFull()' });
  assert.equal(ws.sent[0].method, 'Runtime.evaluate');
  ws.respond({ id: ws.sent[0].id, result: { result: { value: { pcs: [{}] } } } });
  assert.deepEqual(await pending, { result: { value: { pcs: [{}] } } });
});

test('kit-message-probe send() rejects on socket close and names the waiting method', async () => {
  const { ws, rpc } = await openSession();
  const pending = rpc.send('Runtime.evaluate', {
    expression: '__stats()',
    awaitPromise: true,
    returnByValue: true,
    replMode: false,
  });
  ws.close(1006);
  await assert.rejects(pending, (error) => {
    assert.match(error.message, /closed while waiting/i);
    assert.match(error.message, /Runtime\.evaluate/);
    return true;
  });
  assert.equal(rpc.pending.size, 0);
});

test('kit-message-probe close rejects every pending request and lists their methods', async () => {
  const { ws, rpc } = await openSession();
  const first = rpc.send('Runtime.evaluate');
  const second = rpc.send('Runtime.enable');
  ws.close();
  const expectBoth = (error) => {
    assert.match(error.message, /closed while waiting/i);
    assert.match(error.message, /Runtime\.evaluate/);
    assert.match(error.message, /Runtime\.enable/);
    return true;
  };
  await assert.rejects(first, expectBoth);
  await assert.rejects(second, expectBoth);
});

test('kit-message-probe send() times out and names the method', async () => {
  const { rpc } = await openSession({ requestTimeoutMs: 30 });
  await assert.rejects(rpc.send('Runtime.evaluate'), (error) => {
    assert.match(error.message, /Runtime\.evaluate/);
    assert.match(error.message, /timed out after 30ms/);
    return true;
  });
  assert.equal(rpc.pending.size, 0);
});
