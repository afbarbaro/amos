import {
	CreateDatasetCommandOutput,
	CreateDatasetGroupCommandOutput,
	DatasetGroupSummary,
	DatasetSummary,
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

async function findDataset(
	id: string,
	datasetNameSuffix: string
): Promise<{ dataset: DatasetSummary | undefined; datasetName: string }> {
	const datasetName = `${id}_ds_${datasetNameSuffix}`;
	const existing = await forecast.listDatasets({});
	const dataset = existing.Datasets?.find(
		(dataset) => dataset.DatasetName === datasetName
	);
	return { dataset, datasetName };
}

async function findDatasetGroup(
	id: string,
	datasetGroupNameSuffix: string
): Promise<{
	datasetGroup: DatasetGroupSummary | undefined;
	datasetGroupName: string;
}> {
	const datasetGroupName = `${id}_dsg_${datasetGroupNameSuffix}`;
	const existing = await forecast.listDatasetGroups({});
	const datasetGroup = existing.DatasetGroups?.find(
		(datasetGroup) => datasetGroup.DatasetGroupName === datasetGroupName
	);
	return { datasetGroup, datasetGroupName };
}

const createDataset = async (
	id: string,
	datasetNameSuffix: string
): Promise<CreateDatasetCommandOutput> => {
	const { dataset, datasetName } = await findDataset(id, datasetNameSuffix);
	if (dataset) {
		return { DatasetArn: dataset.DatasetArn, $metadata: {} };
	}

	return forecast.createDataset({
		DatasetName: datasetName,
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
};

const createDatasetGroup = async (
	id: string,
	datasetGroupNameSuffix: string,
	datasetArn: string
): Promise<CreateDatasetGroupCommandOutput> => {
	const { datasetGroup: existing, datasetGroupName } = await findDatasetGroup(
		id,
		datasetGroupNameSuffix
	);
	if (existing) {
		return { DatasetGroupArn: existing.DatasetGroupArn, $metadata: {} };
	}

	const datasetGroup = await forecast.createDatasetGroup({
		DatasetGroupName: datasetGroupName,
		Domain: 'METRICS',
	});

	await forecast.updateDatasetGroup({
		DatasetArns: [datasetArn],
		DatasetGroupArn: datasetGroup.DatasetGroupArn,
	});

	return datasetGroup;
};

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
	const datasetSuffix: string = event.ResourceProperties['datasetSuffix'];
	if (!datasetSuffix) {
		throw new Error('"datasetSuffix" is required');
	}
	const bucketName: string = event.ResourceProperties['bucketName'];
	if (!bucketName) {
		throw new Error('"bucketName" is required');
	}
	const assumeRoleArn: string = event.ResourceProperties['assumeRoleArn'];
	if (!assumeRoleArn) {
		throw new Error('"assumeRoleArn" is required');
	}
	/* eslint-enable @typescript-eslint/no-unsafe-assignment */

	// Create dataset
	const dataset = await createDataset(id, datasetSuffix);
	const datasetArn = dataset.DatasetArn!;

	// Create group
	const datasetGroup = await createDatasetGroup(id, datasetSuffix, datasetArn);

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
	const datasetSuffix: string = event.ResourceProperties['datasetSuffix'];
	if (!datasetSuffix) {
		throw new Error('"datasetSuffix" is required');
	}
	const datasetSuffixOld: string = event.OldResourceProperties['datasetSuffix'];

	const bucketName: string = event.ResourceProperties['bucketName'];
	if (!bucketName) {
		throw new Error('"bucketName" is required');
	}
	const bucketNameOld: string = event.OldResourceProperties['datasetSuffix'];

	const assumeRoleArn: string = event.ResourceProperties['assumeRoleArn'];
	if (!assumeRoleArn) {
		throw new Error('"assumeRoleArn" is required');
	}
	const assumeRoleArnOld: string = event.OldResourceProperties['assumeRoleArn'];
	/* eslint-enable @typescript-eslint/no-unsafe-assignment */

	// Figure out if there's anything to do
	if (
		datasetSuffix === datasetSuffixOld &&
		bucketName === bucketNameOld &&
		assumeRoleArn === assumeRoleArnOld
	) {
		return;
	}

	await deleteHandler(event);
	return createHandler(event);
}

async function deleteHandler(
	event: Omit<CloudFormationCustomResourceDeleteEvent, 'RequestType'>
): Promise<void> {
	// Validate event
	/* eslint-disable @typescript-eslint/no-unsafe-assignment */
	const datasetArn: string = event.ResourceProperties.datasetArn;
	if (datasetArn) {
		await forecast.deleteDataset({
			DatasetArn: datasetArn,
		});
	}

	const datasetGroupArn: string = event.ResourceProperties.datasetGroupArn;
	if (datasetGroupArn) {
		await forecast.deleteDatasetGroup({
			DatasetGroupArn: datasetGroupArn,
		});
	}
}
