export type TimeSeriesFunction =
	| 'DIGITAL_CURRENCY_DAILY'
	| 'DIGITAL_CURRENCY_WEEKLY'
	| 'DIGITAL_CURRENCY_MONTHLY';

export type TimeSeriesMetaData = {
	'1. Information': string;
	'2. Digital Currency Code': string;
	'3. Digital Currency Name': string;
	'4. Market Code': string;
	'5. Market Name': string;
	'6. Last Refreshed': string;
	'7. Time Zone': string;
};

export type TimeSeriesResponse = {
	metaData: TimeSeriesMetaData;
	timeSeries: TimeSeriesData;
};

export type TimeSeriesPoint = {
	'1a. open (USD)': number;
	'1b. open (USD)': number;
	'2a. high (USD)': number;
	'2b. high (USD)': number;
	'3a. low (USD)': number;
	'3b. low (USD)': number;
	'4a. close (USD)': number;
	'4b. close (USD)': number;
	'5. volume': number;
	'6. market cap (USD)': number;
};

export type TimeSeriesData = Record<string, TimeSeriesPoint>;

export type TimeseriesCSV = [string, string, number];
