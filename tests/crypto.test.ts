import { download, store, transform } from '../src/lambda/dataset/crypto';
import { TimeSeriesResponse } from '../src/lambda/dataset/types';
import { readFileSync, writeFileSync } from 'fs';

const readTransform = () => {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
	const data: TimeSeriesResponse = JSON.parse(
		readFileSync(`${__dirname}/crypto.test.data.json`).toString()
	);

	const transformed = transform('BTC', data.timeSeries);
	return { transformed, data };
};

describe('Crypto data processing', () => {
	test.skip('download', async () => {
		const data = await download('BTC', 'DIGITAL_CURRENCY_DAILY');
		writeFileSync(`${__dirname}/crypto.test.data.json`, JSON.stringify(data));
		expect(data.timeSeries).toBeDefined();
		expect(Object.keys(data.timeSeries).length).toBeGreaterThan(1);
	});

	test.skip('transform', () => {
		const { transformed, data } = readTransform();
		expect(transformed).toBeInstanceOf(Array);
		expect(transformed).toHaveLength(Object.keys(data.timeSeries).length);
	});

	test('store', async () => {
		const { transformed } = readTransform();
		const result = await store('crypto', 'BTC', transformed);
		expect(result.$metadata.httpStatusCode).toEqual(200);
		expect(result.ETag).toBeDefined();
	});
});
