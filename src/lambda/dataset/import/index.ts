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
	const folder = 'training';
	const datasetPrefix = process.env.FORECAST_DATASET_PREFIX;
	const datasetArn = process.env.FORECAST_DATASET_ARN;
	const roleArn = process.env.FORECAST_ROLE_ARN;
	const bucketName = process.env.FORECAST_BUCKET_NAME;

	// Load dataset import job to see if it exists
	const existing = await forecast.listDatasetImportJobs({
		Filters: [{ Condition: 'IS', Key: 'DatasetArn', Value: datasetArn }],
	});

	if (existing.DatasetImportJobs && existing.DatasetImportJobs.length > 0) {
		// Import job exists, delete it, since it cannot be updated :(
		await forecast.deleteDatasetImportJob({
			DatasetImportJobArn: existing.DatasetImportJobs[0].DatasetImportJobArn,
		});
	}

	// Create import job
	const importJob = await forecast.createDatasetImportJob({
		DatasetImportJobName: `${datasetPrefix}_dsij`,
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
		importJobArn: importJob.DatasetImportJobArn,
		importJobStatus:
			importJob?.$metadata.httpStatusCode === 200 ? 'CREATED' : '',
	};
};
