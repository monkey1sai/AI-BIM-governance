export function resolveBimControlBase(
    queryCoordinatorApiBase: string | null,
    envCoordinatorApiBase: string,
): string {
    return queryCoordinatorApiBase || envCoordinatorApiBase;
}
