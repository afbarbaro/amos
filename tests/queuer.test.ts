import { config as alphavantage } from '../src/lambda/dataset/api.config.alphavantage';
import { config as tiingo } from '../src/lambda/dataset/api.config.tiingo';
import { handler } from '../src/lambda/dataset/queuer';

describe('Queuer tests', () => {
	jest.setTimeout(60000 * 15);

	beforeEach(() => {
		alphavantage.disabled = true;
		tiingo.disabled = true;
	});

	test('alphavantage', async () => {
		alphavantage.disabled = false;

		const event = {
			queueUrl: 'http://localhost:4566/000000000000/amos-queue.fifo',
		};
		let result = await handler(event);

		expect(result).toBeDefined();
		expect(result.queuedAllItems[alphavantage.provider]).toBeFalsy();
		expect(result.lastQueuedItem[alphavantage.provider]).toBeDefined();

		let iterations = 0;
		let queuedCount = Object.values(
			result.callCounts.alphavantage || {}
		).reduce((sum, currentValue) => sum + currentValue);
		console.info(
			`iteration: ${iterations}, queuedCount: ${queuedCount}, waitSeconds: ${result.waitSeconds}`
		);

		while (!result.queuedAllItems[alphavantage.provider]) {
			iterations++;

			await new Promise((r) => setTimeout(r, result.waitSeconds * 1000));
			result = await handler(result);

			queuedCount = Object.values(result.callCounts.alphavantage || {}).reduce(
				(sum, currentValue) => sum + currentValue
			);
			console.info(
				`iteration: ${iterations}, queuedCount: ${queuedCount}, waitSeconds: ${result.waitSeconds}`
			);
		}

		expect(iterations).toEqual(2);
		expect(queuedCount).toEqual(128);
	});

	test.skip('tiingo', async () => {
		tiingo.disabled = false;

		const event = {
			queueUrl: 'http://localhost:4566/000000000000/amos-queue.fifo',
		};
		const result = await handler(event);

		expect(result).toBeDefined();
		expect(result.queuedAllItems[tiingo.provider]).toBeTruthy();
		expect(result.lastQueuedItem[tiingo.provider]).toBeUndefined();
	});
});
