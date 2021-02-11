export type DataType = 'crypto' | 'stocks';
export type TimeSeriesMetaData = Record<string, string>;
export type TimeSeriesPoint = Record<string, number>;
export type TimeSeriesData = Record<string, TimeSeriesPoint>;
export type TimeSeriesResponse = {
	metaData: TimeSeriesMetaData;
	timeSeries: TimeSeriesData;
};

type ApiCall = {
	symbols: string[];
	functions: string[];
	parameters: object[];
	fields: string[];
};
type ApiConfig = {
	[K in DataType]: ApiCall;
};

export type TimeseriesCSV = [string, string, number];
