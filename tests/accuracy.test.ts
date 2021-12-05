import { distortion } from '../src/lambda/forecast/accuracy';
import { writeFileSync } from 'fs';

describe('Accuracy calculation', () => {
	test('distortion', async () => {
		const result = await distortion({ symbol: 'AAPL' });
		expect(result.success).toBeTruthy();
		if (result.success) {
			writeFileSync(
				'./tmp/APPL.distortion.json',
				JSON.stringify(result.data, null, 2)
			);
		}
	});
});
