// CDP JSON-RPC over WebSocket. Extracted so send() can be unit-tested without
// launching Chrome. Per-request timeout + close-reject so a dead socket cannot
// leave send() pending forever (issue #671 family, 2026-08-20).

export const RUNTIME_E2E_CDP_REQUEST_TIMEOUT_MS = 180_000;
export const KIT_PROBE_CDP_REQUEST_TIMEOUT_MS = 90_000;

function eventData(event) {
  if (event && typeof event === "object" && "data" in event) {
    return event.data;
  }
  return event;
}

export class CdpRpc {
  constructor(ws, options = {}) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.console = [];
    this.requestTimeoutMs = Number.isFinite(options.requestTimeoutMs)
      ? options.requestTimeoutMs
      : RUNTIME_E2E_CDP_REQUEST_TIMEOUT_MS;
    this.onConsole = typeof options.onConsole === "function" ? options.onConsole : null;
    this._closed = false;
    this._openedSettled = false;

    this.opened = new Promise((resolve, reject) => {
      this._resolveOpened = () => {
        if (this._openedSettled) return;
        this._openedSettled = true;
        resolve();
      };
      this._rejectOpened = (error) => {
        if (this._openedSettled) return;
        this._openedSettled = true;
        reject(error);
      };
    });
    // Constructor starts listening immediately; if close beats the first send(),
    // this extra handler keeps the rejection from becoming unhandled.
    this.opened.catch(() => {});

    this._addListener("open", () => this._resolveOpened(), { once: true });
    this._addListener("message", (event) => this._handleMessage(event));
    this._addListener("close", (event) => this._handleClose(event));
    this._addListener("error", (event) => this._handleError(event));
  }

  _addListener(type, handler, options = {}) {
    if (typeof this.ws.addEventListener === "function") {
      this.ws.addEventListener(type, handler, options);
      return;
    }
    this.ws[`on${type}`] = handler;
  }

  _handleMessage(event) {
    const payload = JSON.parse(eventData(event));
    if (payload.id && this.pending.has(payload.id)) {
      this._settle(payload.id, payload);
      return;
    }
    this.events.push(payload);
    if (payload.method === "Runtime.consoleAPICalled") {
      this.console.push(payload.params);
      if (this.onConsole) this.onConsole(payload.params);
    }
  }

  _settle(id, payload) {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    if (payload.error) {
      entry.reject(new Error(JSON.stringify(payload.error)));
    } else {
      entry.resolve(payload.result);
    }
  }

  _pendingMethods() {
    return [...this.pending.values()].map((entry) => entry.method);
  }

  _rejectAllPending(error) {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(error);
    }
  }

  _closeError(event, methods) {
    const methodList = methods.length > 0 ? methods.join(", ") : "(none)";
    const code = event && event.code !== undefined ? event.code : "unknown";
    return new Error(
      `CDP socket closed while waiting for a response (code=${code}). Still waiting: ${methodList}`,
    );
  }

  _handleClose(event) {
    this._closed = true;
    const error = this._closeError(event, this._pendingMethods());
    this._rejectOpened(error);
    this._rejectAllPending(error);
  }

  _handleError(event) {
    const error = event instanceof Error
      ? event
      : new Error("CDP WebSocket error");
    this._rejectOpened(error);
  }

  send(method, params = {}, options = {}) {
    // After open, register + transmit synchronously so a close in the same
    // turn still sees the request in `pending`. Before open, chain onto
    // `opened` instead of `async/await` so callers can hold the same Promise.
    if (!this._openedSettled) {
      return this.opened.then(() => this.send(method, params, options));
    }
    if (this._closed) {
      return Promise.reject(this._closeError({ code: "already-closed" }, [method]));
    }
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : this.requestTimeoutMs;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
}

export function createRuntimeE2eCdpRpc(ws, options = {}) {
  return new CdpRpc(ws, { requestTimeoutMs: RUNTIME_E2E_CDP_REQUEST_TIMEOUT_MS, ...options });
}

export function createKitProbeCdpRpc(ws, options = {}) {
  return new CdpRpc(ws, { requestTimeoutMs: KIT_PROBE_CDP_REQUEST_TIMEOUT_MS, ...options });
}
