import { ApiFileConfig } from '../../dataset/types';
import { gatewayResult, Result } from '../../utils';
import { GetObjectCommandOutput, S3 } from '@aws-sdk/client-s3';
import {
	APIGatewayProxyEvent,
	APIGatewayProxyHandler,
	APIGatewayProxyResult,
	Callback,
	Context,
} from 'aws-lambda';
import getStream = require('get-stream');
import { Stream } from 'stream';

const s3 = new S3({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
	forcePathStyle: true,
});

export const handler: APIGatewayProxyHandler = async (
	_event: APIGatewayProxyEvent,
	_context: Context,
	_callback: Callback<APIGatewayProxyResult>
) => {
	return gatewayResult(lookup());
};

export async function lookup(): Promise<Result<string[]>> {
	try {
		// list config files from bucket
		const { Contents: providers } = await s3.listObjectsV2({
			Bucket: process.env.FORECAST_BUCKET_NAME,
			Prefix: 'config/api.config.',
		});

		// read each config file and get the symbols from it
		const symbols = new Set<string>();
		if (providers) {
			// fetch each config file
			const promises: Promise<GetObjectCommandOutput>[] = [];
			for (const provider of providers) {
				promises.push(
					s3.getObject({
						Bucket: process.env.FORECAST_BUCKET_NAME,
						Key: provider.Key,
					})
				);
			}

			// read and parse each config file, extracting the symbols
			for (const configFile of await Promise.all(promises)) {
				const configJson = JSON.parse(
					await getStream(configFile.Body as Stream)
				) as ApiFileConfig;

				for (const [_key, value] of Object.entries(configJson)) {
					value.symbols.forEach((symbol) => symbols.add(symbol));
				}
			}
		}

		return {
			success: true,
			data: Array.from(symbols.values()).sort(),
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
