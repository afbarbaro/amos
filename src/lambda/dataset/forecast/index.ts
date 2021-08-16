import { Forecast } from '@aws-sdk/client-forecast';
import { Context, Handler } from 'aws-lambda';

const MAX_ALLOWED_FORECASTS = 9;

const forecast = new Forecast({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

export const handler: Handler = async (
	event: {
		requestType: 'CREATE' | 'STATUS';
		enabled: boolean | string;
		predictorName: string;
		predictorArn: string;
		forecastName: string;
		forecastArn: string;
	},
	_context: Context
) => {
	if (event.requestType === 'CREATE') {
		return create(
			event.predictorName,
			event.predictorArn,
			event.enabled === false || event.enabled === 'false'
		);
	}
	return status(event.forecastName, event.forecastArn);
};

async function create(
	predictorName: string,
	predictorArn: string,
	disabled: boolean
) {
	if (disabled) {
		return findExisting(process.env.FORECAST_DATASET_GROUP_ARN);
	}

	// Delete previous (AWS only lets you keep a limited amount and throws LimitExceededException)
	await deletePreviousForecasts(process.env.FORECAST_DATASET_GROUP_ARN);

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

async function deletePreviousForecasts(datasetGroupArn: string) {
	const forecasts = await forecast
		.listForecasts({
			Filters: [
				{
					Condition: 'IS',
					Key: 'DatasetGroupArn',
					Value: datasetGroupArn,
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
		for (let i = MAX_ALLOWED_FORECASTS - 1; i < forecasts?.length; i++) {
			await forecast.deleteForecast({ ForecastArn: forecasts[i].ForecastArn });
		}
	}
}

async function findExisting(datasetGroupArn: string) {
	// Load dataset predictor to see if it exists
	const existing = await forecast.listForecasts({
		Filters: [
			{
				Condition: 'IS',
				Key: 'DatasetGroupArn',
				Value: datasetGroupArn,
			},
			{ Condition: 'IS', Key: 'Status', Value: 'ACTIVE' },
		],
		MaxResults: 1,
	});

	if (existing.Forecasts && existing.Forecasts.length > 0) {
		return {
			forecastName: existing.Forecasts[0].ForecastName,
			forecastArn: existing.Forecasts[0].ForecastArn,
			forecastStatus: existing.Forecasts[0].Status,
		};
	}

	return null;
}
