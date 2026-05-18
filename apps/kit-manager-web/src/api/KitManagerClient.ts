import { CloseResponse, HealthResponse, KitInstanceState, OpenResponse, UsdcArtifact } from "../models";

export class KitManagerClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async listUsdc(): Promise<UsdcArtifact[]> {
    const response = await fetch(`${this.baseUrl}/api/usdc`);
    this.assertOk(response);
    const body = await response.json();
    return body.items ?? [];
  }

  async getHealth(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`);
    this.assertOk(response);
    return response.json();
  }

  async getCurrentInstance(): Promise<KitInstanceState> {
    const response = await fetch(`${this.baseUrl}/api/kit/instances/current`);
    this.assertOk(response);
    return response.json();
  }

  async openSelected(artifactIds: string[]): Promise<OpenResponse> {
    const response = await fetch(`${this.baseUrl}/api/kit/instances/current/open`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({artifact_ids: artifactIds, replace_existing: true})
    });
    this.assertOk(response);
    return response.json();
  }

  async closeInstance(): Promise<CloseResponse> {
    const response = await fetch(`${this.baseUrl}/api/kit/instances/current/close`, {method: "POST"});
    this.assertOk(response);
    return response.json();
  }

  private assertOk(response: Response): void {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  }
}
