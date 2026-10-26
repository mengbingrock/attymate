import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface GoogleIdentity {
  readonly sub: string;
  readonly email: string;
  readonly name: string;
}

export interface GoogleSignInProvider {
  authorizationUrl(input: { state: string; nonce: string; verifier: string }): string;
  exchange(input: { code: string; nonce: string; verifier: string }): Promise<GoogleIdentity>;
}

export interface GoogleSignInConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Google tokens are verified on the relay; they never become application session cookies. */
export const createGoogleSignInProvider = (
  config: GoogleSignInConfig,
  redirectUri: string
): GoogleSignInProvider => {
  const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  return {
    authorizationUrl({ state, nonce, verifier }) {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      }).toString();
      return url.href;
    },
    async exchange({ code, nonce, verifier }) {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('Google sign-in could not be completed. Try again.');
      const tokens = (await response.json()) as { id_token?: unknown };
      if (typeof tokens.id_token !== 'string')
        throw new Error('Google did not verify this sign-in.');
      const { payload } = await jwtVerify(tokens.id_token, keys, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: config.clientId,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'iat', 'nonce', 'email', 'email_verified'],
        clockTolerance: 30,
        maxTokenAge: '10m',
      });
      if (
        payload.nonce !== nonce ||
        payload.email_verified !== true ||
        typeof payload.email !== 'string' ||
        !payload.sub ||
        (payload.azp !== undefined && payload.azp !== config.clientId)
      )
        throw new Error('Google did not verify this sign-in.');
      return {
        sub: payload.sub,
        email: payload.email.toLowerCase(),
        name: typeof payload.name === 'string' ? payload.name : payload.email,
      };
    },
  };
};
