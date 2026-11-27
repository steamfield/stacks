/**
 * The SPKI PEM Ed25519 keys a released CLI trusts for the official index. `stacks-index-2026a`
 * signs releases; `stacks-index-2026b` is the offline backup that replaces it if it's lost or
 * leaked. The private halves never enter this repository.
 */
export const INDEX_PUBLIC_KEYS: ReadonlyArray<{
  readonly keyId: string;
  readonly publicKey: string;
}> = [
  {
    keyId: "stacks-index-2026a",
    publicKey:
      "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA+dv5JLtu852T3/YUymkF8zMNQTC8zybd9H8XRbK8RUI=\n-----END PUBLIC KEY-----\n",
  },
  {
    keyId: "stacks-index-2026b",
    publicKey:
      "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAVJfDAAzOKhk4ELH4MONHGeEadSnShi34qtQoibFq7+w=\n-----END PUBLIC KEY-----\n",
  },
];
