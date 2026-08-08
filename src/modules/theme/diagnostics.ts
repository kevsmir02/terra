export type Diagnostic = {
  severity: "error" | "warning";
  path: string;
  message: string;
};
