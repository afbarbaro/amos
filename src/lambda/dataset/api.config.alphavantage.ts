import { ApiConfig } from './types';

export const config: ApiConfig = {
	provider: 'alphavantage',
	disabled: true,
	rateLimit: { perMinute: 5 },
	calls: {
		crypto: {
			url: 'https://alpha-vantage.p.rapidapi.com/query',
			function: 'DIGITAL_CURRENCY_DAILY',
			response: {
				order: 'desc',
				array: false,
				dateProperty: 'key',
				seriesProperty: 'Time Series (Digital Currency Daily)',
				valueProperty: '4a. close (USD)',
			},
			parameters: {
				symbol: '${symbol}',
				market: 'USD',
				function: '${function}',
				datatype: 'json',
			},
			headers: {
				'x-rapidapi-key': '${process.env.RAPIDAPI_KEY}',
				'x-rapidapi-host': 'alpha-vantage.p.rapidapi.com',
				useQueryString: true,
			},
		},
		stocks: {
			url: 'https://alpha-vantage.p.rapidapi.com/query',
			function: 'TIME_SERIES_DAILY_ADJUSTED',
			response: {
				order: 'desc',
				array: false,
				dateProperty: 'key',
				seriesProperty: 'Time Series (Daily)',
				valueProperty: '4. close',
			},
			parameters: {
				symbol: '${symbol}',
				market: 'USD',
				function: '${function}',
				datatype: 'json',
				outputsize: 'full',
			},
			headers: {
				'x-rapidapi-key': '${process.env.RAPIDAPI_KEY}',
				'x-rapidapi-host': 'alpha-vantage.p.rapidapi.com',
				useQueryString: true,
			},
		},
	},
};
