import { download, store, transform } from '../api';
import { SQS } from '@aws-sdk/client-sqs';
import { Context, Handler } from 'aws-lambda';

const sqs = new SQS({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

type Input = {
	queuedUrl: string;
	itemsQueued: number;
	itemsProcessed?: number;
	records?: number;
};

export const handler: Handler = async (
	event: Input,
	_context: Context
): Promise<Required<Input>> => {
	// Listen for messages already queued
	const received = await sqs.receiveMessage({
		QueueUrl: event.queuedUrl,
		MaxNumberOfMessages: 5,
	});

	// Init
	const folder = new Date().toISOString().substring(0, 10);
	const bucketName = process.env.FORECAST_BUCKET_NAME;
	let records = 0;

	// Processs meessages
	const messages = received.Messages || [];
	for (const message of messages) {
		const params = JSON.parse(message.Body || '{}') as Record<string, string>;
		const data = await download(params);
		const transformed = transform(params.symbol, data.timeSeries);
		const stored = await store(
			`${folder}/${params.type}`,
			params.symbol,
			transformed,
			bucketName
		);
		records += stored ? transformed.length : 0;
	}

	const itemsProcessed = event.itemsProcessed || 0 + messages.length;
	return { ...event, itemsProcessed, records };
};
