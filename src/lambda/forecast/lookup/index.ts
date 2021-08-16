import { errorMessage, gatewayResult, Result } from '../../utils';
import { Forecast } from '@aws-sdk/client-forecast';
import { DataPoint, Forecastquery } from '@aws-sdk/client-forecastquery';
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

type Source = {
	forecastName: string;
	forecastArn: string;
	// timeZone: string;
	// startDate: string;
	// endDate: string;
};

type OutputData = {
	historical: DataPoint[];
	source: Source | undefined;
	predictions: { [x: string]: DataPoint[] };
};

const forecasts = new Forecast({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
})
	.listForecasts({
		Filters: [
			{
				Condition: 'IS',
				Key: 'DatasetGroupArn',
				Value: process.env.FORECAST_DATASET_GROUP_ARN,
			},
			{ Condition: 'IS', Key: 'Status', Value: 'ACTIVE' },
		],
	})
	.then((forecasts) => {
		return forecasts.Forecasts?.sort(
			(a, b) =>
				(b.LastModificationTime?.getTime() || 0) -
				(a.LastModificationTime?.getTime() || 0)
		);
	});

const s3 = new S3({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
	forcePathStyle: true,
});

const query = new Forecastquery({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
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
		const source = await getForecastSource();
		const [historical, predictions] = await Promise.all([
			getHistorical(input),
			getPredictions(input, source?.forecastArn),
		]);

		return {
			success: true,
			data: {
				historical,
				source,
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

// Get latest forecast
async function getForecastSource(): Promise<Source | undefined> {
	const latestForecast = await forecasts;
	if (!latestForecast || latestForecast.length === 0) {
		return undefined;
	}
	return {
		forecastName: latestForecast[0].ForecastName!,
		forecastArn: latestForecast[0].ForecastArn!,
	};
}

// Query forecast to get predictions
async function getPredictions(
	input: Input,
	forecastArn: string | undefined
): Promise<Record<string, DataPoint[]>> {
	if (!forecastArn) {
		return {};
	}

	const t = Date.now();
	const predictions = await query
		.queryForecast({
			StartDate: input.startDate,
			EndDate: input.endDate,
			ForecastArn: forecastArn,
			Filters: { metric_name: input.symbol },
		})
		.catch((reason) => {
			console.error(`Error querying forecast for ${input.symbol}`, reason);
			return null;
		});

	console.info(`Time to get forecast predictions: ${Date.now() - t}`);
	return predictions?.Forecast?.Predictions || {};
}

// Read historical data from s3
async function getHistorical(input: Input): Promise<DataPoint[]> {
	let t = Date.now();
	const { Contents: files } = await s3.listObjectsV2({
		Bucket: process.env.FORECAST_BUCKET_NAME,
		Prefix: `historical/${input.symbol.replace('.', '_')}/`,
	});
	console.info(`Time to get S3 key: ${Date.now() - t}`);

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
