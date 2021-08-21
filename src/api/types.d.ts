export type TimeSeriesMetaData = Record<string, string>;
export type TimeSeriesPoint = Record<string, number>;
export type TimeSeriesData = Record<string, TimeSeriesPoint>;

export type ApiProvider = 'alphavantage' | 'tiingo';

export type ApiRateLimit = {
	perMinute: number;
	perHour?: number;
};

export type ApiCallTimeseries = {
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
};

export type ApiCallMeta = {
	disabled?: boolean;
	url: string;
	headers?: Record<string, string | number | boolean>;
	parameters: Record<string, string | number | boolean>;
	response: {
		array: boolean;
		properties: SymbolMeta;
	};
};

export type ApiCallConfig = {
	timeseries: Record<string, ApiCallTimeseries>;
	meta: Record<keyof ApiCallConfig['timeseries'], ApiCallMeta>;
};

export type ApiFileConfig = {
	[K in keyof ApiCallConfig['timeseries']]: { symbols: string[] };
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
	function: string;
	call: ApiCallTimeseries;
};

export type ApiMessageKey = Omit<ApiMessage, 'call'>;

export type TimeseriesCSV = [string, string, number | string];

export type SymbolMeta = {
	ticker: string;
	name: string;
	description: string;
	exchangeCode: string;
};
