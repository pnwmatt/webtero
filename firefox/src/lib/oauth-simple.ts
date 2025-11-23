/**
 * OAuthSimple - A simpler version of OAuth
 *
 * Original author: jr conlin (src@anticipatr.com)
 * Copyright (c) 2010, unitedHeroes.net
 * BSD License - see original source for full license text
 *
 * TypeScript port for Webtero extension
 */

export interface OAuthSignatures {
  consumer_key?: string;
  shared_secret?: string;
  api_key?: string;
  access_token?: string;
  access_secret?: string;
  oauth_token?: string;
  oauth_secret?: string;
  oauth_token_secret?: string;
}

export interface OAuthSignResult {
  parameters: Record<string, string>;
  signature: string;
  signed_url: string;
  header: string;
}

export interface OAuthSignArgs {
  action?: string;
  path?: string;
  method?: string;
  signatures?: OAuthSignatures;
  parameters?: string | Record<string, string>;
}

export class OAuthSimple {
  private _secrets: Record<string, string> = {};
  private _default_signature_method = 'HMAC-SHA1';
  private _action = 'GET';
  private _nonce_chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  private _parameters: Record<string, string | string[]> = {};
  private _path?: string;

  constructor(consumerKey?: string, sharedSecret?: string) {
    if (consumerKey !== undefined) {
      this._secrets['consumer_key'] = consumerKey;
    }
    if (sharedSecret !== undefined) {
      this._secrets['shared_secret'] = sharedSecret;
    }
  }

  reset(): this {
    this._parameters = {};
    this._path = undefined;
    return this;
  }

  setParameters(parameters?: string | Record<string, string>): this {
    if (parameters === undefined) {
      parameters = {};
    }
    if (typeof parameters === 'string') {
      parameters = this._parseParameterString(parameters);
    }
    this._parameters = this._merge(parameters, this._parameters as Record<string, string>);

    if (this._parameters['oauth_nonce'] === undefined) {
      this._getNonce();
    }
    if (this._parameters['oauth_timestamp'] === undefined) {
      this._getTimestamp();
    }
    if (this._parameters['oauth_signature_method'] === undefined) {
      this.setSignatureMethod();
    }
    if (this._parameters['oauth_consumer_key'] === undefined) {
      this._getApiKey();
    }
    if (this._parameters['oauth_token'] === undefined) {
      this._getAccessToken();
    }
    if (this._parameters['oauth_version'] === undefined) {
      this._parameters['oauth_version'] = '1.0';
    }

    return this;
  }

  setQueryString(parameters?: string | Record<string, string>): this {
    return this.setParameters(parameters);
  }

  setURL(path: string): this {
    if (path === '') {
      throw new Error('No path specified for OAuthSimple.setURL');
    }
    this._path = path;
    return this;
  }

  setPath(path: string): this {
    return this.setURL(path);
  }

  setAction(action?: string): this {
    if (action === undefined) {
      action = 'GET';
    }
    action = action.toUpperCase();
    if (action.match(/[^A-Z]/)) {
      throw new Error('Invalid action specified for OAuthSimple.setAction');
    }
    this._action = action;
    return this;
  }

  signatures(sigs?: OAuthSignatures): this {
    if (sigs) {
      this._secrets = this._merge(sigs as Record<string, string>, this._secrets);
    }
    // Aliases
    if (this._secrets['api_key']) {
      this._secrets.consumer_key = this._secrets.api_key;
    }
    if (this._secrets['access_token']) {
      this._secrets.oauth_token = this._secrets.access_token;
    }
    if (this._secrets['access_secret']) {
      this._secrets.oauth_secret = this._secrets.access_secret;
    }
    if (this._secrets['oauth_token_secret']) {
      this._secrets.oauth_secret = this._secrets.oauth_token_secret;
    }
    // Gauntlet
    if (this._secrets.consumer_key === undefined) {
      throw new Error('Missing required consumer_key in OAuthSimple.signatures');
    }
    if (this._secrets.shared_secret === undefined) {
      throw new Error('Missing required shared_secret in OAuthSimple.signatures');
    }
    if (this._secrets.oauth_token !== undefined && this._secrets.oauth_secret === undefined) {
      throw new Error('Missing oauth_secret for supplied oauth_token in OAuthSimple.signatures');
    }
    return this;
  }

  setTokensAndSecrets(sigs?: OAuthSignatures): this {
    return this.signatures(sigs);
  }

  setSignatureMethod(method?: string): this {
    if (method === undefined) {
      method = this._default_signature_method;
    }
    if (!method.toUpperCase().match(/(PLAINTEXT|HMAC-SHA1)/)) {
      throw new Error('Unknown signing method specified for OAuthSimple.setSignatureMethod');
    }
    this._parameters['oauth_signature_method'] = method.toUpperCase();
    return this;
  }

  sign(args?: OAuthSignArgs): OAuthSignResult {
    if (args === undefined) {
      args = {};
    }
    if (args.action !== undefined) {
      this.setAction(args.action);
    }
    if (args.path !== undefined) {
      this.setPath(args.path);
    }
    if (args.method !== undefined) {
      this.setSignatureMethod(args.method);
    }
    this.signatures(args.signatures);
    this.setParameters(args.parameters);

    const normParams = this._normalizedParameters();
    this._parameters['oauth_signature'] = this._generateSignature(normParams);

    return {
      parameters: this._parameters as Record<string, string>,
      signature: this._oauthEscape(this._parameters['oauth_signature'] as string),
      signed_url: this._path + '?' + this._normalizedParameters(),
      header: this.getHeaderString(),
    };
  }

  getHeaderString(args?: OAuthSignArgs): string {
    if (this._parameters['oauth_signature'] === undefined) {
      this.sign(args);
    }

    let result = 'OAuth ';
    for (const pName in this._parameters) {
      if (!pName.match(/^oauth/)) {
        continue;
      }
      const pValue = this._parameters[pName];
      if (Array.isArray(pValue)) {
        for (const val of pValue) {
          result += pName + '="' + this._oauthEscape(val) + '" ';
        }
      } else {
        result += pName + '="' + this._oauthEscape(pValue) + '" ';
      }
    }
    return result.trim();
  }

  // Private methods

  private _parseParameterString(paramString: string): Record<string, string> {
    const elements = paramString.split('&');
    const result: Record<string, string> = {};

    for (const element of elements) {
      if (!element) continue;
      const keyToken = element.split('=');
      const value = keyToken[1] ? decodeURIComponent(keyToken[1]) : '';
      result[keyToken[0]] = value;
    }
    return result;
  }

  private _oauthEscape(str?: string): string {
    if (str === undefined) {
      return '';
    }
    return encodeURIComponent(str)
      .replace(/!/g, '%21')
      .replace(/\*/g, '%2A')
      .replace(/'/g, '%27')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29');
  }

  private _getNonce(length = 5): string {
    let result = '';
    const cLength = this._nonce_chars.length;
    for (let i = 0; i < length; i++) {
      const rnum = Math.floor(Math.random() * cLength);
      result += this._nonce_chars.substring(rnum, rnum + 1);
    }
    this._parameters['oauth_nonce'] = result;
    return result;
  }

  private _getApiKey(): string {
    if (this._secrets.consumer_key === undefined) {
      throw new Error('No consumer_key set for OAuthSimple.');
    }
    this._parameters['oauth_consumer_key'] = this._secrets.consumer_key;
    return this._secrets.consumer_key;
  }

  private _getAccessToken(): string {
    if (this._secrets['oauth_secret'] === undefined) {
      return '';
    }
    if (this._secrets['oauth_token'] === undefined) {
      throw new Error('No oauth_token (access_token) set for OAuthSimple.');
    }
    this._parameters['oauth_token'] = this._secrets.oauth_token;
    return this._secrets.oauth_token;
  }

  private _getTimestamp(): number {
    const ts = Math.floor(Date.now() / 1000);
    this._parameters['oauth_timestamp'] = ts.toString();
    return ts;
  }

  private _b64HmacSha1(k: string, d: string): string {
    // HMAC-SHA1 implementation
    const _z = 8;
    const _p = '=';

    function _f(t: number, b: number, c: number, d: number): number {
      if (t < 20) return (b & c) | (~b & d);
      if (t < 40) return b ^ c ^ d;
      if (t < 60) return (b & c) | (b & d) | (c & d);
      return b ^ c ^ d;
    }

    function _k(t: number): number {
      return t < 20 ? 1518500249 : t < 40 ? 1859775393 : t < 60 ? -1894007588 : -899497514;
    }

    function _s(x: number, y: number): number {
      const l = (x & 0xffff) + (y & 0xffff);
      const m = (x >> 16) + (y >> 16) + (l >> 16);
      return (m << 16) | (l & 0xffff);
    }

    function _r(n: number, c: number): number {
      return (n << c) | (n >>> (32 - c));
    }

    function _c(x: number[], l: number): number[] {
      x[l >> 5] |= 0x80 << (24 - (l % 32));
      x[((((l + 64) >> 9) << 4) + 15)] = l;
      const w: number[] = new Array(80);
      let a = 1732584193,
        b = -271733879,
        c = -1732584194,
        d = 271733878,
        e = -1009589776;

      for (let i = 0; i < x.length; i += 16) {
        const o = a,
          p = b,
          q = c,
          r = d,
          s = e;
        for (let j = 0; j < 80; j++) {
          if (j < 16) {
            w[j] = x[i + j];
          } else {
            w[j] = _r(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
          }
          const t = _s(_s(_r(a, 5), _f(j, b, c, d)), _s(_s(e, w[j]), _k(j)));
          e = d;
          d = c;
          c = _r(b, 30);
          b = a;
          a = t;
        }
        a = _s(a, o);
        b = _s(b, p);
        c = _s(c, q);
        d = _s(d, r);
        e = _s(e, s);
      }
      return [a, b, c, d, e];
    }

    function _b(s: string): number[] {
      const b: number[] = [];
      const m = (1 << _z) - 1;
      for (let i = 0; i < s.length * _z; i += _z) {
        b[i >> 5] |= (s.charCodeAt(i / 8) & m) << (32 - _z - (i % 32));
      }
      return b;
    }

    function _h(k: string, d: string): number[] {
      let b = _b(k);
      if (b.length > 16) {
        b = _c(b, k.length * _z);
      }
      const p: number[] = new Array(16);
      const o: number[] = new Array(16);
      for (let i = 0; i < 16; i++) {
        p[i] = (b[i] || 0) ^ 0x36363636;
        o[i] = (b[i] || 0) ^ 0x5c5c5c5c;
      }
      const h = _c(p.concat(_b(d)), 512 + d.length * _z);
      return _c(o.concat(h), 512 + 160);
    }

    function _n(b: number[]): string {
      const t = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let s = '';
      for (let i = 0; i < b.length * 4; i += 3) {
        const r =
          (((b[i >> 2] >> (8 * (3 - (i % 4)))) & 0xff) << 16) |
          (((b[(i + 1) >> 2] >> (8 * (3 - ((i + 1) % 4)))) & 0xff) << 8) |
          ((b[(i + 2) >> 2] >> (8 * (3 - ((i + 2) % 4)))) & 0xff);
        for (let j = 0; j < 4; j++) {
          if (i * 8 + j * 6 > b.length * 32) {
            s += _p;
          } else {
            s += t.charAt((r >> (6 * (3 - j))) & 0x3f);
          }
        }
      }
      return s;
    }

    return _n(_h(k, d));
  }

  private _normalizedParameters(): string {
    const elements: string[] = [];
    const paramNames: string[] = [];

    for (const paramName in this._parameters) {
      paramNames.push(paramName);
    }
    paramNames.sort();

    for (const paramName of paramNames) {
      // Skip secrets
      if (paramName.match(/\w+_secret/)) {
        continue;
      }
      const pValue = this._parameters[paramName];
      if (Array.isArray(pValue)) {
        const sorted = [...pValue].sort();
        for (const val of sorted) {
          elements.push(this._oauthEscape(paramName) + '=' + this._oauthEscape(val));
        }
      } else {
        elements.push(this._oauthEscape(paramName) + '=' + this._oauthEscape(pValue));
      }
    }
    return elements.join('&');
  }

  private _generateSignature(_normParams: string): string {
    const secretKey =
      this._oauthEscape(this._secrets.shared_secret) +
      '&' +
      this._oauthEscape(this._secrets.oauth_secret);

    if (this._parameters['oauth_signature_method'] === 'PLAINTEXT') {
      return secretKey;
    }
    if (this._parameters['oauth_signature_method'] === 'HMAC-SHA1') {
      const sigString =
        this._oauthEscape(this._action) +
        '&' +
        this._oauthEscape(this._path || '') +
        '&' +
        this._oauthEscape(this._normalizedParameters());
      return this._b64HmacSha1(secretKey, sigString);
    }
    return '';
  }

  private _merge<T extends Record<string, unknown>>(source: T, target: T): T {
    const result = { ...target };
    for (const key in source) {
      result[key] = source[key];
    }
    return result;
  }
}
