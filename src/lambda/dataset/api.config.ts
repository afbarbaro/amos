import { ApiConfig } from './types';

export const config: ApiConfig = {
	crypto: {
		symbols: ['BTC', 'ETH'],
		functions: ['DIGITAL_CURRENCY_DAILY'],
		parameters: [{ market: 'USD' }],
		fields: ['4a. close (USD)'],
	},
	stocks: {
		symbols: ['VOO', 'BIV', 'BLV', 'BSV', 'VXUS', 'VT', 'VTI'],
		functions: ['TIME_SERIES_DAILY_ADJUSTED'],
		parameters: [{ outputsize: 'compact', datatype: 'json' }],
		fields: ['4. close'],
	},
};
