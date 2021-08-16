import { Forecast } from '@aws-sdk/client-forecast';
import { Context, Handler } from 'aws-lambda';

const MAX_ALLOWED_EXPORT_JOBS = 9;

const forecast = new Forecast({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

export const handler: Handler = async (
	event: {
		requestType: 'CREATE' | 'STATUS';
		enabled: boolean | string;
		forecastName: string;
		forecastArn: string;
		exportArn: string;
	},
	_context: Context
) => {
	if (event.enabled === false || event.enabled === 'false') {
		return {
			enabled: event.enabled,
			exportArn: '',
			exportStatus: 'ACTIVE',
		};
	}
	if (event.requestType === 'CREATE') {
		return create(event.forecastName, event.forecastArn);
	}
	return status(event.exportArn);
};

async function create(forecastName: string, forecastArn: string) {
	// Delete previous (AWS only lets you keep a limited amount and throws LimitExceededException)
	await deletePreviousForecastExportJobs(forecastName);

	const roleArn = process.env.FORECAST_ROLE_ARN;
	const bucketName = process.env.FORECAST_BUCKET_NAME;

	// Create export job
	const exportJob = await forecast.createForecastExportJob({
		ForecastExportJobName: forecastName,
		ForecastArn: forecastArn,
		Destination: {
			S3Config: {
				RoleArn: roleArn,
				Path: `s3://${bucketName}/forecast/`,
			},
		},
	});

	return {
		exportArn: exportJob.ForecastExportJobArn,
		exportStatus:
			exportJob?.$metadata.httpStatusCode === 200
				? 'CREATE_PENDING'
				: 'CREATE_FAILED',
	};
}

async function status(exportArn: string) {
	const output = await forecast.describeForecastExportJob({
		ForecastExportJobArn: exportArn,
	});

	return {
		exportArn,
		exportStatus: output.Status || 'CREATE_FAILED',
	};
}

async function deletePreviousForecastExportJobs(forecastName: string) {
	const namePrefix = forecastName.substring(0, forecastName.lastIndexOf('_'));
	const exportJobs = await forecast
		.listForecastExportJobs({
			Filters: [{ Condition: 'IS', Key: 'Status', Value: 'ACTIVE' }],
		})
		.then((exportJobs) => {
			return exportJobs.ForecastExportJobs?.filter((e) =>
				e.ForecastExportJobName?.startsWith(namePrefix)
			).sort(
				(a, b) =>
					(a.LastModificationTime?.getTime() || 0) -
					(b.LastModificationTime?.getTime() || 0)
			);
		});

	if (exportJobs && exportJobs.length >= MAX_ALLOWED_EXPORT_JOBS) {
		for (let i = MAX_ALLOWED_EXPORT_JOBS - 1; i < exportJobs.length; i++) {
			await forecast.deleteForecastExportJob({
				ForecastExportJobArn: exportJobs[i].ForecastExportJobArn,
			});
		}
	}
}
