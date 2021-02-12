import { Forecast } from '@aws-sdk/client-forecast';
import { APIGatewayProxyEvent, Context, Handler } from 'aws-lambda';

const forecast = new Forecast({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

export const handler: Handler = async (
	_event: APIGatewayProxyEvent,
	_context: Context
) => {
	const folder = new Date().toISOString().substring(0, 10).replace(/-/g, '');
	const datasetPrefix = process.env.FORECAST_DATASET_PREFIX;
	const datasetArn = process.env.FORECAST_DATASET_ARN;
	const roleArn = process.env.FORECAST_ROLE_ARN;
	const bucketName = process.env.FORECAST_BUCKET_NAME;

	const importJob = await forecast.createDatasetImportJob({
		DatasetImportJobName: `${datasetPrefix}_dsij_${folder}`,
		DatasetArn: datasetArn,
		DataSource: {
			S3Config: {
				Path: `s3://${bucketName}/${folder}/`,
				RoleArn: roleArn,
			},
		},
		TimestampFormat: 'yyyy-MM-dd',
	});

	return {
		importJobArn: importJob?.DatasetImportJobArn,
		importJobStatus: importJob?.$metadata.httpStatusCode,
	};
};
