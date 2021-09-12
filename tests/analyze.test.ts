import { handler } from '../src/lambda/dataset/analyze';
import { Callback, Context } from 'aws-lambda';
describe('Accuracy calculation', () => {
	test('test', async () => {
		const result = await handler(
			{
				enabled: true,
				rebuild: false,
				forecastName: 'amos_forecast_forecast_20210910T2208',
			} as const,
			undefined as unknown as Context,
			undefined as unknown as Callback
		);

		expect(result).toBeDefined();
	});
});
