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

	// Load dataset predictor to see if it exists
	const existing = await forecast.listPredictors({
		Filters: [
			{ Condition: 'IS', Key: 'DatasetGroupArn', Value: datasetGroupArn },
		],
	});

	if (existing.Predictors && existing.Predictors.length > 0) {
		// Predictor exists, use it
		return {
			predictorArn: existing.Predictors[0].PredictorArn,
			predictorStatus: 'CREATE_PENDING',
		};
	}

	// Create predictor
	const predictor = await forecast.createPredictor({
		PredictorName: `${datasetPrefix}_predictor`,
		ForecastHorizon: Number(process.env.FORECAST_HORIZON_DAYS),
		InputDataConfig: { DatasetGroupArn: datasetGroupArn },
		AlgorithmArn: process.env.FORECAST_ALGORITHM_ARN,
		FeaturizationConfig: { ForecastFrequency: 'D' },
	});

	return {
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
