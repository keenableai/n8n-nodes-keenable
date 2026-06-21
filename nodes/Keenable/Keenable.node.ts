import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';

import {
	keenableFetch,
	keenableSearch,
	type KeenableConfig,
	type KeenableSearchParams,
} from './KeenableClient';

/**
 * Keenable node: web search + page fetch.
 *
 * Two operations map 1:1 onto the hosted Keenable tools `search_web_pages` and
 * `fetch_page_content`. Keyless by default; attach the optional Keenable API
 * credential to raise the limits. `usableAsTool: true` exposes the node to n8n's
 * AI Agent so an LLM workflow can call it directly.
 */
export class Keenable implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Keenable',
		name: 'keenable',
		icon: 'file:keenable.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] }}',
		description: 'Search the web and fetch page content with Keenable',
		defaults: {
			name: 'Keenable',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'keenableApi',
				// Optional: the node is keyless by default. A credential only raises limits.
				required: false,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Fetch Page',
						value: 'fetch',
						description: 'Fetch and extract the content of a web page as clean text',
						action: 'Fetch page content',
					},
					{
						name: 'Search',
						value: 'search',
						description: 'Search the web for pages matching a query',
						action: 'Search the web',
					},
				],
				default: 'search',
			},

			// ----- Search -----
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. latest Node.js LTS release',
				description: 'The search query',
				displayOptions: { show: { operation: ['search'] } },
			},
			{
				displayName: 'Mode',
				name: 'mode',
				type: 'options',
				options: [
					{
						name: 'Pro',
						value: 'pro',
						description: 'Standard high-quality search (keyless-friendly)',
					},
					{
						name: 'Realtime',
						value: 'realtime',
						description: 'Fresh, real-time results (requires an API key credential)',
					},
				],
				default: 'pro',
				displayOptions: { show: { operation: ['search'] } },
			},
			{
				displayName: 'Additional Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { operation: ['search'] } },
				options: [
					{
						displayName: 'Published After',
						name: 'published_after',
						type: 'string',
						default: '',
						placeholder: 'YYYY-MM-DD',
						description: 'Only results published on or after this date',
					},
					{
						displayName: 'Published Before',
						name: 'published_before',
						type: 'string',
						default: '',
						placeholder: 'YYYY-MM-DD',
						description: 'Only results published on or before this date',
					},
					{
						displayName: 'Site',
						name: 'site',
						type: 'string',
						default: '',
						placeholder: 'example.com',
						description: 'Restrict results to a single domain',
					},
				],
			},

			// ----- Fetch -----
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://example.com/article',
				description: 'The URL of the page to fetch and extract',
				displayOptions: { show: { operation: ['fetch'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// The credential is optional. Only fetch it when one is actually attached:
		// no credential → keyless tier. A real failure on an attached credential
		// (decryption/permission) is left to propagate.
		let config: KeenableConfig = {};
		if (this.getNode().credentials?.keenableApi) {
			const creds = await this.getCredentials('keenableApi');
			config = {
				apiKey: (creds?.apiKey as string) || undefined,
				baseUrl: (creds?.baseUrl as string) || undefined,
			};
		}

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;

				if (operation === 'search') {
					const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
					const params: KeenableSearchParams = {
						query: this.getNodeParameter('query', i) as string,
						mode: this.getNodeParameter('mode', i) as 'pro' | 'realtime',
						site: (filters.site as string) || undefined,
						published_after: (filters.published_after as string) || undefined,
						published_before: (filters.published_before as string) || undefined,
					};
					const results = await keenableSearch(this, config, params);
					for (const result of results) {
						returnData.push({ json: result as IDataObject, pairedItem: { item: i } });
					}
				} else {
					const url = this.getNodeParameter('url', i) as string;
					const result = await keenableFetch(this, config, url);
					returnData.push({ json: result as IDataObject, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
