import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Keenable API credential.
 *
 * Optional by design: the Keenable node is keyless by default (1,000 req/hour
 * against the public tier). Attaching this credential with a key switches the
 * node onto the authenticated endpoints and raises the limits. The node reads
 * `apiKey` / `baseUrl` itself and chooses the keyed vs. keyless path — there is
 * deliberately no `authenticate` block here, so an empty key never injects a
 * blank `X-API-Key` header.
 */
export class KeenableApi implements ICredentialType {
	name = 'keenableApi';

	displayName = 'Keenable API';

	documentationUrl = 'https://docs.keenable.ai/mcp-server';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Optional. Keenable works without a key (1,000 requests/hour). A key raises the limits and unlocks key-only modes. Create one at https://keenable.ai/console.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.keenable.ai',
			description: 'Override the Keenable API base URL. Must be HTTPS (plain http only for loopback).',
		},
	];
}
