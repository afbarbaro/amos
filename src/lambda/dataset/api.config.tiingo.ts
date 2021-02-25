import { ApiConfig } from './types';

export const config: ApiConfig = {
	provider: 'tiingo',
	rateLimit: { workerBatchSize: 500 },
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
			symbols: [
				'btcusd', // bitcoin
				'ethusd', // ethereum
				'dotusd', // polkadot
				'adausd', // cardano
				'xrpusd', // xrp
				'bnbusd', // binance coin
				'ltcusd', // litecoin
				'bchusd', // bitcoin cash
				'linkusd', // chainlink
				'xlmusd', // stellar
				'dogeusd', // dogecoin
				'uniusd', // uniswap
				'aaveusd', // aave
				'atomusd', // cosmos
			],
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
			symbols: [
				//#region DJIA
				'TRV',
				//#endregion

				//#region SP100
				'AAPL',
				'ABBV',
				'ABT',
				'ACN',
				'ADBE',
				'AIG',
				'ALL',
				'AMGN',
				'AMT',
				'AMZN',
				'AXP',
				'BA',
				'BAC',
				'BIIB',
				'BK',
				'BKNG',
				'BLK',
				'BMY',
				'BRK-B',
				'C',
				'CAT',
				'CHTR',
				'CL',
				'CMCSA',
				'COF',
				'COP',
				'COST',
				'CRM',
				'CSCO',
				'CVS',
				'CVX',
				'DD',
				'DHR',
				'DIS',
				'DOW',
				'DUK',
				'EMR',
				'EXC',
				'F',
				'FB',
				'FDX',
				'GD',
				'GE',
				'GILD',
				'GM',
				'GOOG',
				'GOOGL',
				'GS',
				'HD',
				'HON',
				'IBM',
				'INTC',
				'JNJ',
				'JPM',
				'KHC',
				'KMI',
				'KO',
				'LLY',
				'LMT',
				'LOW',
				'MA',
				'MCD',
				'MDLZ',
				'MDT',
				'MET',
				'MMM',
				'MO',
				'MRK',
				'MS',
				'MSFT',
				'NEE',
				'NFLX',
				'NKE',
				'NVDA',
				'ORCL',
				'PEP',
				'PFE',
				'PG',
				'PM',
				'PYPL',
				'QCOM',
				'RTX',
				'SBUX',
				'SLB',
				'SO',
				'SPG',
				'T',
				'TGT',
				'TMO',
				'TSLA',
				'TXN',
				'UNH',
				'UNP',
				'UPS',
				'USB',
				'V',
				'VZ',
				'WBA',
				'WFC',
				'WMT',
				'XOM',
				//#endregion

				//#region ETFs
				'BIV',
				'BLV',
				'BSV',
				'VIXY',
				'VIIX',
				'VIIXF',
				'VOO',
				'VT',
				'VTI',
				'VXUS',
				'VXX',
				'VXZ',
				//#endregion
			],
		},
	},
};
