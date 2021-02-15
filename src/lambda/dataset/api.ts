import {
	TimeseriesCSV,
	TimeSeriesData,
	TimeSeriesMetaData,
	TimeSeriesResponse,
} from './types';
import { PutObjectCommandOutput, S3 } from '@aws-sdk/client-s3';
import axios, { AxiosRequestConfig } from 'axios';
import stringify = require('csv-stringify');
import getStream = require('get-stream');
import { Stream } from 'stream';
import { promisify } from 'util';

const stringifyAsync = promisify(
	(
		input: stringify.Input,
		options?: stringify.Options,
		callback?: stringify.Callback
	): stringify.Stringifier => stringify(input, options, callback)
);

export const download = (params: object): Promise<TimeSeriesResponse> => {
	const options: AxiosRequestConfig = {
		method: 'GET',
		url: 'https://alpha-vantage.p.rapidapi.com/query',
		params,
		headers: {
			'x-rapidapi-key': process.env.RAPIDAPI_KEY,
			'x-rapidapi-host': 'alpha-vantage.p.rapidapi.com',
			useQueryString: true,
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
	field: string,
	data: TimeSeriesData
): TimeseriesCSV[] => {
	const transformed = Object.entries(data).map((point) => {
		return [symbol, point[0], point[1][field]] as TimeseriesCSV;
	});
	return transformed;
};

const s3 = new S3({
	region: process.env.AWS_REGION,
	endpoint: process.env.AWS_ENDPOINT_URL,
});

export const store = async (
	folder: string,
	name: string,
	data: TimeseriesCSV[],
	bucketName: string
): Promise<PutObjectCommandOutput> => {
	// Stringify data
	let csv = await stringifyAsync(data, { delimiter: ',', header: false });

	// Read previous data from S3
	const key = `${folder}/${name}.csv`;
	const previous = await getPreviousData(bucketName, key, data);

	// Append previous data
	if (previous) {
		csv += previous;
	}

	// Store
	return s3.putObject({
		Bucket: bucketName,
		Key: key,
		Body: csv,
	});
};

async function getPreviousData(
	bucketName: string,
	key: string,
	data: TimeseriesCSV[]
): Promise<string> {
	// Read from S3
	try {
		const { Body: body } = await s3.getObject({ Bucket: bucketName, Key: key });

		// Read content of the file
		if (body instanceof Stream) {
			const content = await getStream(body);

			// Search for record with the given date
			const untilDate = data[data.length - 1][1];
			let position = content.indexOf(`,${untilDate},`);
			if (position > 0) {
				// go to end of line
				position = content.indexOf('\n', position);
			}
			if (position > 0) {
				// return next line forward
				return content.substring(position + 1);
			}
		}
	} catch (error) {
		// Fail gracefully
		console.error(
			`Error getting previous data from S3 for ${bucketName}/${key}`,
			error
		);
	}

	// Default
	return '';
}
