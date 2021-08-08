import { gatewayResult, Result } from '../../utils';
import { ListObjectsV2CommandOutput, S3, _Object } from '@aws-sdk/client-s3';
import {
	APIGatewayProxyEvent,
	APIGatewayProxyHandler,
	APIGatewayProxyResult,
	Callback,
	Context,
} from 'aws-lambda';
import parse = require('csv-parse/lib/sync');
import getStream = require('get-stream');
import pLimit = require('p-limit');
import { Stream } from 'stream';

const limit = pLimit(100);

type Input = {
	startDate?: string;
	endDate?: string;
	symbol?: string;
};

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

export const handler: APIGatewayProxyHandler = async (
	event: APIGatewayProxyEvent,
	_context: Context,
	_callback: Callback<APIGatewayProxyResult>
) => {
	const input = event.queryStringParameters as Input;
	return gatewayResult(lookup(input));
};

export async function lookup(input: Input): Promise<Result<OutputData>> {
	try {
		// Get Historical and Prediction data
		const [historical, predictions] = await Promise.all([
			getHistorical(input),
			getPredictions(input),
		]);

		// Combine
		for (const symbol in predictions) {
			const prediction = predictions[symbol];
			const history = historical[symbol];
			if (history) {
				for (const date in prediction) {
					for (const forecast in prediction[date]) {
						prediction[date][forecast][0] = history[date] || NaN;
					}
				}
			}
		}

		return {
			success: true,
			data: predictions,
		};
	} catch (error) {
		console.error('error', error);
		return {
			success: false,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
			message: error.toString ? error.toString() : JSON.stringify(error),
		};
	}
}

// Read forecast data from s3
async function getPredictions(input: Input): Promise<OutputData> {
	// Init
	const startEpoch = input.startDate ? Date.parse(input.startDate) : 0;
	const endEpoch = Math.min(
		new Date().setUTCHours(0, 0, 0, 0),
		input.endDate ? Date.parse(input.endDate) : Number.MAX_SAFE_INTEGER
	);
	const fileKeyPrefix = `forecast/${process.env.FORECAST_DATASET_PREFIX}_forecast_`;
	const data: OutputData = {};

	// Read all files
	let t = Date.now();
	let continuationToken: string | undefined = undefined;
	let keepListing = true;
	const files: _Object[] = [];
	while (keepListing) {
		const results: ListObjectsV2CommandOutput = await s3.listObjectsV2({
			Bucket: process.env.FORECAST_BUCKET_NAME,
			Prefix: fileKeyPrefix,
			ContinuationToken: continuationToken,
		});

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

function toISODate(fds: string | undefined) {
	if (!fds) {
		return '';
	}
	const yr = fds.substr(0, 4);
	const mo = fds.substr(4, 2);
	const dd = fds.substr(6, 2);
	return `${yr}-${mo}-${dd}`;
}

// Read historical data from s3
async function getHistorical(
	input: Input
): Promise<Record<string, Record<string, number>>> {
	// Init
	const startEpoch = input.startDate ? Date.parse(input.startDate) : 0;
	const endEpoch = input.endDate
		? Date.parse(input.endDate)
		: Number.MAX_SAFE_INTEGER;
	const fileKeyPrefix = 'historical/';
	const data: Record<string, Record<string, number>> = {};

	// Read all files
	let t = Date.now();
	let continuationToken: string | undefined = undefined;
	let keepListing = true;
	const files: _Object[] = [];
	while (keepListing) {
		const results: ListObjectsV2CommandOutput = await s3.listObjectsV2({
			Bucket: process.env.FORECAST_BUCKET_NAME,
			Prefix: fileKeyPrefix,
			ContinuationToken: continuationToken,
		});

		results.Contents?.forEach((file) => files.push(file));
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
