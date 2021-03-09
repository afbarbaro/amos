import {
	CreateDatasetCommandOutput,
	CreateDatasetGroupCommandOutput,
	Forecast,
} from '@aws-sdk/client-forecast';
import {
	CloudFormationCustomResourceCreateEvent,
	CloudFormationCustomResourceDeleteEvent,
	CloudFormationCustomResourceEvent,
	CloudFormationCustomResourceResponse,
	CloudFormationCustomResourceUpdateEvent,
} from 'aws-lambda';

const forecast = new Forecast({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

function name(uuid: string, prefix: string, identifier: string): string {
	return `${prefix}_${identifier}_${uuid.substring(
		uuid.lastIndexOf('/') + 1
	)}`.replace(/-/g, '_');
}

async function createDataset(
	uuid: string,
	prefix: string
): Promise<CreateDatasetCommandOutput> {
	const datasetArn = await findDataset(uuid, prefix);
	if (datasetArn) {
		return forecast.describeDataset({ DatasetArn: datasetArn });
	}

	return forecast.createDataset({
		DatasetName: name(uuid, prefix, 'ds'),
		DatasetType: 'TARGET_TIME_SERIES',
		Domain: 'METRICS',
		DataFrequency: 'D',
		Schema: {
			Attributes: [
				{
					AttributeName: 'metric_name',
					AttributeType: 'string',
				},
				{
					AttributeName: 'timestamp',
					AttributeType: 'timestamp',
				},
				{
					AttributeName: 'metric_value',
					AttributeType: 'float',
				},
			],
		},
	});
}

async function createDatasetGroup(
	uuid: string,
	prefix: string,
	datasetArn: string
): Promise<CreateDatasetGroupCommandOutput> {
	const datasetGroupArn = await findDatasetGroup(uuid, prefix);
	if (datasetGroupArn) {
		return forecast.describeDatasetGroup({ DatasetGroupArn: datasetGroupArn });
	}

	const datasetGroup = await forecast.createDatasetGroup({
		DatasetGroupName: name(uuid, prefix, 'dsg'),
		Domain: 'METRICS',
	});

	await forecast.updateDatasetGroup({
		DatasetArns: [datasetArn],
		DatasetGroupArn: datasetGroup.DatasetGroupArn,
	});

	return datasetGroup;
}

export async function customResourceEventHandler(
	event: CloudFormationCustomResourceEvent
): Promise<void | Pick<
	CloudFormationCustomResourceResponse,
	'PhysicalResourceId' | 'Data'
>> {
	switch (event.RequestType) {
		case 'Create':
			return createHandler(event);
		case 'Update':
			return updateHandler(event);
		case 'Delete':
			return deleteHandler(event);
	}
}

async function createHandler(
	event: Omit<CloudFormationCustomResourceCreateEvent, 'RequestType'>
): Promise<
	Pick<CloudFormationCustomResourceResponse, 'PhysicalResourceId' | 'Data'>
> {
	// Validate event
	/* eslint-disable @typescript-eslint/no-unsafe-assignment */
	const id: string = event.ResourceProperties['id'];
	if (!id) {
		throw new Error('"id" is required');
	}
	/* eslint-enable @typescript-eslint/no-unsafe-assignment */

	// Create dataset
	const dataset = await createDataset(event.StackId, id);

	// Create group
	const datasetGroup = await createDatasetGroup(
		event.StackId,
		id,
		dataset.DatasetArn!
	);

	// NOTE: updates to the object key will be handled automatically: a new object will be put and then we return
	// the new name. this will tell cloudformation that the resource has been replaced and it will issue a DELETE
	// for the old object.
	return {
		PhysicalResourceId: event.RequestId,
		Data: {
			datasetArn: dataset.DatasetArn,
			datasetGroupArn: datasetGroup.DatasetGroupArn,
		},
	};
}

async function updateHandler(
	event: Omit<CloudFormationCustomResourceUpdateEvent, 'RequestType'>
): Promise<void | Pick<
	CloudFormationCustomResourceResponse,
	'PhysicalResourceId' | 'Data'
>> {
	// Validate event
	/* eslint-disable @typescript-eslint/no-unsafe-assignment */
	const id: string = event.ResourceProperties['id'];
	if (!id) {
		throw new Error('"id" is required');
	}
	const idOld: string = event.OldResourceProperties['id'];
	/* eslint-enable @typescript-eslint/no-unsafe-assignment */

	// Figure out if there's anything to do
	if (id === idOld) {
		return;
	}

	await deleteHandler(event);
	return createHandler(event);
}

async function findDataset(
	uuid: string,
	prefix: string
): Promise<string | undefined> {
	const datasetName = name(uuid, prefix, 'ds');
	const datasets = await forecast.listDatasets({});
	const dataset = datasets.Datasets?.find(
		(dataset) => dataset.DatasetName === datasetName
	);
	return dataset?.DatasetArn;
}

async function findDatasetGroup(
	uuid: string,
	prefix: string
): Promise<string | undefined> {
	const datasetGroupName = name(uuid, prefix, 'dsg');
	const datasetGroups = await forecast.listDatasetGroups({});
	const datasetGroup = datasetGroups.DatasetGroups?.find(
		(datasetGroup) => datasetGroup.DatasetGroupName === datasetGroupName
	);
	return datasetGroup?.DatasetGroupArn;
}

async function deleteHandler(
	event: Omit<CloudFormationCustomResourceDeleteEvent, 'RequestType'>
): Promise<void> {
	// Validate event
	/* eslint-disable @typescript-eslint/no-unsafe-assignment */
	const datasetArn = await findDataset(
		event.StackId,
		event.ResourceProperties.id
	);
	if (datasetArn) {
		await forecast.deleteDataset({
			DatasetArn: datasetArn,
		});
	}

	const datasetGroupArn = await findDatasetGroup(
		event.StackId,
		event.ResourceProperties.id
	);
	if (datasetGroupArn) {
		await forecast.deleteDatasetGroup({
			DatasetGroupArn: datasetGroupArn,
		});
	}
}
