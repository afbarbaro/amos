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
		predictorName: string;
		predictorArn: string;
		forecastName: string;
		forecastArn: string;
	},
	_context: Context
) => {
	if (event.requestType === 'CREATE') {
		return create(event.predictorName, event.predictorArn);
	}
	return status(event.forecastName, event.forecastArn);
};

async function create(predictorName: string, predictorArn: string) {
	await deletePreviousForecasts();

	// Name prefix (same as the prefix used in the predictor name)
	const prefix = predictorName.substr(0, predictorName.indexOf('_predictor_'));
	// Date and time (up to the minute, in UTC time zone)
	const suffix = new Date().toISOString().substring(0, 16).replace(/[-:]/g, '');

	// Create forecast
	const forecastName = `${prefix}_forecast_${suffix}`;
	const fcst = await forecast.createForecast({
		ForecastName: forecastName,
		PredictorArn: predictorArn,
	});

	return {
		forecastName,
		forecastArn: fcst.ForecastArn,
		forecastStatus:
			fcst?.$metadata.httpStatusCode === 200
				? 'CREATE_PENDING'
				: 'CREATE_FAILED',
	};
}

async function status(forecastName: string, forecastArn: string) {
	const output = await forecast.describeForecast({
		ForecastArn: forecastArn,
	});

	return {
		forecastName,
		forecastArn: forecastArn,
		forecastStatus: output.Status || 'CREATE_FAILED',
	};
}

async function deletePreviousForecasts() {
	const forecasts = await forecast
		.listForecasts({
			Filters: [
				{
					Condition: 'IS',
					Key: 'DatasetGroupArn',
					Value: process.env.FORECAST_DATASET_GROUP_ARN,
				},
				{ Condition: 'IS', Key: 'Status', Value: 'ACTIVE' },
			],
		})
		.then((forecasts) => {
			return forecasts.Forecasts?.sort(
				(a, b) =>
					(a.LastModificationTime?.getTime() || 0) -
					(b.LastModificationTime?.getTime() || 0)
			);
		});

	if (forecasts && forecasts.length >= MAX_ALLOWED_FORECASTS) {
		for (let i = MAX_ALLOWED_FORECASTS; i < forecasts?.length; i++) {
			await forecast.deleteForecast({ ForecastArn: forecasts[i].ForecastArn });
		}
	}
}
