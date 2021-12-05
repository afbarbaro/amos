import {
	CreateAutoPredictorCommandInput,
	Forecast,
} from '@aws-sdk/client-forecast';
import { Context, Handler } from 'aws-lambda';

const MAX_ALLOWED_PREDICTORS = 9;

const forecast = new Forecast({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

export const handler: Handler = async (
	event: {
		requestType: 'CREATE' | 'STATUS';
		enabled: boolean | string;
		predictorArn: string;
	},
	_context: Context
) => {
	if (event.requestType === 'CREATE') {
		return create(event.enabled === false || event.enabled === 'false');
	}
	return status(event.predictorArn);
};

async function create(disabled: boolean) {
	// Inputs
	const datasetPrefix = process.env.FORECAST_DATASET_PREFIX;
	const datasetGroupArn = process.env.FORECAST_DATASET_GROUP_ARN;
	const maxLifeInDays = Number(process.env.FORECAST_PREDICTOR_MAX_LIFE_DAYS);

	// Find existing
	const existing = await findExisting(datasetGroupArn, maxLifeInDays, disabled);
	if (existing && !existing.retrain) {
		return existing;
	}

	// Delete previous (AWS only lets you keep a limited amount and throws LimitExceededException)
	await deletePreviousPredictors(datasetGroupArn);

	// Date and time (up to the minute, in UTC time zone)
	const suffix = new Date().toISOString().substring(0, 16).replace(/[-:]/g, '');

	// Create a new predictor
	const predictorName = `${datasetPrefix}_predictor_${suffix}`;
	const input: CreateAutoPredictorCommandInput = existing?.retrain
		? {
				PredictorName: predictorName,
				ReferencePredictorArn: existing.predictorArn,
		  }
		: {
				PredictorName: predictorName,
				ForecastHorizon: Number(process.env.FORECAST_PREDICTOR_HORIZON_DAYS),
				DataConfig: { DatasetGroupArn: datasetGroupArn },
				ForecastFrequency: 'D',
		  };
	const predictor = await forecast.createAutoPredictor(input);

	return {
		predictorName: predictorName,
		predictorArn: predictor.PredictorArn,
		predictorStatus:
			predictor.$metadata.httpStatusCode === 200
				? 'CREATE_PENDING'
				: 'CREATE_FAILED',
	};
}

async function status(predictorArn: string) {
	const output = await forecast.describeAutoPredictor({
		PredictorArn: predictorArn,
	});

	return {
		predictorName: output.PredictorName,
		predictorArn,
		predictorStatus: output.Status || 'CREATE_FAILED',
	};
}

async function deletePreviousPredictors(datasetGroupArn: string) {
	const predictors = await forecast
		.listPredictors({
			Filters: [
				{ Condition: 'IS', Key: 'DatasetGroupArn', Value: datasetGroupArn },
				{ Condition: 'IS', Key: 'Status', Value: 'ACTIVE' },
			],
		})
		.then((output) => {
			return output.Predictors?.sort(
				(a, b) =>
					((b.LastModificationTime || b.CreationTime)?.getTime() || 0) -
					((a.LastModificationTime || a.CreationTime)?.getTime() || 0)
			);
		});

	if (predictors && predictors.length >= MAX_ALLOWED_PREDICTORS) {
		for (let i = MAX_ALLOWED_PREDICTORS - 1; i < predictors?.length; i++) {
			await forecast.deletePredictor({
				PredictorArn: predictors[i].PredictorArn,
			});
		}
	}
}

async function findExisting(
	datasetGroupArn: string,
	maxLifeInDays: number,
	disabled: boolean
) {
	// Load dataset predictors ordered from most recent to least recent
	const existing = await forecast
		.listPredictors({
			Filters: [
				{ Condition: 'IS', Key: 'DatasetGroupArn', Value: datasetGroupArn },
			],
		})
		.then((output) =>
			output.Predictors?.filter(
				(p) => p.Status && !p.Status.startsWith('DELETE')
			)
				.sort(
					(a, b) =>
						((b.LastModificationTime || b.CreationTime)?.getTime() || 0) -
						((a.LastModificationTime || a.CreationTime)?.getTime() || 0)
				)
				.pop()
		);

	if (existing) {
		// Cutover time is now - the max predictor life in milliseconds with a buffer of 1/2 day
		const cutoverTime = Date.now() - (maxLifeInDays * 24 - 12) * 60 * 60 * 1000;

		// Find a predictor that has a creation date within the cutover
		return {
			retrain:
				!disabled && (existing.CreationTime?.getTime() || 0) < cutoverTime,
			predictorName: existing.PredictorName,
			predictorArn: existing.PredictorArn,
			predictorStatus: existing.Status,
		};
	}

	return null;
}
