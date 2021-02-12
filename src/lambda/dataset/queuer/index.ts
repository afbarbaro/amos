import { config } from '../api.config';
import { SendMessageBatchRequestEntry, SQS } from '@aws-sdk/client-sqs';
import { Context, Handler } from 'aws-lambda';

const BATCH_MAX_MESSAGES = 10;

const sqs = new SQS({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

export const handler: Handler = async (
	event: { queueUrl: string },
	_context: Context
): Promise<{
	queueUrl: string;
	itemsQueued: number;
	waitSeconds: number;
}> => {
	let messages: SendMessageBatchRequestEntry[] = [];

	// Loop through types
	for (const [type, call] of Object.entries(config)) {
		// Loop through functions
		for (let i = 0; i < call.functions.length; i++) {
			// Loop through symbolls
			for (const symbol of call.symbols) {
				// Parameters for the API calls
				const params = {
					type,
					symbol,
					function: call.functions[i],
					...call.parameters[i],
				};

				// Construct message
				const messageId = `${type}-${symbol}-${call.functions[i]}`;
				messages.push({
					Id: messageId,
					MessageDeduplicationId: messageId,
					MessageGroupId: 'default',
					MessageBody: JSON.stringify(params),
				});

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
	}

	// Send last batch of messages if we reach the limit
	if (messages.length > 0) {
		await sqs.sendMessageBatch({
			QueueUrl: event.queueUrl,
			Entries: messages,
		});
	}

	// Output
	return {
		...event,
		itemsQueued: messages.length,
		waitSeconds: 60,
	};
};
