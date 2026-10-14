// The management API client (docs/management-api.yaml): JSON, Bearer personal access token, one error shape.

export class ApiError extends Error {
  constructor(status, code, message, body) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export class Api {
  /** @param {{ url: string, token?: string|null, fetch?: typeof fetch, userAgent?: string }} options */
  constructor({ url, token = null, fetch: fetchImpl = globalThis.fetch, userAgent = 'runomine-cli' }) {
    this.url = url.replace(/\/+$/, '');
    this.token = token;
    this.fetch = fetchImpl;
    this.userAgent = userAgent;
  }

  async request(method, path, { query, body, auth = true } = {}) {
    const url = new URL(`${this.url}/api/v1${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === null || v === '') continue;
      for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(Array.isArray(v) ? `${k}[]` : k, String(item));
    }
    const headers = { Accept: 'application/json', 'User-Agent': this.userAgent };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      if (!this.token) throw new ApiError(401, 'unauthenticated', 'Not logged in. Run `runomine login` first.');
      headers.Authorization = `Bearer ${this.token}`;
    }
    let response;
    try {
      response = await this.fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (err) {
      throw new ApiError(0, 'network_error', `Can't reach ${this.url} (${err.cause?.code ?? err.message}).`);
    }
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const error = data?.error;
      const message = (typeof error === 'object' ? error?.message : null) ?? data?.message ?? `${response.status} ${response.statusText}`;
      const code = (typeof error === 'object' ? error?.code : error) ?? 'error';
      const err = new ApiError(response.status, code, message, data);
      if (response.status === 401 && auth) err.message = `${message} Run \`runomine login\`.`;
      throw err;
    }
    return data;
  }

  get(path, query) {
    return this.request('GET', path, { query });
  }

  post(path, body = {}) {
    return this.request('POST', path, { body });
  }

  patch(path, body = {}) {
    return this.request('PATCH', path, { body });
  }

  delete(path, body) {
    return this.request('DELETE', path, { body });
  }

  // The device login (RFC 8628): no token yet.
  startDevice(deviceName) {
    return this.request('POST', '/auth/device', { body: { device_name: deviceName }, auth: false });
  }

  pollDevice(deviceCode) {
    return this.request('POST', '/auth/token', { body: { device_code: deviceCode }, auth: false });
  }
}

/** The person's sites, and one of them by id, slug, name or domain (like the MCP tools). */
export async function listSites(api) {
  return (await api.get('/sites')).data;
}

export function matchSite(sites, ref) {
  if (!ref) return { site: null, matches: [] };
  const needle = String(ref).trim().toLowerCase();
  const host = needle.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const byId = sites.find((s) => s.id === needle);
  if (byId) return { site: byId, matches: [byId] };
  const matches = sites.filter((s) => [s.slug?.toLowerCase(), s.name?.toLowerCase()].includes(needle) || (s.domain && s.domain.toLowerCase().replace(/^www\./, '') === host));
  return { site: matches.length === 1 ? matches[0] : null, matches };
}
