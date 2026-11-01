import { createSign, generateKeyPairSync } from 'node:crypto';

// A made-up Clerk frontend API host. Nothing is ever requested from it.
const HOST = 'stacks-test.clerk.accounts.dev';

type Claims = Record<string, unknown>;
type KeyPair = { publicKey: string; privateKey: string };
type App = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

// 2048 bits: Clerk's PEM loader rejects other RSA sizes.
function keypair(): KeyPair {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function sign(privateKey: string, claims: Claims) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'ins_test' })}.${encode(claims)}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');
  return `${unsigned}.${signature}`;
}

/** A Clerk-shaped session token's claims, valid for a minute, with overrides merged. */
export function sessionClaims(userId: string, overrides: Claims = {}): Claims {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: userId,
    sid: 'sess_test',
    iat: now,
    nbf: now - 5,
    exp: now + 60,
    iss: `https://${HOST}`,
    azp: 'http://localhost:8081',
    ...overrides,
  };
}

/** A signer for a key the API doesn't trust. */
export function createSigner() {
  const { privateKey } = keypair();
  return (userId: string, overrides?: Claims) => sign(privateKey, sessionClaims(userId, overrides));
}

// One trusted key per process: bun:test shares this module across files.
let trusted: KeyPair | undefined;

/**
 * Points Clerk's middleware at a local keypair so verification runs for real with
 * no account or network, and returns a signer for that key. Idempotent.
 */
export function setupTestAuth() {
  trusted ??= keypair();
  const { privateKey, publicKey } = trusted;
  process.env.CLERK_JWT_KEY = publicKey;
  process.env.CLERK_SECRET_KEY = 'sk_test_local';
  // Clerk parses the publishable key: pk_test_ plus base64 of "<frontend-api-host>$".
  process.env.CLERK_PUBLISHABLE_KEY = `pk_test_${Buffer.from(`${HOST}$`).toString('base64')}`;
  process.env.CLERK_TELEMETRY_DISABLED = '1';
  delete process.env.DEV_AUTH_USER_ID;
  const signSessionToken = (userId: string, overrides?: Claims) =>
    sign(privateKey, sessionClaims(userId, overrides));
  return {
    signSessionToken,
    /** A request as `userId`, with a JSON content type when there's a body. */
    as(app: App, userId: string, path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${signSessionToken(userId)}`);
      if (init.body !== undefined && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      return app.request(path, { ...init, headers });
    },
  };
}
