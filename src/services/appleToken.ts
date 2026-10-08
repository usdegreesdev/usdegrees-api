import { jwtVerify, createRemoteJWKSet, JWTPayload } from "jose";

export const APPLE_ISSUER = "https://appleid.apple.com";

// createRemoteJWKSet caches the JWKS response internally and re-fetches
// on a `kid` cache miss, so no separate caching layer is needed here.
const appleJwks = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

/** Verifies an Apple identity token against Apple's JWKS. Throws on failure. */
export async function verifyAppleIdToken(
  idToken: string,
  audience: string,
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(idToken, appleJwks, {
    issuer: APPLE_ISSUER,
    audience,
  });
  return payload;
}
