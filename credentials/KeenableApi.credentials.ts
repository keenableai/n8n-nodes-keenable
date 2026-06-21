import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Keenable API credential.
 *
 * Optional by design: the Keenable node is keyless by default (1,000 req/hour).
 * Attaching this credential with a key switches the node onto the authenticated
 * endpoints and raises the limits. The key is sent as the `X-API-Key` header.
 */
export class KeenableApi implements ICredentialType {
	name = 'keenableApi';

	displayName = 'Keenable API';

	documentationUrl = 'https://docs.keenable.ai/mcp-server';

	icon: Icon = 'file:keenable.svg';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Keenable works without a key (1,000 requests/hour). A key raises the limits and unlocks key-only modes. Create one at https://keenable.ai/console.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.keenable.ai',
			description: 'Override the Keenable API base URL. Must be HTTPS (plain http only for loopback).',
		},
	];

	// Sends the key as X-API-Key (used by the credential test below).
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	// Validates the key against the authenticated search endpoint.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl || "https://api.keenable.ai"}}',
			url: '/v1/search',
			method: 'POST',
			body: {
				query: 'keenable n8n credential test',
				mode: 'pro',
			},
		},
	};
}
