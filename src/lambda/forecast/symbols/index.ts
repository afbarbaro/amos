import type { SymbolMeta } from '../../../api/types';
import { errorMessage, gatewayResult, Result } from '../../utils';
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

export async function lookup(): Promise<Result<SymbolMeta[]>> {
	try {
		// list config files from bucket
		const { Contents: providers } = await s3.listObjectsV2({
			Bucket: process.env.FORECAST_BUCKET_NAME,
			Prefix: 'config/symbols.',
		});

		// read each config file and get the symbols from it
		const symbols: Record<string, SymbolMeta> = {};
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
			for (const metaFile of await Promise.all(promises)) {
				const meta = JSON.parse(
					await getStream(metaFile.Body as Stream)
				) as SymbolMeta[];

				meta.forEach((symbol) => (symbols[symbol.ticker] = symbol));
			}
		}

		const data = Object.entries(symbols)
			.sort((a, b) => a[0].toUpperCase().localeCompare(b[0].toUpperCase()))
			.map((s) => s[1]);

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
