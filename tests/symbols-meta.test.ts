import { downloadAndWriteMeta } from '../src/stack/config/symbols-meta';

describe('Symbols processing', () => {
	test('fetch all symbols meta', async () => {
		const meta = await downloadAndWriteMeta();

		expect(meta).toHaveProperty('tiingo');
		expect(meta['tiingo']).toHaveProperty('stocks');
		expect(meta['tiingo']['stocks'].length).toBeGreaterThan(100);
	});
});
