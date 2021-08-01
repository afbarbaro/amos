import { Forecast } from '@aws-sdk/client-forecast';
import { Context, Handler } from 'aws-lambda';

const MAX_ALLOWED_FORECASTS = 10;

const forecast = new Forecast({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

export const handler: Handler = async (
	event: {
		requestType: 'CREATE' | 'STATUS';
		forecastName: string;
		forecastArn: string;
		exportArn: string;
	},
	_context: Context
) => {
	if (event.requestType === 'CREATE') {
		return create(event.forecastName, event.forecastArn);
	}
	return status(event.exportArn);
};

async function create(forecastName: string, forecastArn: string) {
	await deletePreviousForecasts();

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

async function deletePreviousForecasts() {
	const exports = await forecast
		.listForecastExportJobs({
			Filters: [
				{
					Condition: 'IS',
					Key: 'DatasetGroupArn',
					Value: process.env.FORECAST_DATASET_GROUP_ARN,
				},
				{ Condition: 'IS', Key: 'Status', Value: 'ACTIVE' },
			],
		})
		.then((exports) => {
			return exports.ForecastExportJobs?.sort(
				(a, b) =>
					(a.LastModificationTime?.getTime() || 0) -
					(b.LastModificationTime?.getTime() || 0)
			);
		});

	if (exports && exports.length >= MAX_ALLOWED_FORECASTS) {
		for (let i = MAX_ALLOWED_FORECASTS; i < exports.length; i++) {
			await forecast.deleteForecastExportJob({
				ForecastExportJobArn: exports[i].ForecastExportJobArn,
			});
		}
	}
}
