import { Forecast } from '@aws-sdk/client-forecast';
import { Context, Handler } from 'aws-lambda';

const forecast = new Forecast({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

export const handler: Handler = async (
	event: { requestType: 'CREATE' | 'STATUS'; predictorArn: string },
	_context: Context
) => {
	if (event.requestType === 'CREATE') {
		return create();
	}
	return status(event.predictorArn);
};

async function create() {
	// Inputs
	const datasetPrefix = process.env.FORECAST_DATASET_PREFIX;
	const datasetGroupArn = process.env.FORECAST_DATASET_GROUP_ARN;
	const maxLifeInDays = Number(process.env.FORECAST_PREDICTOR_MAX_LIFE_DAYS);

	// Load dataset predictor to see if it exists
	const existing = await forecast.listPredictors({
		Filters: [
			{ Condition: 'IS', Key: 'DatasetGroupArn', Value: datasetGroupArn },
		],
	});

	if (existing.Predictors) {
		// Cutover time is now - the max predictor life in milliseconds
		const cutoverTime = Date.now() - maxLifeInDays * 24 * 60 * 60 * 1000;

		// Find a predictor that has a creation date within the cutover
		for (const predictor of existing.Predictors) {
			const creationTime = predictor.CreationTime?.getTime();
			if (!creationTime || creationTime > cutoverTime) {
				return {
					predictorName: predictor.PredictorName,
					predictorArn: predictor.PredictorArn,
					predictorStatus: 'CREATE_PENDING',
				};
			}
		}
	}

	// Date and time (up to the minute, in UTC time zone)
	const suffix = new Date().toISOString().substring(0, 16).replace(/[-:]/g, '');

	// Create a new predictor
	const predictorName = `${datasetPrefix}_predictor_${suffix}`;
	const predictor = await forecast.createPredictor({
		PredictorName: predictorName,
		ForecastHorizon: Number(process.env.FORECAST_HORIZON_DAYS),
		InputDataConfig: { DatasetGroupArn: datasetGroupArn },
		AlgorithmArn: process.env.FORECAST_ALGORITHM_ARN,
		FeaturizationConfig: { ForecastFrequency: 'D' },
	});

	return {
		predictorName: predictorName,
		predictorArn: predictor.PredictorArn,
		predictorStatus:
			predictor?.$metadata.httpStatusCode === 200
				? 'CREATE_PENDING'
				: 'CREATE_FAILED',
	};
}

async function status(predictorArn: string) {
	const output = await forecast.describePredictor({
		PredictorArn: predictorArn,
	});

	return {
		predictorArn: predictorArn,
		predictorStatus: output.Status || 'CREATE_FAILED',
	};
}
