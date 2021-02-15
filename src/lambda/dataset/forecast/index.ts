import { Forecast } from '@aws-sdk/client-forecast';
import { Context, Handler } from 'aws-lambda';

const forecast = new Forecast({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

export const handler: Handler = async (
	event: {
		requestType: 'CREATE' | 'STATUS';
		predictorName: string;
		predictorArn: string;
		forecastArn: string;
	},
	_context: Context
) => {
	if (event.requestType === 'CREATE') {
		return create(event.predictorName, event.predictorArn);
	}
	return status(event.forecastArn);
};

async function create(predictorName: string, predictorArn: string) {
	// Create fcst
	const fcst = await forecast.createForecast({
		ForecastName: predictorName.replace('_predictor_', '_forecast_'),
		PredictorArn: predictorArn,
	});

	return {
		forecastArn: fcst.ForecastArn,
		forecastStatus:
			fcst?.$metadata.httpStatusCode === 200
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
