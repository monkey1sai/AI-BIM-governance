import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createAuthProvider, createUserAuthProvider, IntranetDevAuthProvider } from "../src/services/authProvider.js";

describe("AuthProvider factories", () => {
  it("未知 service auth provider 會 fail fast，不回退到 intranet-dev", () => {
    expect(() => createAuthProvider(loadConfig({ externalIntakeAuthProvider: "typo-provider" }))).toThrow(
      /Unsupported EXTERNAL_INTAKE_AUTH_PROVIDER/,
    );
  });

  it("未知 user auth provider 會 fail fast，不回退到 local-dev", () => {
    expect(() => createUserAuthProvider(loadConfig({ userAuthProvider: "typo-provider" }))).toThrow(
      /Unsupported USER_AUTH_PROVIDER/,
    );
  });

  it("intranet-dev allowlist 支援 Docker bridge CIDR", () => {
    const provider = new IntranetDevAuthProvider("dev-webhook-secret", ["172.16.0.0/12"]);
    const context = provider.authenticate({
      clientIp: "::ffff:172.18.0.2",
      rawBody: "{}",
      headers: {
        "x-webhook-secret": "dev-webhook-secret",
        "x-correlation-id": "corr_docker_001",
        "x-idempotency-key": "idem_docker_001",
      },
      payloadIdentity: {
        tenant_id: "tenant_demo_001",
        project_id: "project_demo_001",
        external_model_version_id: "ext_mv_demo_001",
      },
    });

    expect(context.correlationId).toBe("corr_docker_001");
  });
});
