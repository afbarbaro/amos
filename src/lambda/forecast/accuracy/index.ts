import { errorMessage, gatewayResult, Result } from '../../utils';
import { S3 } from '@aws-sdk/client-s3';
import {
	APIGatewayProxyEvent,
	APIGatewayProxyHandler,
	APIGatewayProxyResult,
	Callback,
	Context,
} from 'aws-lambda';
import getStream = require('get-stream');
import { Stream } from 'stream';

type Input = {
	symbol: string;
	startDate?: string;
	endDate?: string;
};

type SymbolData = Record<
	string,
	Record<string, [number, number, number, number]>
>;

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

export async function lookup(input: Input): Promise<Result<SymbolData>> {
	try {
		// Init
		const startEpoch = input.startDate ? Date.parse(input.startDate) : 0;
		const endEpoch = Math.min(
			new Date().setUTCHours(0, 0, 0, 0),
			input.endDate ? Date.parse(input.endDate) : Number.MAX_SAFE_INTEGER
		);

		// Read data
		const data = await s3
			.getObject({
				Bucket: process.env.FORECAST_BUCKET_NAME,
				Key: `accuracy/${input.symbol}.json`,
			})
			.then((content) => getStream(content.Body as Stream))
			.then((body) => {
				const data = JSON.parse(body) as SymbolData;
				for (const date in data) {
					const dt = Date.parse(date);
					if (dt < startEpoch || dt > endEpoch) {
						delete data[date];
					}
				}
				return data;
			});

		return {
			success: true,
			data,
		};
	} catch (error) {
		console.error('error', error);
		return {
			success: false,
			message: errorMessage(error),
		};
	}
}
