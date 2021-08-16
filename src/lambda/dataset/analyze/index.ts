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

const limit = pLimit(100);

type SymbolData = Record<
	string,
	Record<string, [number, number, number, number]>
>;
type OutputData = Record<string, SymbolData>;

const s3 = new S3({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
	forcePathStyle: true,
});

export const handler: Handler = async (event: {
	enabled: boolean | string;
	rebuild: boolean;
	forecastName: string;
}) => {
	if (event.enabled === false || event.enabled === 'false') {
		return {
			success: true,
		};
	}
	return compute(event.forecastName, event.rebuild);
};

async function compute(
	forecastName: string,
	rebuild: boolean
): Promise<{
	success: boolean;
	files: number;
	errors: Record<string, string>;
}> {
	// Get Historical and Prediction data
	const startDate =
		rebuild && forecastName
			? toISODate(forecastName.substr(forecastName.lastIndexOf('_') + 1, 8))
			: undefined;

	const [historical, predictions] = await Promise.all([
		getHistorical(startDate),
		getPredictions(startDate),
	]);

	// Combine and store predictions
	const errors: Record<string, string> = {};
	const s3Promises: Promise<PutObjectCommandOutput | void>[] = [];
	for (const symbol in predictions) {
		// compute
		const prediction = predictions[symbol];
		const history = historical[symbol];
		if (history) {
			for (const date in prediction) {
				for (const forecast in prediction[date]) {
					prediction[date][forecast][0] = history[date] || NaN;
				}
			}
		}

		// store
		s3Promises.push(
			s3
				.putObject({
					Bucket: process.env.FORECAST_BUCKET_NAME,
					Key: `accuracy/${symbol}.json`,
					Body: JSON.stringify(prediction, null, 2),
				})
				.catch((error) => {
					console.warn('Error saving accuracy for symbol', symbol, error);
					errors[symbol] = errorMessage(error);
				})
		);
	}

	// await all promises
	await Promise.all(s3Promises);

	return {
		success: Object.keys(errors).length === 0,
		files: Object.keys(predictions).length,
		errors,
	};
}

// Read forecast data from s3
async function getPredictions(
	startDate: string | undefined,
	endDate?: string | undefined
): Promise<OutputData> {
	// Init
	const startEpoch = startDate ? Date.parse(startDate) : 0;
	const endEpoch = Math.min(
		new Date().setUTCHours(0, 0, 0, 0),
		endDate ? Date.parse(endDate) : Number.MAX_SAFE_INTEGER
	);
	const fileKeyPrefix = `forecast/${process.env.FORECAST_DATASET_PREFIX}_forecast_`;
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

		// Filter by dates
		let afterEndEpoch = true;
		results.Contents?.forEach((file) => {
			const date = Date.parse(
				toISODate(file.Key?.substr(fileKeyPrefix.length, 8))
			);
			if (date >= startEpoch && date <= endEpoch) {
				afterEndEpoch = false;
				files.push(file);
			} else if (date < endEpoch) {
				afterEndEpoch = false;
			}
		});

		// Keep listing if needed
		continuationToken = results.NextContinuationToken;
		keepListing = !afterEndEpoch && !!continuationToken;
	}
	console.info(`Time to get ${files.length} files from S3: ${Date.now() - t}`);

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
						const csv = parse(body) as string[][];
						let symbol = csv[0][0];
						let symbolData: SymbolData = {};
						for (const record of csv) {
							if (symbol !== record[0]) {
								symbol = record[0].toUpperCase();
								data[symbol] = data[symbol] || {};
								symbolData = data[symbol];
							}
							const ds = record[1].substring(0, 10);
							if (Date.parse(ds) <= endEpoch) {
								symbolData[ds] = symbolData[ds] || {};
								symbolData[ds][forecastDate] = [
									NaN,
									Number(record[2]),
									Number(record[3]),
									Number(record[4]),
								];
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
	return data;
}

// Read historical data from s3
async function getHistorical(
	startDate: string | undefined,
	endDate?: string | undefined
): Promise<Record<string, Record<string, number>>> {
	// Init
	const startEpoch = startDate ? Date.parse(startDate) : 0;
	const endEpoch = endDate ? Date.parse(endDate) : Number.MAX_SAFE_INTEGER;
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
	console.info(`Time to get ${files.length} files from S3: ${Date.now() - t}`);

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
							if (dt >= startEpoch && dt <= endEpoch) {
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

function toISODate(ymd: string | undefined) {
	if (!ymd) {
		return '';
	}
	const yr = ymd.substr(0, 4);
	const mo = ymd.substr(4, 2);
	const dd = ymd.substr(6, 2);
	return `${yr}-${mo}-${dd}`;
}
