import { download, store, transform } from '../api';
import {
	DeleteMessageBatchRequestEntry,
	Message,
	SQS,
} from '@aws-sdk/client-sqs';
import { Context, Handler } from 'aws-lambda';

const sqs = new SQS({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

type Input = {
	queueUrl: string;
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
		QueueUrl: event.queueUrl,
		MaxNumberOfMessages: 4,
	});

	// Init
	const bucketName = process.env.FORECAST_BUCKET_NAME;
	let records = 0;

	// Processs meessages
	const messages = received.Messages || [];
	const processedMessages: DeleteMessageBatchRequestEntry[] = [];
	const promises = [];
	for (const message of messages) {
		promises.push(
			processMessage(message, bucketName).then(([rec, msg]) => {
				if (msg) {
					records += rec;
					processedMessages.push({
						Id: msg.MessageId,
						ReceiptHandle: msg.ReceiptHandle,
					});
				}
				console.info(
					`${msg ? 'successfully processed ' : 'failed to process '}
					${message.Body || ''}`
				);
			})
		);
	}

	// Await all promises
	await Promise.all(promises);

	// Delete Processed Messages
	if (processedMessages.length > 0) {
		await sqs.deleteMessageBatch({
			QueueUrl: event.queueUrl,
			Entries: processedMessages,
		});
	}

	// Output
	const itemsProcessed = (event.itemsProcessed || 0) + processedMessages.length;
	return { ...event, itemsProcessed, records };
};

async function processMessage(
	message: Message,
	bucketName: string
): Promise<[number, Message | undefined]> {
	try {
		const params = JSON.parse(message.Body || '{}') as Record<string, string>;

		const data = await download(params);

		const transformed = transform(params.symbol, params.field, data.timeSeries);

		const stored = await store(
			'training',
			`${params.type}_${params.symbol}`,
			transformed,
			bucketName
		);

		return stored ? [transformed.length, message] : [0, undefined];
	} catch (error) {
		return [0, undefined];
	}
}
