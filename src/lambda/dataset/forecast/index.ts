import { Forecast } from '@aws-sdk/client-forecast';
import { Context, Handler } from 'aws-lambda';

const forecast = new Forecast({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

export const handler: Handler = async (
	event: {
		requestType: 'CREATE' | 'STATUS';
		predictorArn: string;
		forecastArn: string;
	},
	_context: Context
) => {
	if (event.requestType === 'CREATE') {
		return create(event.predictorArn);
	}
	return status(event.forecastArn);
};

async function create(predictorArn: string) {
	// Inputs
	const datasetPrefix = process.env.FORECAST_DATASET_PREFIX;

	// Load dataset xForecast to see if it exists
	const existing = await forecast.listForecasts({
		Filters: [{ Condition: 'IS', Key: 'PredictorArn', Value: predictorArn }],
	});

	if (existing.Forecasts && existing.Forecasts.length > 0) {
		// Forecast exists, use it
		return {
			forecastArn: existing.Forecasts[0].ForecastArn,
			forecastStatus: 'CREATE_PENDING',
		};
	}

	// Create xForecast
	const xForecast = await forecast.createForecast({
		ForecastName: `${datasetPrefix}_forecast`,
		PredictorArn: predictorArn,
	});

	return {
		forecastArn: xForecast.ForecastArn,
		forecastStatus:
			xForecast?.$metadata.httpStatusCode === 200
				? 'CREATE_PENDING'
				: 'CREATE_FAILED',
	};
}

async function status(forecastArn: string) {
	const output = await forecast.describeForecast({
		ForecastArn: forecastArn,
	});

	return {
		forecastArn: forecastArn,
		forecastStatus: output.Status || 'CREATE_FAILED',
	};
}
