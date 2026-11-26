import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Keenable } = require('../dist/nodes/Keenable/Keenable.node.js');
const { keenableSearch } = require('../dist/nodes/Keenable/KeenableClient.js');

function objectiveProperty() {
	const props = new Keenable().description.properties;
	const collection = props.find((p) => p.options?.some((o) => o.name === 'objective'));
	return collection.options.find((o) => o.name === 'objective');
}

function fakeCtx() {
	const sent = [];
	return {
		sent,
		getNode: () => ({ name: 'Keenable' }),
		getNodeParameter: () => ({}),
		helpers: {
			httpRequest: async (opts) => {
				sent.push(opts.body);
				return { results: [] };
			},
		},
	};
}

test('objective hint is one short human line, not the LLM prompt', () => {
	const prop = objectiveProperty();
	assert.ok(prop.description.length <= 120, prop.description);
	assert.ok(!prop.description.includes('\n'));
	assert.ok(prop.description.includes('1,000'));
	assert.equal(prop.typeOptions?.rows, undefined);
});

test('objective is trimmed; blank is not sent', async () => {
	const ctx = fakeCtx();
	await keenableSearch(ctx, {}, { query: 'q', objective: '  find it  ' });
	await keenableSearch(ctx, {}, { query: 'q', objective: '   ' });
	assert.equal(ctx.sent[0].objective, 'find it');
	assert.ok(!('objective' in ctx.sent[1]));
});

test('1,000 code points are accepted even when they are 2,000 UTF-16 units; 1,001 are refused', async () => {
	const ok = '😀'.repeat(1000);
	assert.equal(ok.length, 2000);
	const ctx = fakeCtx();
	await keenableSearch(ctx, {}, { query: 'q', objective: ` ${ok} ` });
	assert.equal(ctx.sent[0].objective, ok);
	await assert.rejects(() => keenableSearch(fakeCtx(), {}, { query: 'q', objective: '😀'.repeat(1001) }), /1001 characters/);
	assert.equal(ctx.sent.length, 1);
});
