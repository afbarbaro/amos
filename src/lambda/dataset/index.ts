import { download, store, transform } from './crypto';
import {
	CreateDatasetImportJobCommandOutput,
	Forecast,
} from '@aws-sdk/client-forecast';
import {
	APIGatewayProxyEvent,
	APIGatewayProxyHandler,
	APIGatewayProxyResult,
	Callback,
	Context,
} from 'aws-lambda';

const forecast = new Forecast({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

const createDatasetImportJob = async (
	nameSuffix: string,
	datasetArn: string,
	bucketName: string,
	roleArn: string
): Promise<CreateDatasetImportJobCommandOutput> => {
	return await forecast.createDatasetImportJob({
		DatasetImportJobName: `amos_dsij_${nameSuffix}`,
		DatasetArn: datasetArn,
		DataSource: {
			S3Config: {
				Path: `s3://${bucketName}/${nameSuffix}`,
				RoleArn: roleArn,
			},
		},
		TimestampFormat: 'yyyy-MM-dd',
	});
};

export const handler: APIGatewayProxyHandler = async (
	_event: APIGatewayProxyEvent,
	_context: Context,
	_callback: Callback<APIGatewayProxyResult>
) => {
	const datasetArn = process.env.FORECAST_DATASET_ARN;
	const roleArn = process.env.FORECAST_ROLE_ARN;
	const bucketName = process.env.FORECAST_BUCKET_NAME;
	const data = await download('BTC', 'DIGITAL_CURRENCY_DAILY');
	const transformed = transform('BTC', data.timeSeries);
	const stored = await store('crypto', 'BTC', transformed, bucketName);
	const dataStored = stored.$metadata.httpStatusCode === 200;

	const importJob = dataStored
		? await createDatasetImportJob('crypto', datasetArn, bucketName, roleArn)
		: undefined;

	return {
		statusCode: importJob?.$metadata.httpStatusCode || 500,
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			recordsProcessed: dataStored ? transformed.length : 0,
		}),
	};
};
