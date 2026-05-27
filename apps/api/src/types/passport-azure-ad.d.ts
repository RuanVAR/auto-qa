/**
 * Minimal ambient typing for passport-azure-ad. We're using just the
 * OIDCStrategy export — full Microsoft-authored types live on npm as
 * @types/passport-azure-ad@4.3.6, but Docker dev containers run with a
 * cached pnpm store that doesn't always pick up host-side type additions.
 * Stub these so the API compiles in-container; the runtime behaviour is
 * defined entirely by the JS package.
 */
declare module 'passport-azure-ad' {
  // The OIDCStrategy constructor signature is large; we type its options
  // loosely because passport-azure-ad's own runtime ignores unknown fields.
  interface OIDCStrategyOptions {
    identityMetadata: string;
    clientID: string;
    clientSecret?: string;
    redirectUrl: string;
    responseType?: 'code' | 'id_token' | 'id_token code';
    responseMode?: 'query' | 'form_post';
    scope?: string | string[];
    validateIssuer?: boolean;
    issuer?: string | string[];
    passReqToCallback?: boolean;
    loggingLevel?: 'info' | 'warn' | 'error';
    allowHttpForRedirectUrl?: boolean;
    nonceLifetime?: number;
    nonceMaxAmount?: number;
    useCookieInsteadOfSession?: boolean;
    cookieEncryptionKeys?: { key: string; iv: string }[];
    clockSkew?: number;
  }

  export interface IProfile {
    sub?: string;
    oid?: string;
    upn?: string;
    displayName?: string;
    name?: { familyName?: string; givenName?: string };
    emails?: string[];
    _json?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export type VerifyCallback = (err: Error | null | undefined, user?: unknown, info?: unknown) => void;
  export type VerifyOIDC = (profile: IProfile, done: VerifyCallback) => void;

  // The class is what passport-azure-ad exports. We extend nothing because
  // PassportStrategy(OIDCStrategy, 'name') needs only its constructor +
  // authenticate method, both of which the runtime supplies.
  export class OIDCStrategy {
    constructor(options: OIDCStrategyOptions, verify: VerifyOIDC);
    authenticate(req: unknown, options?: unknown): void;
    name: string;
  }
}
