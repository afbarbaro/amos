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
		forecastName: string;
		forecastArn: string;
		exportArn: string;
	},
	_context: Context
) => {
	if (event.enabled === false || event.enabled === 'false') {
		return {
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
