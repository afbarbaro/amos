import { download, store, transform } from '../src/lambda/dataset/api';
import { TimeSeriesResponse } from '../src/lambda/dataset/types';
import { readFileSync, writeFileSync } from 'fs';

const readTransform = (type: string, symbol: string, field: string) => {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
	const data: TimeSeriesResponse = JSON.parse(
		readFileSync(`${__dirname}/${type}.test.data.json`).toString()
	);

	const transformed = transform(symbol, field, data.timeSeries);
	return { transformed, data };
};

describe('Crypto data processing', () => {
	test('download crypto', async () => {
		const data = await download({
			market: 'USD',
			symbol: 'BTC',
			function: 'DIGITAL_CURRENCY_DAILY',
		});
		writeFileSync(`${__dirname}/crypto.test.data.json`, JSON.stringify(data));
		expect(data.timeSeries).toBeDefined();
		expect(Object.keys(data.timeSeries).length).toBeGreaterThan(1);
	});

	test('download stocks', async () => {
		const data = await download({
			outputsize: 'compact',
			datatype: 'json',
			symbol: 'VOO',
			function: 'TIME_SERIES_DAILY_ADJUSTED',
		});
		writeFileSync(`${__dirname}/stocks.test.data.json`, JSON.stringify(data));
		expect(data.timeSeries).toBeDefined();
		expect(Object.keys(data.timeSeries).length).toBeGreaterThan(1);
	});

	test('transform crypto', () => {
		const { transformed, data } = readTransform(
			'crypto',
			'BTC',
			'4.b close (USD)'
		);
		expect(transformed).toBeInstanceOf(Array);
		expect(transformed).toHaveLength(Object.keys(data.timeSeries).length);
	});

	test('transform stocks', () => {
		const { transformed, data } = readTransform('stocks', 'VOO', '4. close');
		expect(transformed).toBeInstanceOf(Array);
		expect(transformed).toHaveLength(Object.keys(data.timeSeries).length);
	});

	test('store', async () => {
		const { transformed } = readTransform('crypto', 'BTC', '4a. close (USD)');
		const result = await store(
			'crypto',
			'BTC',
			transformed,
			'amos-forecast-data'
		);
		expect(result.$metadata.httpStatusCode).toEqual(200);
		expect(result.ETag).toBeDefined();
	});
});
