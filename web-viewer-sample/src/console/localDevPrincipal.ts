// Local-dev/lab-only identity carrier shared by Console consumers in one page
// runtime. It is intentionally ephemeral: never persist it, place it in a URL,
// or render/log it. Production identity remains an external SSO/OIDC concern.
let localDevUserCarrier: string | null = null;

function newOpaqueSuffix(): string {
  type CryptoWithOptionalRandomUuid = Omit<Crypto, "randomUUID"> & {
    randomUUID?: () => string;
  };
  const cryptoApi = globalThis.crypto as CryptoWithOptionalRandomUuid | undefined;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  if (cryptoApi) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("Secure randomness is unavailable for the local-dev principal carrier.");
}

export function getLocalDevUserCarrier(): string {
  if (!localDevUserCarrier) {
    localDevUserCarrier = `edge_console_operator_${newOpaqueSuffix()}`;
  }
  return localDevUserCarrier;
}

// Test-only reset seam. Production callers must not rotate the carrier while a
// viewer lease or scoped A4 request is active in the same Console runtime.
export function __resetLocalDevUserCarrierForTests(): void {
  localDevUserCarrier = null;
}
