import { errorMessage } from '../../utils';
import {
	ListObjectsV2CommandOutput,
	PutObjectCommandOutput,
	S3,
	_Object,
} from '@aws-sdk/client-s3';
import { Handler } from 'aws-lambda';
import parse = require('csv-parse/lib/sync');
import getStream = require('get-stream');
import pLimit = require('p-limit');
import { Stream } from 'stream';

// Limit how many promises can go out in parallel
const limit = pLimit(100);

// How many days to lookback for incremental build up of accuracy
const MAX_FORECAST_LOOKBACK_DAYS =
	-1 * Number(process.env.FORECAST_PREDICTOR_HORIZON_DAYS || 31);

const s3 = new S3({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
	forcePathStyle: true,
});

type Data = {
	[date: string]: typeof date extends 'BAND' ? never : [number, number, number];
} & { BAND?: [number, number, number, number] };
type SymbolData = Record<string, Data>;
type OutputData = Record<string, SymbolData>;

export type Event = {
	enabled: boolean | string;
	rebuild: boolean;
	forecastName: string;
};

export const handler: Handler<
	Event,
	{
		success: boolean;
		files: number;
		errors: Record<string, string>;
	}
> = async (event: Event) => {
	if (event.enabled === false || event.enabled === 'false') {
		return {
			success: true,
			files: 0,
			errors: {},
		};
	}
	return await compute(event.forecastName, event.rebuild);
};

// eslint-disable-next-line complexity -- complexity is ~10, still makes sense to keep the logic together rather than breaking it into too-think slices
async function compute(
	forecastName: string,
	rebuild: boolean
): Promise<{
	success: boolean;
	files: number;
	errors: Record<string, string>;
}> {
	// Init
	const startDate = getStartDate(forecastName, rebuild);

	// Get Historical, Prediction, and previous Accuracy data
	const [historical, [predictions, latestPredictions], accuracy] =
		await Promise.all([
			getHistorical(startDate),
			getPredictions(forecastName, startDate),
			rebuild ? Promise.resolve({} as OutputData) : getAccuracy(),
		]);

	// Combine and store predictions
	const errors: Record<string, string> = {};
	const s3Promises: Promise<PutObjectCommandOutput | void>[] = [];
	for (const symbol in predictions) {
		// Fail safe
		const history = historical[symbol];
		if (!history) {
			continue;
		}

		// Merge with previous accuracy data
		accuracy[symbol] = accuracy[symbol] || {};

		// Compute Accuracy
		const prediction = sort(predictions[symbol]);

		for (const date in prediction) {
			// Do not process for dates with no historical data
			if (!(date in history)) {
				continue;
			}

			// merge with previous
			accuracy[symbol][date] =
				date in accuracy[symbol]
					? sort({ ...accuracy[symbol][date], ...prediction[date] })
					: sort(prediction[date]);

			// compute band, add actual value
			delete accuracy[symbol][date]['BAND'];
			const forecastDates = Object.keys(accuracy[symbol][date]);
			const actual = round(history[date]);
			const n = forecastDates.length;
			const a = 2 / (n + 1);
			const band: [number, number, number, number] = [
				Number.MAX_SAFE_INTEGER,
				accuracy[symbol][date][forecastDates[0]][1],
				Number.MIN_SAFE_INTEGER,
				actual,
			];
			for (const predDate in accuracy[symbol][date]) {
				if (band[0] > accuracy[symbol][date][predDate][0]) {
					band[0] = accuracy[symbol][date][predDate][0];
				}
				if (band[2] < accuracy[symbol][date][predDate][2]) {
					band[2] = accuracy[symbol][date][predDate][2];
				}
				band[1] = a * accuracy[symbol][date][predDate][1] + (1 - a) * band[1];
			}
			band[1] = round(band[1]);
			accuracy[symbol][date]['BAND'] = band;
		}

		// store accuracy
		s3Promises.push(
			s3
				.putObject({
					Bucket: process.env.FORECAST_BUCKET_NAME,
					Key: `accuracy/${symbol}.json`,
					Body: JSON.stringify(accuracy[symbol], null, 2),
				})
				.catch((error) => {
					console.warn('Error saving accuracy for symbol', symbol, error);
					errors[symbol] = errorMessage(error);
				})
		);

		// store latest predictions
		s3Promises.push(
			s3
				.putObject({
					Bucket: process.env.FORECAST_BUCKET_NAME,
					Key: `forecast/predictions/${symbol}.json`,
					Body: JSON.stringify(latestPredictions[symbol], null, 2),
				})
				.catch((error) => {
					console.warn('Error saving prediction for symbol', symbol, error);
					errors[symbol] = errorMessage(error);
				})
		);
	}

	// await all promises
	await Promise.all(s3Promises);

	return {
		success: Object.keys(errors).length === 0,
		files: Object.keys(accuracy).length,
		errors,
	};
}

function getStartDate(forecastName: string, rebuild: boolean) {
	const forecastDate = forecastName.substr(
		forecastName.lastIndexOf('_') + 1,
		8
	);

	return !rebuild && forecastDate
		? toISODate(forecastDate, MAX_FORECAST_LOOKBACK_DAYS)
		: undefined;
}

// Read forecast data from s3
async function getPredictions(
	forecastName: string,
	startDate: string | undefined
): Promise<[OutputData, SymbolData]> {
	// Init
	const startEpoch = startDate ? Date.parse(startDate) : 0;
	const fileKeyPrefix = `forecast/${process.env.FORECAST_DATASET_PREFIX}_forecast_`;
	const data: OutputData = {};
	const latestData: SymbolData = {};

	// Read all files
	let t = Date.now();
	let continuationToken: string | undefined = undefined;
	let keepListing = true;
	const files: _Object[] = [];
	while (keepListing) {
		// List objects
		const results: ListObjectsV2CommandOutput = await s3.listObjectsV2({
			Bucket: process.env.FORECAST_BUCKET_NAME,
			Prefix: fileKeyPrefix,
			ContinuationToken: continuationToken,
		});

		// Filter by dates
		results.Contents?.forEach((file) => {
			const date = Date.parse(
				toISODate(file.Key?.substr(fileKeyPrefix.length, 8))
			);
			if (date >= startEpoch) {
				files.push(file);
			}
		});

		// Keep listing if needed
		continuationToken = results.NextContinuationToken;
		keepListing = !!continuationToken;
	}
	console.info(
		`Time to get ${files.length} prediction files from S3: ${Date.now() - t}`
	);

	// Read file contents
	if (files) {
		t = Date.now();
		const dataPromises = files.map((file) =>
			limit(() =>
				s3
					.getObject({
						Bucket: process.env.FORECAST_BUCKET_NAME,
						Key: file.Key,
					})
					.then((content) => getStream(content.Body as Stream))
					.then((body) => {
						const forecastDate = toISODate(
							file.Key?.substr(fileKeyPrefix.length, 8)
						);
						const latest = file.Key?.includes(forecastName);
						const csv = parse(body) as string[][];
						let symbol = '';
						let symbolData: SymbolData = {};
						for (const record of csv) {
							if (symbol !== record[0]) {
								symbol = record[0].toUpperCase();
								data[symbol] = data[symbol] || {};
								symbolData = data[symbol];
								latestData[symbol] = latestData[symbol] || {};
							}
							const ds = record[1].substring(0, 10);
							symbolData[ds] = symbolData[ds] || {};
							symbolData[ds][forecastDate] = [
								round(Number(record[2])),
								round(Number(record[3])),
								round(Number(record[4])),
							];
							if (latest) {
								latestData[symbol][ds] = symbolData[ds][forecastDate];
							}
						}
					})
					.catch((e) => {
						console.error(`Error reading file ${file.Key || ''}`, e);
					})
			)
		);

		await Promise.all(dataPromises);
	}

	console.info(`Time to get prediction data: ${Date.now() - t}`);
	return [data, latestData];
}

// Read historical data from s3
async function getHistorical(
	startDate: string | undefined
): Promise<Record<string, Record<string, number>>> {
	// Init
	const startEpoch = startDate
		? Date.parse(startDate)
		: Date.now() - 31 * 24 * 3600000;
	const fileKeyPrefix = 'historical/';
	const data: Record<string, Record<string, number>> = {};

	// Read all files
	let t = Date.now();
	let continuationToken: string | undefined = undefined;
	let keepListing = true;
	const files: _Object[] = [];
	while (keepListing) {
		// List objects
		const results: ListObjectsV2CommandOutput = await s3.listObjectsV2({
			Bucket: process.env.FORECAST_BUCKET_NAME,
			Prefix: fileKeyPrefix,
			ContinuationToken: continuationToken,
		});
		results.Contents?.forEach((file) => files.push(file));

		// Keep listing if needed
		continuationToken = results.NextContinuationToken;
		keepListing = !!continuationToken;
	}
	console.info(
		`Time to get ${files.length} historical files from S3: ${Date.now() - t}`
	);

	// Read file contents
	if (files) {
		t = Date.now();
		const dataPromises = files.map((file) =>
			limit(() =>
				s3
					.getObject({
						Bucket: process.env.FORECAST_BUCKET_NAME,
						Key: file.Key,
					})
					.then((content) => getStream(content.Body as Stream))
					.then((body) => {
						const csv = parse(body) as string[][];
						const symbolData: Record<string, number> = {};
						for (const record of csv) {
							const ds = record[0];
							const dt = Date.parse(ds);
							if (dt >= startEpoch) {
								symbolData[ds] = Number(record[1]);
							}
						}
						let symbol = file.Key?.substring(fileKeyPrefix.length) || '';
						symbol = symbol.substring(0, symbol.indexOf('/')).toUpperCase();
						data[symbol] = symbolData;
					})
					.catch((e) => {
						console.error(`Error reading file ${file.Key || ''}`, e);
					})
			)
		);

		await Promise.all(dataPromises);
		console.info(`Time to get historical data: ${Date.now() - t}`);
	}

	return data;
}

// Read accuracy data from s3
async function getAccuracy(): Promise<Record<string, SymbolData>> {
	// Init
	const fileKeyPrefix = 'accuracy/';
	const data: OutputData = {};

	// Read all files
	let t = Date.now();
	let continuationToken: string | undefined = undefined;
	let keepListing = true;
	const files: _Object[] = [];
	while (keepListing) {
		// List objects
		const results: ListObjectsV2CommandOutput = await s3.listObjectsV2({
			Bucket: process.env.FORECAST_BUCKET_NAME,
			Prefix: fileKeyPrefix,
			ContinuationToken: continuationToken,
		});
		results.Contents?.forEach((file) => files.push(file));

		// Keep listing if needed
		continuationToken = results.NextContinuationToken;
		keepListing = !!continuationToken;
	}
	console.info(
		`Time to get ${files.length} accuracy files from S3: ${Date.now() - t}`
	);

	// Read file contents
	if (files) {
		t = Date.now();
		const dataPromises = files.map((file) =>
			limit(() =>
				s3
					.getObject({
						Bucket: process.env.FORECAST_BUCKET_NAME,
						Key: file.Key,
					})
					.then((content) => getStream(content.Body as Stream))
					.then((body) => {
						const symbolData = JSON.parse(body) as SymbolData;
						let symbol = file.Key?.substring(fileKeyPrefix.length) || '';
						symbol = symbol.substring(0, symbol.indexOf('.')).toUpperCase();
						data[symbol] = symbolData;
					})
					.catch((e) => {
						console.error(`Error reading file ${file.Key || ''}`, e);
					})
			)
		);

		await Promise.all(dataPromises);
		console.info(`Time to get accuracy data: ${Date.now() - t}`);
	}

	return data;
}

function toISODate(ymd: string | undefined, offsetInDays = 0) {
	if (!ymd) {
		return '';
	}
	const yr = ymd.substr(0, 4);
	const mo = ymd.substr(4, 2);
	const dd = ymd.substr(6, 2);
	const dt = `${yr}-${mo}-${dd}`;
	return offsetInDays == 0
		? dt
		: new Date(Date.parse(dt) + offsetInDays * 24 * 3600000).toISOString();
}

function sort<T = unknown>(obj: Record<string, T>): Record<string, T> {
	return Object.keys(obj)
		.sort()
		.reduce<Record<string, T>>((res, key) => ((res[key] = obj[key]), res), {});
}

function round(x: number): number {
	return Number(x.toFixed(3));
}
