// Checks the Cloudflare Access sign-in token on every request.
// Access puts a signed token (JWT) in the Cf-Access-Jwt-Assertion header after someone signs in
// with their email code. We check its signature against Access's public keys, that it's for
// this app (ACCESS_AUD), and that it hasn't expired — so the admin can't be reached by going
// around Access. Returns the signed-in email, or null.

let cachedKeys = null; // { team, keys, fetchedAt }

function base64UrlDecode(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function accessKeys(team) {
  if (cachedKeys && cachedKeys.team === team && Date.now() - cachedKeys.fetchedAt < 60 * 60 * 1000) return cachedKeys.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('Couldn\'t load Access keys');
  const { keys } = await res.json();
  cachedKeys = { team, keys, fetchedAt: Date.now() };
  return keys;
}

export async function verifyAccess(request, env) {
  // Only for `wrangler dev` on this Mac (set in worker/.dev.vars, never in production)
  if (env.ALLOW_UNAUTHENTICATED === 'true') return 'local-dev';
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;

  try {
    const [headerPart, payloadPart, signaturePart] = token.split('.');
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerPart)));
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));

    const jwk = (await accessKeys(env.ACCESS_TEAM_DOMAIN)).find((k) => k.kid === header.kid);
    if (!jwk || header.alg !== 'RS256') return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlDecode(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    );

    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const now = Date.now() / 1000;
    if (!valid || !audiences.includes(env.ACCESS_AUD) || payload.exp < now || payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) {
      return null;
    }
    return payload.email || 'signed-in';
  } catch (err) {
    return null;
  }
}
