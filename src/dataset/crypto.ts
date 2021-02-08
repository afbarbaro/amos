import {
	TimeSeriesFunction,
	TimeSeriesResponse,
	TimeSeriesData,
	TimeseriesCSV,
	TimeSeriesMetaData,
} from './types';
import { PutObjectCommandOutput, S3 } from '@aws-sdk/client-s3';
import axios, { AxiosRequestConfig } from 'axios';
import * as stringify from 'csv-stringify/lib/es5/sync';

export const download = (
	symbol: string,
	series: TimeSeriesFunction
): Promise<TimeSeriesResponse> => {
	const options: AxiosRequestConfig = {
		method: 'GET',
		url: 'https://alpha-vantage.p.rapidapi.com/query',
		params: { market: 'USD', symbol, function: series },
		headers: {
			'x-rapidapi-key': process.env.RAPIDAPI_KEY,
			'x-rapidapi-host': 'alpha-vantage.p.rapidapi.com',
		},
	};

	return axios
		.request(options)
		.then((response) => {
			// console.log(response.data);
			/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
			const data = response.data;
			const metaData: TimeSeriesMetaData = data['Meta Data'];
			const timeSeries: TimeSeriesData = data[Object.keys(data)[1]];
			/* eslint-enable @typescript-eslint/no-unsafe-assignment */
			return { metaData, timeSeries } as TimeSeriesResponse;
		})
		.catch((error) => {
			console.error('Error fetching data', error);
			throw error;
		});
};

export const transform = (
	symbol: string,
	data: TimeSeriesData
): TimeseriesCSV[] => {
	const transformed = Object.entries(data).map((point) => {
		return [symbol, point[0], point[1]['4b. close (USD)']] as TimeseriesCSV;
	});
	return transformed;
};

export const store = (
	suffix: string,
	symbol: string,
	data: TimeseriesCSV[]
): Promise<PutObjectCommandOutput> => {
	const csv = stringify(data, { delimiter: ',', header: false });
	const s3 = new S3({
		region: process.env.AWS_REGION,
		endpoint: process.env.AWS_ENDPOINT_URL,
	});
	return s3.putObject({
		Bucket: 'amos-forecast-data',
		Key: `${suffix}/training_${symbol}.csv`,
		Body: csv,
	});
};
