import type { ApiConfig } from './types';

export const config: ApiConfig = {
	provider: 'tiingo',
	disabled: false,
	rateLimit: { perMinute: 500 },
	calls: {
		timeseries: {
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
		meta: {
			stocks: {
				url: 'https://api.tiingo.com/tiingo/daily/${symbol}',
				response: {
					array: false,
					properties: {
						ticker: 'ticker',
						name: 'name',
						description: 'description',
						exchangeCode: 'exchangeCode',
					},
				},
				parameters: {},
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Token ${process.env.TIINGO_API_KEY}',
				},
			},
			crypto: {
				url: 'https://api.tiingo.com/tiingo/crypto?tickers=${symbol}',
				response: {
					array: true,
					properties: {
						ticker: 'ticker',
						name: 'name',
						description: 'description',
						exchangeCode: 'ticker',
					},
				},
				parameters: {},
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Token ${process.env.TIINGO_API_KEY}',
				},
			},
		},
	},
};
