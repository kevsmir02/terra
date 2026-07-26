export function measureEager(distDir: string): {
  entry: string;
  chunks: { file: string; gzip: number }[];
  totalGzip: number;
}[];

export function readBudgets(rootDir?: string): Record<string, number>;
