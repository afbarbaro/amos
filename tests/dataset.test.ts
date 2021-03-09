import {
	download,
	parseDate,
	reverseChronologyAndFillNonTradingDays as reverseChronologyAndFillNonTradingDays,
	store,
	transform,
} from '../src/lambda/dataset/api';
import { config as alphavantage } from '../src/lambda/dataset/api.config.alphavantage';
import { config as tiingo } from '../src/lambda/dataset/api.config.tiingo';
import { ApiProvider, TimeSeriesData } from '../src/lambda/dataset/types';
import { readFileSync, writeFileSync } from 'fs';

const readTransform = (
	provider: ApiProvider,
	type: string,
	symbol: string,
	field: string
) => {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
	const data: TimeSeriesData = JSON.parse(
		readFileSync(`${__dirname}/${type}.${provider}.test.data.json`).toString()
	);

	const transformed = transform(symbol, field, data);
	return { transformed, data };
};

describe('Crypto data processing', () => {
	test.skip('download crypto alphavantage', async () => {
		const config = alphavantage.calls.crypto;
		const data = await download(
			{
				provider: 'alphavantage',
				symbol: 'BTC',
				type: 'crypto',
				call: config,
				function: 'DIGITAL_CURRENCY_DAILY',
			},
			parseDate('2021-01-01')!,
			parseDate('-1day')!
		);

		writeFileSync(
			`${__dirname}/crypto.alphavantage.test.data.json`,
			JSON.stringify(data)
		);

		expect(data).toBeDefined();
		expect(Object.keys(data).length).toBeGreaterThan(1);
	});

	test.skip('download crypto tiingo', async () => {
		const config = tiingo.calls.crypto;
		const data = await download(
			{
				provider: 'tiingo',
				symbol: 'btcusd',
				type: 'crypto',
				call: config,
				function: 'crypto',
			},
			parseDate('2021-01-01')!,
			parseDate('-1day')!
		);

		writeFileSync(
			`${__dirname}/crypto.tiingo.test.data.json`,
			JSON.stringify(data)
		);

		expect(data).toBeDefined();
		expect(Object.keys(data).length).toBeGreaterThan(1);
	});

	test.skip('download stocks alphavantage', async () => {
		const config = alphavantage.calls.stocks;
		const data = await download(
			{
				provider: 'alphavantage',
				symbol: 'VOO',
				type: 'stocks',
				call: config,
				function: 'TIME_SERIES_DAILY_ADJUSTED',
			},
			parseDate('2021-01-01')!,
			parseDate('-1day')!
		);

		writeFileSync(
			`${__dirname}/stocks.alphavantage.test.data.json`,
			JSON.stringify(data)
		);

		expect(data).toBeDefined();
		expect(Object.keys(data).length).toBeGreaterThan(1);
	});

	test.skip('download stocks tiingo', async () => {
		const config = tiingo.calls.stocks;
		const data = await download(
			{
				provider: 'tiingo',
				symbol: 'VOO',
				type: 'stocks',
				call: config,
				function: 'stocks',
			},
			parseDate('2021-01-01')!,
			parseDate('-1day')!
		);

		writeFileSync(
			`${__dirname}/stocks.tiingo.test.data.json`,
			JSON.stringify(data)
		);

		expect(data).toBeDefined();
		expect(Object.keys(data).length).toBeGreaterThan(1);
	});

	test.skip('transform crypto', () => {
		const { transformed, data } = readTransform(
			'alphavantage',
			'crypto',
			'BTC',
			'4.b close (USD)'
		);
		expect(transformed).toBeInstanceOf(Array);
		expect(transformed).toHaveLength(Object.keys(data).length);
	});

	test.skip('transform stocks', () => {
		const { transformed, data } = readTransform(
			'alphavantage',
			'stocks',
			'VOO',
			'4. close'
		);
		expect(transformed).toBeInstanceOf(Array);
		expect(transformed).toHaveLength(Object.keys(data).length);
	});

	test.skip('fillInNonTradingDays crypto alphavantage', () => {
		const { transformed } = readTransform(
			'alphavantage',
			'crypto',
			'BTC',
			'4.b close (USD)'
		);
		const filled = reverseChronologyAndFillNonTradingDays(transformed, 'desc');
		expect(filled).toBeInstanceOf(Array);
		expect(filled.length).toEqual(transformed.length);
		expect(filled).toEqual(transformed);
	});

	test.skip('fillInNonTradingDays stocks alphavantage', () => {
		const { transformed } = readTransform(
			'tiingo',
			'stocks',
			'VOO',
			'4. close'
		);
		const filled = reverseChronologyAndFillNonTradingDays(transformed, 'desc');
		expect(filled).toBeInstanceOf(Array);
		expect(filled.length).toBeGreaterThan(transformed.length);

		// Assert 1 day difference between elements
		const oneUTCDay = 24 * 60 * 60 * 1000;
		let prevDay = new Date(
			Number(filled[0][1].substr(0, 4)),
			Number(filled[0][1].substr(5, 2)) - 1,
			Number(filled[0][1].substr(8, 2))
		);
		for (let t = 1; t < filled.length; t++) {
			const thisDay = new Date(
				Number(filled[t][1].substr(0, 4)),
				Number(filled[t][1].substr(5, 2)) - 1,
				Number(filled[t][1].substr(8, 2))
			);
			expect(prevDay.setUTCHours(0) - thisDay.setUTCHours(0)).toEqual(
				oneUTCDay
			);
			prevDay = thisDay;
		}
	});

	test.skip('fillInNonTradingDays stocks tiingo', () => {
		const { transformed } = readTransform('tiingo', 'stocks', 'VOO', 'close');
		const filled = reverseChronologyAndFillNonTradingDays(transformed, 'asc');
		expect(filled).toBeInstanceOf(Array);
		expect(filled.length).toBeGreaterThan(transformed.length);

		// Assert 1 day difference between elements
		const oneUTCDay = 24 * 60 * 60 * 1000;
		let prevDay = new Date(
			Number(filled[0][1].substr(0, 4)),
			Number(filled[0][1].substr(5, 2)) - 1,
			Number(filled[0][1].substr(8, 2))
		);
		for (let t = 1; t < filled.length; t++) {
			const thisDay = new Date(
				Number(filled[t][1].substr(0, 4)),
				Number(filled[t][1].substr(5, 2)) - 1,
				Number(filled[t][1].substr(8, 2))
			);
			expect(prevDay.setUTCHours(0) - thisDay.setUTCHours(0)).toEqual(
				oneUTCDay
			);
			prevDay = thisDay;
		}
	});

	test('store', async () => {
		const { transformed } = readTransform(
			'alphavantage',
			'crypto',
			'BTC',
			'4a. close (USD)'
		);
		transformed.shift();
		const result = await store(
			'training',
			'crypto_BTC',
			'BTC',
			transformed,
			'amos-forecast-data'
		);
		expect(result.$metadata.httpStatusCode).toEqual(200);
		expect(result.ETag).toBeDefined();
	});
});
