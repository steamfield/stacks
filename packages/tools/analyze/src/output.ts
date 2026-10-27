export type Writers = {
  readonly stdout: (text: string) => void | Promise<void>;
  readonly stderr: (text: string) => void | Promise<void>;
};

export const defaultWriters: Writers = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
};
