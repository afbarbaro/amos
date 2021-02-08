import { download, store, transform } from '../../dataset/crypto';
import { findDataset } from '../../stack/forecast/handler';
import {
	CreateDatasetImportJobCommandOutput,
	Forecast,
} from '@aws-sdk/client-forecast';
import { IAM } from '@aws-sdk/client-iam';
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

const iam = new IAM({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

const createDatasetImportJob = async (
	nameSuffix: string
): Promise<CreateDatasetImportJobCommandOutput> => {
	const { dataset } = await findDataset('amos', nameSuffix);
	const role = await iam.listRoles({});
	if (dataset && role.Roles) {
		return await forecast.createDatasetImportJob({
			DatasetImportJobName: `amos_dsij_${nameSuffix}`,
			DatasetArn: dataset.DatasetArn!,
			DataSource: {
				S3Config: {
					Path: `s3://amos-forecast-data/${nameSuffix}`,
					RoleArn: role.Roles[0].Arn!,
				},
			},
		});
	}
	return { $metadata: {} };
};

export const handler: APIGatewayProxyHandler = async (
	_event: APIGatewayProxyEvent,
	_context: Context,
	_callback: Callback<APIGatewayProxyResult>
) => {
	const data = await download('BTC', 'DIGITAL_CURRENCY_DAILY');
	const transformed = transform('BTC', data.timeSeries);
	const stored = await store('crypto', 'BTC', transformed);
	const dataStored = stored.$metadata.httpStatusCode === 200;

	const importJob = dataStored
		? await createDatasetImportJob('crypto')
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
