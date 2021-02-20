import {
	download,
	parseDate,
	reverseAndFillNonTradingDays,
	store,
	transform,
} from '../api';
import { ApiMessage } from '../types';
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
	downloadStartDate: string;
	downloadEndDate: string;
	queueUrl: string;
	itemsQueued: number;
	itemsProcessed?: number;
	messagesReceived?: number;
	records?: number;
	failures?: Record<string, number>;
};

export const handler: Handler = async (
	event: Input,
	_context: Context
): Promise<Required<Input>> => {
	// Listen for messages already queued
	const received = await sqs.receiveMessage({
		QueueUrl: event.queueUrl,
		MaxNumberOfMessages: Number(process.env.DATASET_API_MAX_CALLS_PER_MINUTE),
		AttributeNames: ['MessageDeduplicationId'],
	});

	// Init
	const { downloadStartDate, downloadEndDate } = getDownloadDates(event);

	const bucketName = process.env.FORECAST_BUCKET_NAME;
	const failures = event.failures ?? {};
	let records = 0;

	// Processs meessages
	const messages = received.Messages || [];
	const processedMessages: DeleteMessageBatchRequestEntry[] = [];
	const promises = [];
	for (const message of messages) {
		promises.push(
			processMessage(
				message,
				bucketName,
				downloadStartDate,
				downloadEndDate
			).then(([rec, success]) => {
				const messageUniqueId = message.Attributes!.MessageDeduplicationId;
				if (success) {
					// Processed successfully: add message to array o processed messages, remove tracking of any previous failures
					records += rec;
					processedMessages.push({
						Id: message.MessageId,
						ReceiptHandle: message.ReceiptHandle,
					});
					console.info(`successfully processed ${messageUniqueId}`);
					if (failures[messageUniqueId]) {
						delete failures[messageUniqueId];
					}
				} else {
					// Failed to process: keep track of failures or give up after too many attemps
					const failureCount = failures[messageUniqueId] || 0;
					if (failureCount < 3) {
						console.info(`failed to process ${messageUniqueId}`);
						failures[messageUniqueId] = failureCount + 1;
					} else {
						console.info(`gave up processing ${messageUniqueId}`);
						processedMessages.push({
							Id: message.MessageId,
							ReceiptHandle: message.ReceiptHandle,
						});
					}
				}
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
	return {
		...event,
		itemsProcessed,
		messagesReceived: messages.length,
		records,
		failures,
	};
};

function getDownloadDates(event: Input) {
	const downloadStartDate = parseDate(
		event.downloadStartDate || process.env.DATASET_API_DOWNLOAD_START_DATE
	);
	if (!downloadStartDate) {
		throw new Error(
			`downloadStartDate is a required input and it was not provided or invalid: ${event.downloadStartDate}`
		);
	}
	const downloadEndDate = parseDate(
		event.downloadEndDate || process.env.DATASET_API_DOWNLOAD_END_DATE
	);
	if (!downloadEndDate) {
		throw new Error(
			`downloadEndDate is a required input and it was not provided or invalid: ${event.downloadEndDate}`
		);
	}
	return { downloadStartDate, downloadEndDate };
}

async function processMessage(
	message: Message,
	bucketName: string,
	startDate: number,
	endDate: number
): Promise<[number, boolean]> {
	try {
		const apiMessage = JSON.parse(message.Body || '{}') as ApiMessage;

		const data = await download(apiMessage, startDate, endDate);

		const transformed = reverseAndFillNonTradingDays(
			transform(apiMessage.symbol, apiMessage.call.response.valueProperty, data)
		);

		const stored = await store(
			'training',
			`${apiMessage.type}_${apiMessage.symbol}`,
			apiMessage.symbol,
			transformed,
			bucketName
		);

		return stored ? [transformed.length, true] : [0, false];
	} catch (error) {
		return [0, false];
	}
}
