export interface USDAsset {
    name: string;
    url: string;
}

export const ASSETS_ENDPOINT = "/api/assets";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isUSDAsset(value: unknown): value is USDAsset {
    return (
        isRecord(value) &&
        typeof value.name === "string" &&
        value.name.trim().length > 0 &&
        typeof value.url === "string" &&
        value.url.trim().length > 0
    );
}

export function normalizeUSDAssetsResponse(response: unknown): USDAsset[] {
    const rawAssets = Array.isArray(response)
        ? response
        : isRecord(response) && Array.isArray(response.assets)
          ? response.assets
          : [];

    return rawAssets
        .filter(isUSDAsset)
        .map((asset) => ({
            name: asset.name.trim(),
            url: asset.url.trim(),
        }));
}

export async function fetchUSDAssets(fetchImpl: typeof fetch = fetch): Promise<USDAsset[]> {
    const response = await fetchImpl(ASSETS_ENDPOINT, {
        headers: {
            Accept: "application/json",
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch USD assets: ${response.status}`);
    }

    return normalizeUSDAssetsResponse(await response.json());
}
