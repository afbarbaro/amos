import { download, store, transform } from './crypto';
import {
	CreateDatasetImportJobCommandOutput,
	DatasetSummary,
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

async function findDataset(
	id: string,
	datasetNameSuffix: string
): Promise<DatasetSummary | undefined> {
	const datasetName = `${id}_ds_${datasetNameSuffix}`;
	const existing = await forecast.listDatasets({});
	const dataset = existing.Datasets?.find(
		(dataset) => dataset.DatasetName === datasetName
	);
	return dataset;
}

const createDatasetImportJob = async (
	nameSuffix: string,
	bucketName: string,
	roleArn: string
): Promise<CreateDatasetImportJobCommandOutput> => {
	const dataset = await findDataset('amos', nameSuffix);
	if (dataset) {
		return await forecast.createDatasetImportJob({
			DatasetImportJobName: `amos_dsij_${nameSuffix}`,
			DatasetArn: dataset.DatasetArn!,
			DataSource: {
				S3Config: {
					Path: `s3://${bucketName}/${nameSuffix}`,
					RoleArn: roleArn,
				},
			},
			TimestampFormat: 'yyyy-MM-dd',
		});
	}
	return { $metadata: {} };
};

export const handler: APIGatewayProxyHandler = async (
	_event: APIGatewayProxyEvent,
	_context: Context,
	_callback: Callback<APIGatewayProxyResult>
) => {
	const roleArn = process.env.FORECAST_ROLE_ARN;
	const bucketName = process.env.FORECAST_BUCKET_NAME;
	const data = await download('BTC', 'DIGITAL_CURRENCY_DAILY');
	const transformed = transform('BTC', data.timeSeries);
	const stored = await store('crypto', 'BTC', transformed, bucketName);
	const dataStored = stored.$metadata.httpStatusCode === 200;

	const importJob = dataStored
		? await createDatasetImportJob('crypto', bucketName, roleArn)
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
