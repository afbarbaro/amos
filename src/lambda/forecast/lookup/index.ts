import { errorMessage, gatewayResult, Result } from '../../utils';
import { DataPoint } from '@aws-sdk/client-forecastquery';
import { S3 } from '@aws-sdk/client-s3';
import {
	APIGatewayProxyEvent,
	APIGatewayProxyHandler,
	APIGatewayProxyResult,
	Callback,
	Context,
} from 'aws-lambda';

import parse = require('csv-parse/lib/sync');
import getStream = require('get-stream');
import { Stream } from 'stream';

type Input = {
	startDate?: string;
	endDate?: string;
	symbol: string;
};

type OutputData = {
	historical: DataPoint[];
	predictions: { [x: string]: DataPoint[] };
};

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
		const [historical, predictions] = await Promise.all([
			getHistorical(input),
			getPredictions(input),
		]);

		return {
			success: true,
			data: {
				historical,
				predictions,
			},
		};
	} catch (error) {
		console.error('error', error);
		return {
			success: false,
			message: errorMessage(error),
		};
	}
}

// Read historical data from s3
async function getHistorical(input: Input): Promise<DataPoint[]> {
	let t = Date.now();
	const { Contents: files } = await s3.listObjectsV2({
		Bucket: process.env.FORECAST_BUCKET_NAME,
		Prefix: `historical/${input.symbol.replace('.', '_')}/`,
	});
	console.info(`Time to get historical S3 file key: ${Date.now() - t}`);

	t = Date.now();
	const historical: DataPoint[] = [];

	if (files) {
		const file = await s3.getObject({
			Bucket: process.env.FORECAST_BUCKET_NAME,
			Key: files[0].Key,
		});
		const csv = parse(await getStream(file.Body as Stream)) as string[][];
		for (const record of csv) {
			historical.push({ Timestamp: record[0], Value: Number(record[1]) });
		}
	}

	console.info(`Time to get historical data: ${Date.now() - t}`);
	return historical;
}

// Read predictions from s3
async function getPredictions(
	input: Input
): Promise<{ [x: string]: DataPoint[] }> {
	const t = Date.now();
	const data: { p10: DataPoint[]; p50: DataPoint[]; p90: DataPoint[] } = {
		p10: [],
		p50: [],
		p90: [],
	};

	await s3
		.getObject({
			Bucket: process.env.FORECAST_BUCKET_NAME,
			Key: `forecast/predictions/${input.symbol
				.replace('.', '_')
				.toUpperCase()}.json`,
		})
		.then(async (file) => {
			const json = JSON.parse(await getStream(file.Body as Stream)) as Record<
				string,
				[number, number, number]
			>;
			for (const date in json) {
				const values = json[date];
				data.p10.push({ Timestamp: date, Value: values[0] });
				data.p50.push({ Timestamp: date, Value: values[1] });
				data.p90.push({ Timestamp: date, Value: values[2] });
			}
		})
		.catch((error) => {
			console.error(
				`Error getting prediction data for : ${input.symbol}`,
				error
			);
		});

	console.info(`Time to get prediction data: ${Date.now() - t}`);
	return data;
}
