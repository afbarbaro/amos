export type TimeSeriesMetaData = Record<string, string>;
export type TimeSeriesPoint = Record<string, number>;
export type TimeSeriesData = Record<string, TimeSeriesPoint>;

export type ApiProvider = 'alphavantage' | 'tiingo';

export type ApiRateLimit = {
	workerBatchSize: number;
};

export type ApiCall = {
	disabled?: boolean;
	url: string;
	headers?: Record<string, string | number | boolean>;
	parameters: Record<string, string | number | boolean>;
	response: {
		order: 'asc' | 'desc';
		array: boolean;
		seriesProperty: string;
		dateProperty: 'key' | string;
		valueProperty: string;
	};
	function: string;
	symbols: string[];
};

export type ApiCallConfig = {
	[K in string]: ApiCall;
};

export type ApiConfig = {
	provider: ApiProvider;
	disabled?: boolean;
	rateLimit: ApiRateLimit;
	calls: ApiCallConfig;
};

export type ApiMessage = {
	provider: ApiProvider;
	type: string;
	symbol: string;
	call: ApiCall;
};

export type TimeseriesCSV = [string, string, number | string];
