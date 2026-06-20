/**
 * Keenable REST client for the n8n node.
 *
 * Mirrors the contract used by the other Keenable integrations (langchain, Pi,
 * OpenClaw): keyless by default (`/v1/*\/public`), authenticated when a key is
 * present (`/v1/*`), HTTPS-only base URL, `X-Keenable-Title` attribution. The
 * REST surface is an internal detail of this package — n8n users go through the
 * Keenable node's Search / Fetch operations, never raw REST.
 *
 * Unlike the env-driven Pi client, configuration (api key + base URL) arrives
 * from the node's n8n credentials. No third-party runtime deps: global `fetch`.
 */

import { isIP } from 'node:net';

/** Manual version tag (kept in sync with package.json) used for the User-Agent. */
export const KEENABLE_N8N_VERSION = '0.1.0';

const DEFAULT_BASE_URL = 'https://api.keenable.ai';

// Traffic attribution: the Keenable backend segments adoption by this header.
const ATTRIBUTION_TITLE = 'n8n';
const USER_AGENT = `keenable-n8n/${KEENABLE_N8N_VERSION}`;

const DEFAULT_TIMEOUT_MS = 30_000;

export interface KeenableConfig {
	/** Optional API key. Absent/blank → keyless public tier. */
	apiKey?: string;
	/** Optional base-URL override. Must be HTTPS (http only for loopback). */
	baseUrl?: string;
}

export interface KeenableSearchResult {
	title?: string;
	url?: string;
	description?: string;
	published_at?: string;
	acquired_at?: string;
	[key: string]: unknown;
}

export interface KeenableSearchParams {
	query: string;
	mode?: 'pro' | 'realtime';
	site?: string;
	published_after?: string;
	published_before?: string;
	acquired_after?: string;
	acquired_before?: string;
}

export interface KeenableFetchResult {
	url?: string;
	title?: string;
	content?: string;
	description?: string;
	author?: string;
	published_at?: string;
	[key: string]: unknown;
}

/**
 * Carries a user-actionable message (rate limits, auth, bad input) so the node
 * can surface it as a clean NodeApiError instead of an opaque crash.
 */
export class KeenableError extends Error {}

/** Resolve the API base URL, enforcing HTTPS (http only for loopback). */
function resolveBaseUrl(config: KeenableConfig): string {
	const base = (config.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/u, '');
	let parsed: URL;
	try {
		parsed = new URL(base);
	} catch {
		throw new KeenableError(`Keenable base URL must be a valid URL with a host, got ${base}`);
	}
	if (parsed.hostname) {
		if (parsed.protocol === 'https:') return base;
		// Plain http only for local development against a loopback host.
		if (
			parsed.protocol === 'http:' &&
			['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
		) {
			return base;
		}
	}
	throw new KeenableError(`Keenable base URL must be an https:// URL with a host, got ${base}`);
}

/** Non-blank API key, or undefined to use the keyless public tier. */
function resolveApiKey(config: KeenableConfig): string | undefined {
	const key = (config.apiKey ?? '').trim();
	return key || undefined;
}

function buildHeaders(apiKey: string | undefined): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: 'application/json',
		'User-Agent': USER_AGENT,
		'X-Keenable-Title': ATTRIBUTION_TITLE,
	};
	if (apiKey) headers['X-API-Key'] = apiKey;
	return headers;
}

function withTimeout(timeoutMs: number): AbortSignal {
	return AbortSignal.timeout(timeoutMs);
}

function isPrivateIp(host: string): boolean {
	const v = isIP(host);
	if (v === 4) {
		const p = host.split('.').map(Number);
		return (
			p[0] === 10 ||
			p[0] === 127 ||
			p[0] === 0 ||
			(p[0] === 169 && p[1] === 254) || // link-local
			(p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
			(p[0] === 192 && p[1] === 168) ||
			(p[0] === 100 && p[1] >= 64 && p[1] <= 127) || // CGNAT 100.64.0.0/10
			(p[0] === 198 && (p[1] === 18 || p[1] === 19)) || // benchmarking 198.18.0.0/15
			p[0] >= 224 // multicast/reserved
		);
	}
	if (v === 6) {
		const h = host.toLowerCase();
		return h === '::1' || h === '::' || h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd');
	}
	return false;
}

/**
 * Refuse obviously private/internal fetch targets before sending (SSRF). The
 * backend enforces this server-side too; the client guard avoids leaking an
 * internal hostname and is required by the integration contract.
 */
function assertPublicFetchTarget(rawUrl: string): void {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new KeenableError(`Not a valid URL: ${rawUrl}`);
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new KeenableError(`Refusing to fetch a non-http(s) URL: ${rawUrl}`);
	}
	const host = (parsed.hostname || '').toLowerCase();
	if (!host) throw new KeenableError(`Refusing to fetch a URL with no host: ${rawUrl}`);
	if (host === 'localhost' || host === 'metadata.google.internal' || isPrivateIp(host)) {
		throw new KeenableError(`Refusing to fetch a private/internal host: ${host}`);
	}
}

/** Map a non-2xx response to a helpful KeenableError; keyless 429 → upgrade hint. */
async function raiseForStatus(response: Response, keyed: boolean): Promise<void> {
	if (response.ok) return;
	if (!keyed && response.status === 429) {
		throw new KeenableError(
			'Keenable keyless requests hit their rate limit. Add a Keenable API credential ' +
				'(create a key at https://keenable.ai/console) to raise the limits.',
		);
	}
	let detail = '';
	try {
		const body = (await response.json()) as Record<string, unknown>;
		detail = String(body.message ?? body.error ?? body.detail ?? '');
	} catch {
		detail = (await response.text().catch(() => '')).trim();
	}
	const label =
		{
			401: 'Keenable authentication failed (401)',
			402: 'Keenable: insufficient credits (402)',
			429: 'Keenable rate limit exceeded (429)',
		}[response.status] ?? `Keenable API error (${response.status})`;
	throw new KeenableError(detail ? `${label}: ${detail}` : label);
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
	let data: unknown;
	try {
		data = await response.json();
	} catch {
		throw new KeenableError('Keenable API returned a non-JSON response.');
	}
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		throw new KeenableError('Unexpected (non-object) response from the Keenable API.');
	}
	return data as Record<string, unknown>;
}

/** POST /v1/search (keyed) or /v1/search/public (keyless). */
export async function keenableSearch(
	config: KeenableConfig,
	params: KeenableSearchParams,
): Promise<KeenableSearchResult[]> {
	const apiKey = resolveApiKey(config);
	const path = apiKey ? '/v1/search' : '/v1/search/public';
	const payload: Record<string, unknown> = { query: params.query, mode: params.mode ?? 'pro' };
	for (const field of [
		'site',
		'published_after',
		'published_before',
		'acquired_after',
		'acquired_before',
	] as const) {
		const value = params[field];
		if (value) payload[field] = value;
	}

	let response: Response;
	try {
		response = await fetch(`${resolveBaseUrl(config)}${path}`, {
			method: 'POST',
			headers: { ...buildHeaders(apiKey), 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
			signal: withTimeout(DEFAULT_TIMEOUT_MS),
		});
	} catch (err) {
		throw new KeenableError(`Could not reach the Keenable API: ${(err as Error).message}`);
	}
	await raiseForStatus(response, Boolean(apiKey));
	const data = await readJsonObject(response);
	const results = data.results;
	if (!Array.isArray(results)) {
		throw new KeenableError('Unexpected response from the Keenable search API (no results array).');
	}
	return results as KeenableSearchResult[];
}

/** GET /v1/fetch?url= (keyed) or /v1/fetch/public?url= (keyless). */
export async function keenableFetch(
	config: KeenableConfig,
	url: string,
): Promise<KeenableFetchResult> {
	assertPublicFetchTarget(url);
	const apiKey = resolveApiKey(config);
	const path = apiKey ? '/v1/fetch' : '/v1/fetch/public';
	const endpoint = new URL(`${resolveBaseUrl(config)}${path}`);
	endpoint.searchParams.set('url', url);

	let response: Response;
	try {
		response = await fetch(endpoint, {
			method: 'GET',
			headers: buildHeaders(apiKey),
			signal: withTimeout(DEFAULT_TIMEOUT_MS),
		});
	} catch (err) {
		throw new KeenableError(`Could not reach the Keenable API: ${(err as Error).message}`);
	}
	await raiseForStatus(response, Boolean(apiKey));
	return (await readJsonObject(response)) as KeenableFetchResult;
}
