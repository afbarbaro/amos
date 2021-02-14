import { Forecast } from '@aws-sdk/client-forecast';
import { Context, Handler } from 'aws-lambda';

const forecast = new Forecast({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

export const handler: Handler = async (
	event: { requestType: 'CREATE' | 'STATUS'; importJobArn: string },
	_context: Context
) => {
	if (event.requestType === 'CREATE') {
		return create();
	}
	return status(event.importJobArn);
};

async function create() {
	// Inputs
	const folder = 'training';
	const datasetPrefix = process.env.FORECAST_DATASET_PREFIX;
	const datasetArn = process.env.FORECAST_DATASET_ARN;
	const roleArn = process.env.FORECAST_ROLE_ARN;
	const bucketName = process.env.FORECAST_BUCKET_NAME;

	// Date
	const suffix = new Date().toISOString().substring(0, 10).replace('-', '');

	// Load dataset import job to see if it exists
	const existing = await forecast.listDatasetImportJobs({
		Filters: [{ Condition: 'IS', Key: 'DatasetArn', Value: datasetArn }],
	});

	if (existing.DatasetImportJobs && existing.DatasetImportJobs.length > 0) {
		// Import job exists, delete it, since it cannot be updated :(
		for (const importJob of existing.DatasetImportJobs) {
			await forecast.deleteDatasetImportJob({
				DatasetImportJobArn: importJob.DatasetImportJobArn,
			});
		}
	}

	// Create import job
	const importJob = await forecast.createDatasetImportJob({
		DatasetImportJobName: `${datasetPrefix}_dsij_${suffix}`,
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
			importJob?.$metadata.httpStatusCode === 200
				? 'CREATE_PENDING'
				: 'CREATE_FAILED',
	};
}

async function status(importJobArn: string) {
	const output = await forecast.describeDatasetImportJob({
		DatasetImportJobArn: importJobArn,
	});

	return {
		importJobArn: importJobArn,
		importJobStatus: output.Status || 'CREATE_FAILED',
	};
}
