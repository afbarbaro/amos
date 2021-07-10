import {
	download,
	parseDate,
	providerConfigurations,
	reverseChronologyAndFillNonTradingDays,
	store,
	transform,
} from '../api';
import { ApiMessage, ApiProvider, ApiRateLimit } from '../types';
import {
	DeleteMessageBatchRequestEntry,
	Message,
	SQS,
} from '@aws-sdk/client-sqs';
import { Context, Handler } from 'aws-lambda';

const SQS_BATCH_MAX_MESSAGES = 10;

const sqs = new SQS({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

type Input = {
	options: { downloadStartDate: string; downloadEndDate: string };
	rateLimits: { [K in ApiProvider]?: ApiRateLimit };
	queueUrl: string;
	itemsQueued: number;
	itemsProcessed?: number;
	workedMessages?: number;
	failures?: Record<string, number>;
};

/**
 * Lambda handler
 * @param event Event
 * @param _context Not used
 */
export const handler: Handler = async (
	event: Input,
	_context: Context
): Promise<Required<Input>> => {
	// Get Download dates
	const { downloadStartDate, downloadEndDate } = getDownloadDates(event);

	// Initialize call by provider counter
	const providerCalls = Object.fromEntries(
		providerConfigurations.map((config) => [config.provider, {}])
	) as Record<ApiProvider, Record<number, number>>;
	const maxApiCalls = Number(process.env.DATASET_API_MAX_CALLS_PER_MINUTE);

	// Initialize output variables
	const failures = event.failures ?? {};
	let totalProcessedMessages = 0;
	let emptyReceives = 0;

	// Listen for messages already queued
	while (totalProcessedMessages < maxApiCalls) {
		// one batch
		const processedMessages = await receiveAndProcessMessages(
			event.queueUrl,
			downloadStartDate,
			downloadEndDate,
			maxApiCalls,
			providerCalls,
			event.rateLimits,
			failures
		);

		// break if no messages were received (we're done)
		if (processedMessages === 0) {
			emptyReceives++;
			if (emptyReceives >= 2) {
				const attributes = await sqs.getQueueAttributes({
					QueueUrl: event.queueUrl,
					AttributeNames: ['ApproximateNumberOfMessages'],
				});
				const messagesInQueue = Number(
					attributes.Attributes?.['ApproximateNumberOfMessages']
				);
				console.info(`ApproximateNumberOfMessages: ${messagesInQueue}`);
				if (messagesInQueue > 0 && totalProcessedMessages === 0) {
					totalProcessedMessages = -1;
				}
				break;
			}
		}

		// Increment count
		totalProcessedMessages += processedMessages;
	}

	// Output
	const itemsProcessed = (event.itemsProcessed || 0) + totalProcessedMessages;
	return {
		...event,
		itemsProcessed,
		workedMessages: totalProcessedMessages,
		failures,
	};
};

async function receiveAndProcessMessages(
	queueUrl: string,
	downloadStartDate: number,
	downloadEndDate: number,
	maxApiCalls: number,
	providerCalls: Partial<Record<ApiProvider, Record<number, number>>>,
	rateLimits: { [K in ApiProvider]?: ApiRateLimit },
	failures: Record<string, number>
) {
	// Receive messages from the queue
	const received = await sqs.receiveMessage({
		QueueUrl: queueUrl,
		WaitTimeSeconds: 1,
		ReceiveRequestAttemptId: Date.now().toString(),
		MaxNumberOfMessages: Math.min(SQS_BATCH_MAX_MESSAGES, maxApiCalls),
		AttributeNames: ['MessageId'],
	});
	if (!received.Messages || received.Messages.length === 0) {
		console.info('No messages received');
	}

	// Process received messages
	const messages = received.Messages || [];
	const workedMessages: DeleteMessageBatchRequestEntry[] = [];
	const promises = [];
	for (const message of messages) {
		promises.push(
			processMessage(
				message,
				process.env.FORECAST_BUCKET_NAME,
				downloadStartDate,
				downloadEndDate,
				providerCalls,
				rateLimits
			).then(([_records, success]) => {
				const messageUniqueId = message.Attributes!.MessageId;
				if (success) {
					// Processed successfully: add message to array o processed messages, remove tracking of any previous failures
					workedMessages.push({
						Id: message.MessageId,
						ReceiptHandle: message.ReceiptHandle,
					});
					if (failures[messageUniqueId]) {
						delete failures[messageUniqueId];
					}
				} else {
					// Failed to process: keep track of failures or give up after too many attemps
					const failureCount = failures[messageUniqueId] || 0;
					if (failureCount < 3) {
						console.warn(`failed to process ${messageUniqueId}`);
						failures[messageUniqueId] = failureCount + 1;
					} else {
						console.warn(`gave up processing ${messageUniqueId}`);
						workedMessages.push({
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
	if (workedMessages.length > 0) {
		await sqs.deleteMessageBatch({
			QueueUrl: queueUrl,
			Entries: workedMessages,
		});
	}

	// Output
	return messages.length;
}

function getDownloadDates(event: Input) {
	const downloadStartDate = parseDate(
		event.options.downloadStartDate ||
			process.env.DATASET_API_DOWNLOAD_START_DATE
	);
	if (!downloadStartDate) {
		throw new Error(
			`downloadStartDate is a required input and it was not provided or invalid: ${event.options.downloadStartDate}`
		);
	}
	const downloadEndDate = parseDate(
		event.options.downloadEndDate || process.env.DATASET_API_DOWNLOAD_END_DATE
	);
	if (!downloadEndDate) {
		throw new Error(
			`downloadEndDate is a required input and it was not provided or invalid: ${event.options.downloadEndDate}`
		);
	}
	return { downloadStartDate, downloadEndDate };
}

async function processMessage(
	message: Message,
	bucketName: string,
	startDate: number,
	endDate: number,
	providerCalls: Partial<Record<ApiProvider, Record<number, number>>>,
	rateLimits: { [K in ApiProvider]?: ApiRateLimit }
): Promise<[number, boolean]> {
	try {
		// Parse message body
		const apiMessage = JSON.parse(message.Body || '{}') as ApiMessage;

		// Check against rate limit
		const now = new Date();
		const minute = now.getUTCHours() * 60 + now.getMinutes();
		const limits = rateLimits[apiMessage.provider] || {
			perMinute: Number.MAX_SAFE_INTEGER,
			perHour: Number.MAX_SAFE_INTEGER,
		};
		const calls = providerCalls[apiMessage.provider]![minute] || 0;
		if (calls > limits.perMinute) {
			return [0, false];
		}

		// Call the API to download data
		const data = await download(apiMessage, startDate, endDate);

		// Count message against rate limit
		providerCalls[apiMessage.provider]![minute] = calls + 1;

		// Transform
		const transformed = reverseChronologyAndFillNonTradingDays(
			transform(
				apiMessage.symbol,
				apiMessage.call.response.valueProperty,
				data
			),
			apiMessage.call.response.order
		);

		// Store
		const stored = await store(
			`training/${apiMessage.symbol.replace('.', '_')}`,
			`${apiMessage.provider}-${apiMessage.type}`,
			apiMessage.symbol,
			transformed,
			bucketName
		);

		// Return
		return stored ? [transformed.length, true] : [0, false];
	} catch (error) {
		// Ignore the error, return a signaling message was not processed
		return [0, false];
	}
}
