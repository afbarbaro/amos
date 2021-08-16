import { Forecast } from '@aws-sdk/client-forecast';
import { Context, Handler } from 'aws-lambda';

const forecast = new Forecast({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

export const handler: Handler = async (
	event: {
		requestType: 'CREATE' | 'STATUS';
		enabled: boolean | string;
		importJobArn: string;
	},
	_context: Context
) => {
	if (event.enabled === false || event.enabled === 'false') {
		return {
			enabled: event.enabled,
			importJobStatus: 'ACTIVE',
			importJobArn: '',
		};
	}
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

	// Date and time (up to the minute, in UTC time zone)
	const suffix = new Date().toISOString().substring(0, 16).replace(/[-:]/g, '');

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
