/**
 * Keenable REST client for the n8n node.
 *
 * Uses n8n's `this.helpers.httpRequest` (no third-party deps, no Node built-ins
 * — n8n Cloud forbids both) and surfaces failures as `NodeApiError` /
 * `NodeOperationError`. Keyless by default (`/v1/*\/public`), authenticated when
 * a key is present (`/v1/*`), HTTPS-only base URL, `X-Keenable-Title`
 * attribution. The REST surface is internal — users go through the node's
 * Search / Fetch operations.
 */

import type { IDataObject, IExecuteFunctions, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

/** Manual version tag (kept in sync with package.json) used for the User-Agent. */
export const KEENABLE_N8N_VERSION = '0.1.4';

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

/** Resolve the API base URL, enforcing HTTPS (http only for loopback). */
function resolveBaseUrl(ctx: IExecuteFunctions, config: KeenableConfig): string {
	const base = (config.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/u, '');
	let parsed: URL;
	try {
		parsed = new URL(base);
	} catch {
		throw new NodeOperationError(
			ctx.getNode(),
			`Keenable base URL must be a valid URL with a host, got ${base}`,
		);
	}
	if (parsed.hostname) {
		if (parsed.protocol === 'https:') return base;
		if (
			parsed.protocol === 'http:' &&
			['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
		) {
			return base;
		}
	}
	throw new NodeOperationError(
		ctx.getNode(),
		`Keenable base URL must be an https:// URL with a host, got ${base}`,
	);
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

/** Dependency-free private-IPv4 check (no node:net — forbidden on n8n Cloud). */
function isPrivateIpv4(host: string): boolean {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
	if (!m) return false;
	const p = m.slice(1).map(Number);
	if (p.some((o) => o > 255)) return false;
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

function isPrivateHost(rawHost: string): boolean {
	const host = rawHost.toLowerCase();
	if (host === 'localhost' || host === 'metadata.google.internal') return true;
	if (isPrivateIpv4(host)) return true;
	// IPv6 loopback / link-local / unique-local.
	return host === '::1' || host === '::' || host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd');
}

/**
 * Refuse obviously private/internal fetch targets before sending (SSRF). The
 * backend enforces this server-side too; the client guard avoids leaking an
 * internal hostname.
 */
function assertPublicFetchTarget(ctx: IExecuteFunctions, rawUrl: string): void {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new NodeOperationError(ctx.getNode(), `Not a valid URL: ${rawUrl}`);
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new NodeOperationError(ctx.getNode(), `Refusing to fetch a non-http(s) URL: ${rawUrl}`);
	}
	const host = (parsed.hostname || '').toLowerCase();
	if (!host) throw new NodeOperationError(ctx.getNode(), `Refusing to fetch a URL with no host: ${rawUrl}`);
	if (isPrivateHost(host)) {
		throw new NodeOperationError(ctx.getNode(), `Refusing to fetch a private/internal host: ${host}`);
	}
}

/** Status code from an httpRequest error, if present. */
function statusOf(error: unknown): number | undefined {
	const e = error as { httpCode?: unknown; statusCode?: unknown; response?: { statusCode?: unknown } };
	const raw = e.httpCode ?? e.statusCode ?? e.response?.statusCode;
	const n = Number(raw);
	return Number.isFinite(n) ? n : undefined;
}

/** POST /v1/search (keyed) or /v1/search/public (keyless). */
export async function keenableSearch(
	ctx: IExecuteFunctions,
	config: KeenableConfig,
	params: KeenableSearchParams,
): Promise<KeenableSearchResult[]> {
	const apiKey = resolveApiKey(config);
	const path = apiKey ? '/v1/search' : '/v1/search/public';
	const body: IDataObject = { query: params.query, mode: params.mode ?? 'pro' };
	for (const field of ['site', 'published_after', 'published_before'] as const) {
		const value = params[field];
		if (value) body[field] = value;
	}

	let data: IDataObject;
	try {
		data = (await ctx.helpers.httpRequest({
			method: 'POST',
			url: `${resolveBaseUrl(ctx, config)}${path}`,
			headers: buildHeaders(apiKey),
			body,
			json: true,
			timeout: DEFAULT_TIMEOUT_MS,
		})) as IDataObject;
	} catch (error) {
		if (!apiKey && statusOf(error) === 429) {
			throw new NodeApiError(ctx.getNode(), error as JsonObject, {
				message:
					'Keenable keyless requests hit their rate limit. Add a Keenable API credential ' +
					'(create a key at https://keenable.ai/console) to raise the limits.',
			});
		}
		throw new NodeApiError(ctx.getNode(), error as JsonObject);
	}

	if (!Array.isArray(data?.results)) {
		throw new NodeOperationError(
			ctx.getNode(),
			'Unexpected response from the Keenable search API (no results array).',
		);
	}
	return data.results as KeenableSearchResult[];
}

/** GET /v1/fetch?url= (keyed) or /v1/fetch/public?url= (keyless). */
export async function keenableFetch(
	ctx: IExecuteFunctions,
	config: KeenableConfig,
	url: string,
): Promise<KeenableFetchResult> {
	assertPublicFetchTarget(ctx, url);
	const apiKey = resolveApiKey(config);
	const path = apiKey ? '/v1/fetch' : '/v1/fetch/public';

	try {
		return (await ctx.helpers.httpRequest({
			method: 'GET',
			url: `${resolveBaseUrl(ctx, config)}${path}`,
			headers: buildHeaders(apiKey),
			qs: { url },
			json: true,
			timeout: DEFAULT_TIMEOUT_MS,
		})) as KeenableFetchResult;
	} catch (error) {
		if (!apiKey && statusOf(error) === 429) {
			throw new NodeApiError(ctx.getNode(), error as JsonObject, {
				message:
					'Keenable keyless requests hit their rate limit. Add a Keenable API credential ' +
					'(create a key at https://keenable.ai/console) to raise the limits.',
			});
		}
		throw new NodeApiError(ctx.getNode(), error as JsonObject);
	}
}
