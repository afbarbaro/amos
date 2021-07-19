import { config as alphavantage } from './api.config.alphavantage';
import { config as tiingo } from './api.config.tiingo';
import {
	ApiCallMeta,
	ApiMessage,
	SymbolMeta,
	TimeseriesCSV,
	TimeSeriesData,
} from './types';
import { PutObjectCommandOutput, S3 } from '@aws-sdk/client-s3';
import axios, { AxiosRequestConfig } from 'axios';
import stringify = require('csv-stringify');
import getStream = require('get-stream');
import { Stream } from 'stream';
import { promisify } from 'util';

const stringifyAsync = promisify(
	(
		input: stringify.Input,
		options?: stringify.Options,
		callback?: stringify.Callback
	): stringify.Stringifier => stringify(input, options, callback)
);

/**
 * Provider configurations
 */
export const providerConfigurations = [alphavantage, tiingo];

/**
 * Dowloads timeseries data by calling the financial data API.
 *
 * @param message api query string parameters and their values
 */
export const downloadTimeseries = (
	message: ApiMessage,
	startDate: number,
	endDate: number
): Promise<TimeSeriesData> => {
	// Extract call from message
	const { call } = message;

	// Bind parameters
	const params = bindValues(call.parameters, message, startDate, endDate);
	const headers = bindValues(call.headers, message, startDate, endDate);
	const url = call.url.replace('${symbol}', message.symbol);

	// Configure Axios Request
	const options: AxiosRequestConfig = {
		method: 'GET',
		url,
		params,
		headers,
	};

	return axios
		.request(options)
		.then((response) => {
			/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
			const payload = response.data;
			let data = payload;
			if (call.response.seriesProperty) {
				if (call.response.array) {
					data = payload[0][call.response.seriesProperty];
				} else {
					data = payload[call.response.seriesProperty];
				}
			}

			if (call.response.dateProperty === 'key') {
				return data as TimeSeriesData;
			}

			const tsd: TimeSeriesData = {};
			for (const d of data) {
				tsd[d[call.response.dateProperty]] = d;
			}
			/* eslint-enable @typescript-eslint/no-unsafe-assignment */

			return tsd;
		})
		.catch((error) => {
			console.error('Error fetching data', error);
			throw error;
		});
};

/**
 * Dowloads symbol meta data by calling the financial data API.
 *
 * @param message api query string parameters and their values
 */
export const downloadMeta = (
	symbol: string,
	call: ApiCallMeta
): Promise<SymbolMeta> => {
	// Bind parameters
	const params = bindValues(call.parameters);
	const headers = bindValues(call.headers);
	const url = call.url.replace('${symbol}', symbol);

	// Configure Axios Request
	const options: AxiosRequestConfig = {
		method: 'GET',
		url,
		params,
		headers,
	};

	return axios
		.request<SymbolMeta>(options)
		.then((response) => {
			const meta = {} as SymbolMeta;
			for (const property in call.response.properties) {
				const p = property as keyof SymbolMeta;
				meta[p] = response.data[p];
			}
			return meta;
		})
		.catch((_e) => ({
			ticker: symbol,
			name: symbol,
			description: symbol,
			exchangeCode: 'N/A',
		}));
};

/**
 * Binds concrete values to the given object
 * @param object object that may contain expressions that require binding to actual values.
 * @param message
 * @param startDate
 * @param endDate
 */
// eslint-disable-next-line complexity -- true, too many conditions on the if statements, although it's still pretty easy to follow the logic.
function bindValues(
	object: Record<string, string | number | boolean> | undefined,
	message?: ApiMessage,
	startDate?: number,
	endDate?: number
) {
	if (object) {
		for (const key in object) {
			const value = object[key].toString();
			if (key.endsWith('Date') && startDate && endDate) {
				object[key] = evalToISODate(value, startDate, endDate);
			} else if (value === '${symbol}' && message) {
				object[key] = message.symbol;
			} else if (value === '${function}' && message) {
				object[key] = message.function;
			} else if (value.includes('${process.env')) {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				object[key] = (0, eval)('`' + value + '`');
			}
		}
	}
	return object;
}

/**
 * Transforms the data object to CSV array.
 *
 * @param symbol trading asset symbol
 * @param field value field
 * @param data time series data
 * @returns a time series array
 */
export const transform = (
	symbol: string,
	field: string,
	data: TimeSeriesData
): TimeseriesCSV[] => {
	const transformed = Object.entries(data).map((point) => {
		const date = point[0].length <= 10 ? point[0] : point[0].substring(0, 10);
		return [symbol, date, point[1][field]] as TimeseriesCSV;
	});
	return transformed;
};

/**
 * Reverses the time series array and fills in non-trading days (by carrying forward the last value).
 *
 * @param data time series records in reverse chronological order (first element is the newest time, last is the oldest)
 * @returns a new time series array in chronological order and with no gaps in dates.
 */
export const reverseChronologyAndFillNonTradingDays = (
	data: TimeseriesCSV[],
	dataOrder: 'asc' | 'desc',
	endDate: number
): TimeseriesCSV[] => {
	const filled: TimeseriesCSV[] = [];
	let prevDay: number;
	let lastData: TimeseriesCSV;

	if (dataOrder === 'asc') {
		filled.push(data[0]);
		prevDay = toUTC(data[0][1]);
		for (let t = 1; t < data.length; t++) {
			prevDay = fillNonTradingDays(data[t], data[t - 1], prevDay, filled);
		}
		lastData = data[data.length - 1];
	} else {
		filled.push(data[data.length - 1]);
		prevDay = toUTC(data[data.length - 1][1]);
		for (let t = data.length - 2; t >= 0; t--) {
			prevDay = fillNonTradingDays(data[t], data[t + 1], prevDay, filled);
		}
		lastData = data[0];
	}

	// Fill in from last day to the end date (relevant if the end date is a weekend)
	const endDateISO = toISODate(endDate);
	if (lastData[1] !== endDateISO) {
		const endDateData: TimeseriesCSV = [lastData[0], endDateISO, lastData[2]];
		fillNonTradingDays(endDateData, lastData, prevDay, filled);
	}

	return filled.reverse();
};

function fillNonTradingDays(
	data: TimeseriesCSV,
	prevData: TimeseriesCSV,
	prevDay: number,
	filled: TimeseriesCSV[]
) {
	const oneUTCDayInMillis = 24 * 60 * 60 * 1000;
	const thisDay = toUTC(data[1]);
	const deltaDays = (thisDay - prevDay) / oneUTCDayInMillis;
	for (let d = 1; d < deltaDays; d++) {
		const day = new Date(prevDay + oneUTCDayInMillis * d)
			.toISOString()
			.substring(0, 10);
		filled.push([prevData[0], day, prevData[2]]);
	}
	filled.push(data);
	return thisDay;
}

// eslint-disable-next-line complexity
export function parseDate(offsetOrConstant: string): number | undefined {
	if (offsetOrConstant.endsWith('d') || offsetOrConstant.endsWith('day')) {
		const today = new Date();
		today.setUTCHours(0);
		const offsetDays = Number(offsetOrConstant.replace(/d(ay)?/, ''));
		return today.setUTCDate(today.getUTCDate() + offsetDays);
	} else if (
		offsetOrConstant.endsWith('w') ||
		offsetOrConstant.endsWith('week')
	) {
		const today = new Date();
		today.setUTCHours(0);
		const offsetWeeks = Number(offsetOrConstant.replace(/w(eek)?/, ''));
		return today.getTime() + offsetWeeks * 7 * 24 * 60 * 60 * 1000;
	} else if (
		offsetOrConstant.endsWith('mo') ||
		offsetOrConstant.endsWith('month')
	) {
		const today = new Date();
		today.setUTCHours(0);
		const offsetMonths = Number(offsetOrConstant.replace(/mo(nth)?/, ''));
		return today.setUTCMonth(today.getUTCMonth() + offsetMonths);
	} else if (
		offsetOrConstant.endsWith('y') ||
		offsetOrConstant.endsWith('year')
	) {
		const today = new Date();
		today.setUTCHours(0);
		const offsetYears = Number(offsetOrConstant.replace(/y(ear)?/, ''));
		return today.setUTCFullYear(today.getUTCFullYear() + offsetYears);
	}
	if (offsetOrConstant.length >= 10 && offsetOrConstant.includes('-')) {
		return new Date(offsetOrConstant).setUTCHours(0);
	}
	return undefined;
}

export function evalToISODate(
	expression: string,
	startDate: number,
	endDate: number
): string {
	if (expression.toLowerCase() === '${startdate}') {
		return toISODate(startDate);
	}
	if (expression.toLowerCase() === '${enddate}') {
		return toISODate(endDate);
	}
	const fromOffset = parseDate(expression);
	return fromOffset ? toISODate(fromOffset) : expression;
}

export function toISODate(date: number): string {
	return new Date(date).toISOString().substring(0, 10);
}

function toUTC(yearMonthDay: string): number {
	return new Date(
		Number(yearMonthDay.substr(0, 4)),
		Number(yearMonthDay.substr(5, 2)) - 1,
		Number(yearMonthDay.substr(8, 2))
	).setUTCHours(0);
}

const s3 = new S3({
	region: process.env.AWS_REGION,
	endpoint: process.env.AWS_ENDPOINT_URL,
	forcePathStyle: true,
});

/**
 * Stores a data CSV in S3.
 *
 * @param folder folder
 * @param name file name
 * @param data data
 * @param bucketName bucket name
 */
export const store = async (
	folder: string,
	name: string,
	symbol: string,
	data: TimeseriesCSV[],
	bucketName: string
): Promise<[string, PutObjectCommandOutput]> => {
	// Stringify data
	let csv = await stringifyAsync(data, { delimiter: ',', header: false });

	// Read previous data from S3
	const key = `${folder}/${name}.csv`;
	const previous = await getPreviouslyStoredData(bucketName, key, symbol, data);

	// Append previous data
	if (previous) {
		csv = previous + csv;
	}

	// Store
	return [
		csv,
		await s3.putObject({
			Bucket: bucketName,
			Key: key,
			Body: csv,
		}),
	];
};

async function getPreviouslyStoredData(
	bucketName: string,
	key: string,
	symbol: string,
	data: TimeseriesCSV[]
): Promise<string> {
	// Read from S3
	try {
		// await s3.deleteObject({ Bucket: bucketName, Key: key });
		const { Body: body } = await s3.getObject({ Bucket: bucketName, Key: key });

		// Read content of the file
		if (body instanceof Stream) {
			const content = await getStream(body);

			// Search for record with the given date
			const untilDate = data[0][1];
			const position = content.indexOf(`${symbol},${untilDate},`);
			if (position > 0) {
				return content.substring(0, position);
			}
		}
	} catch (error) {
		// Fail gracefully
		console.error(
			`Error getting previous data from S3 for ${bucketName}/${key}`,
			error
		);
	}

	// Default
	return '';
}

/**
 * Stores a data directly in S3.
 *
 * @param folder folder
 * @param name file name
 * @param data data
 * @param bucketName bucket name
 */
export const storeCSV = async (
	folder: string,
	name: string,
	bucketName: string,
	content: string
): Promise<PutObjectCommandOutput> => {
	return s3.putObject({
		Bucket: bucketName,
		Key: `${folder}/${name}.csv`,
		Body: content,
	});
};
