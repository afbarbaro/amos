import { ApiConfig } from './types';

export const config: ApiConfig = {
	provider: 'tiingo',
	rateLimit: { perMinute: 500 },
	calls: {
		crypto: {
			url: 'https://api.tiingo.com/tiingo/crypto/prices',
			function: 'crypto',
			response: {
				order: 'asc',
				array: true,
				seriesProperty: 'priceData',
				dateProperty: 'date',
				valueProperty: 'close',
			},
			parameters: {
				tickers: '${symbol}',
				startDate: '${startDate}',
				endDate: '${endDate}',
				resampleFreq: '1day',
			},
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Token ${process.env.TIINGO_API_KEY}',
			},
		},
		stocks: {
			url: 'https://api.tiingo.com/tiingo/daily/${symbol}/prices',
			function: 'eod',
			response: {
				order: 'asc',
				array: true,
				seriesProperty: '',
				dateProperty: 'date',
				valueProperty: 'adjClose',
			},
			parameters: {
				startDate: '${startDate}',
				endDate: '${endDate}',
				resampleFreq: 'daily',
			},
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Token ${process.env.TIINGO_API_KEY}',
			},
		},
	},
};