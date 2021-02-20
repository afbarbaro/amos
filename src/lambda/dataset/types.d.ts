export type DataType = 'crypto' | 'stocks';
export type TimeSeriesMetaData = Record<string, string>;
export type TimeSeriesPoint = Record<string, number>;
export type TimeSeriesData = Record<string, TimeSeriesPoint>;

export type ApiCall = {
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
export type ApiConfig = {
	[K in DataType]: ApiCall;
};

export type ApiMessage = {
	type: string;
	symbol: string;
	call: ApiCall;
};

export type TimeseriesCSV = [string, string, number | string];
