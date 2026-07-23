import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetLocalDevUserCarrierForTests,
  getLocalDevUserCarrier,
} from "./localDevPrincipal";

afterEach(() => {
  __resetLocalDevUserCarrierForTests();
  vi.restoreAllMocks();
});

describe("local-dev principal carrier", () => {
  it("is one ephemeral in-memory carrier for the current console runtime", () => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");

    const first = getLocalDevUserCarrier();
    const second = getLocalDevUserCarrier();

    expect(first).toBe(second);
    expect(first).toMatch(/^edge_console_operator_[A-Za-z0-9-]+$/);
    expect(storageWrite).not.toHaveBeenCalled();
  });
});
