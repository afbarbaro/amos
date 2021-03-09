import { Result, gatewayResult } from '../../utils';
import { Forecast } from '@aws-sdk/client-forecast';
import { DataPoint, Forecastquery } from '@aws-sdk/client-forecastquery';
import {
	APIGatewayProxyEvent,
	APIGatewayProxyHandler,
	APIGatewayProxyResult,
	Callback,
	Context,
} from 'aws-lambda';

type Input = {
	startDate?: string;
	endDate?: string;
	symbol: string;
};

type Source = {
	forecastName: string;
	forecastArn: string;
	// timeZone: string;
	// startDate: string;
	// endDate: string;
};

type OutputData = {
	source: Source;
	historical?: DataPoint[];
	predictions: { [x: string]: DataPoint[] };
};

const forecasts = new Forecast({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
})
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
				(b.LastModificationTime?.getTime() || 0) -
				(a.LastModificationTime?.getTime() || 0)
		);
	});

const query = new Forecastquery({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

export const handler: APIGatewayProxyHandler = async (
	event: APIGatewayProxyEvent,
	_context: Context,
	_callback: Callback<APIGatewayProxyResult>
) => {
	const input = event.queryStringParameters as Input;
	return gatewayResult(lookup(input));
};

export async function lookup(input: Input): Promise<Result<OutputData>> {
	// Get latest forecast
	const latestForecast = await forecasts;
	if (!latestForecast || latestForecast.length === 0) {
		return { success: false, message: 'No forecast exists yet' };
	}
	const source: Source = {
		forecastName: latestForecast[0].ForecastName!,
		forecastArn: latestForecast[0].ForecastArn!,
	};

	// Query forecast
	try {
		const output = await query.queryForecast({
			StartDate: input.startDate,
			EndDate: input.endDate,
			ForecastArn: latestForecast[0].ForecastArn,
			Filters: { metric_name: input.symbol },
		});

		return {
			success: true,
			data: { source, predictions: output.Forecast!.Predictions! },
		};
	} catch (error) {
		console.error('error', error);
		return {
			success: false,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
			message: error.toString ? error.toString() : JSON.stringify(error),
		};
	}
}
