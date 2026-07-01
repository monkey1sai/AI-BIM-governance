declare const process: {
  cwd(): string;
};

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}

declare module "node:path" {
  const path: {
    join(...paths: string[]): string;
    resolve(...paths: string[]): string;
  };
  export default path;
  export function resolve(...paths: string[]): string;
}
