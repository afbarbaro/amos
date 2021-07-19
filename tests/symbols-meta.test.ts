import { downloadAndWriteMeta } from '../src/stack/config/symbols-meta';
// import { readFileSync } from 'fs';

// const _read = () => {
// 	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
// 	const data: Record<string, string>[] = JSON.parse(
// 		readFileSync(`${__dirname}/../config/symbols.raw.json`).toString()
// 	);

// 	return data;
// };

describe('Symbols processing', () => {
	test('fetch all symbols meta', async () => {
		const meta = await downloadAndWriteMeta();

		expect(meta).toHaveProperty('tiingo');
		expect(meta['tiingo']).toHaveProperty('stocks');
		expect(meta['tiingo']['stocks'].length).toBeGreaterThan(100);
	});
});
