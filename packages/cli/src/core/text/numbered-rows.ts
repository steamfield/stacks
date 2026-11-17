export const numberedRows = (labels: ReadonlyArray<string>) =>
  labels.map((label, index) => `  ${index + 1}) ${label}`);
