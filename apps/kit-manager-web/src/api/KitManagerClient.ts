import { CloseResponse, HealthResponse, KitInstanceState, OpenResponse, UsdcArtifact } from "../models";

export class KitManagerClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async listUsdc(): Promise<UsdcArtifact[]> {
    const response = await fetch(`${this.baseUrl}/api/kit/usdc`);
    this.assertOk(response);
    const body = await response.json();
    return body.items ?? [];
  }

  async getHealth(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/api/kit/health`);
    this.assertOk(response);
    return response.json();
  }

  async getCurrentInstance(): Promise<KitInstanceState> {
    const response = await fetch(`${this.baseUrl}/api/kit/instances/current`);
    this.assertOk(response);
    return response.json();
  }

  async openSelected(artifactIds: string[], operatorToken: string): Promise<OpenResponse> {
    const response = await fetch(`${this.baseUrl}/api/kit/instances/current/open`, {
      method: "POST",
      headers: this.mutationHeaders(operatorToken),
      body: JSON.stringify({artifact_ids: artifactIds, replace_existing: true})
    });
    this.assertOk(response);
    return response.json();
  }

  async closeInstance(operatorToken: string): Promise<CloseResponse> {
    const response = await fetch(`${this.baseUrl}/api/kit/instances/current/close`, {
      method: "POST",
      headers: this.mutationHeaders(operatorToken)
    });
    this.assertOk(response);
    return response.json();
  }

  private assertOk(response: Response): void {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  }

  private mutationHeaders(operatorToken: string): Record<string, string> {
    const token = operatorToken.trim();
    if (!token) {
      throw new Error("Operator token is required for Kit mutations.");
    }
    return {"Content-Type": "application/json", "x-operator-token": token};
  }
}
