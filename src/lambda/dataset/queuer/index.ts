import { config } from '../api.config.alphavantage';
import { SendMessageBatchRequestEntry, SQS } from '@aws-sdk/client-sqs';
import { Context, Handler } from 'aws-lambda';

const BATCH_MAX_MESSAGES = 10;

const sqs = new SQS({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

export const handler: Handler = async (
	event: { queueUrl: string; options?: { skipQueueing?: boolean } },
	_context: Context
): Promise<{
	itemsQueued: number;
	waitSeconds: number;
}> => {
	// Exit early if queueing is to be skipped
	if (event.options?.skipQueueing) {
		return { ...event, itemsQueued: 0, waitSeconds: 66 };
	}
	let messages: SendMessageBatchRequestEntry[] = [];
	let itemsQueued = 0;

	// Loop through types
	for (const [type, call] of Object.entries(config)) {
		// Loop through symbolls
		for (const symbol of call.symbols) {
			// Parameters for the API calls
			const params = {
				type,
				symbol,
				call,
			};

			// Construct message
			const messageId = `${type}-${symbol.replace('.', '_')}-${call.function}`;
			messages.push({
				Id: messageId,
				MessageDeduplicationId: messageId,
				MessageGroupId: 'default',
				MessageBody: JSON.stringify(params),
			});
			itemsQueued++;

			// Send batch of messages if we reach the limit
			if (messages.length === BATCH_MAX_MESSAGES) {
				await sqs.sendMessageBatch({
					QueueUrl: event.queueUrl,
					Entries: messages,
				});
				messages = [];
			}
		}
	}

	// Send last batch of messages if we reach the limit
	if (messages.length > 0) {
		await sqs.sendMessageBatch({
			QueueUrl: event.queueUrl,
			Entries: messages,
		});
	}

	// Output
	return { ...event, itemsQueued, waitSeconds: 66 };
};
