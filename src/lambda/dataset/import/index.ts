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

	// Load dataset import job to see if it exists
	const existing = await forecast.listDatasetImportJobs({
		Filters: [{ Condition: 'IS', Key: 'DatasetArn', Value: datasetArn }],
	});

	let importJobArn: string | undefined;
	let importJobStatus: string | undefined;

	if (!existing.DatasetImportJobs || existing.DatasetImportJobs.length === 0) {
		// Import job does not exists, create it
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
		importJobArn = importJob.DatasetImportJobArn;
		importJobStatus =
			importJob?.$metadata.httpStatusCode === 200 ? 'CREATED' : '';
	} else {
		// Import job exists, gather its information
		importJobArn = existing.DatasetImportJobs[0].DatasetImportJobArn;
		importJobStatus = existing.DatasetImportJobs[0].Status;
	}

	return {
		importJobArn,
		importJobStatus,
	};
};
