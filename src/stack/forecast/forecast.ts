import {
	Effect,
	ManagedPolicy,
	PolicyStatement,
	Role,
	ServicePrincipal,
} from '@aws-cdk/aws-iam';
import { Runtime } from '@aws-cdk/aws-lambda';
import { NodejsFunction } from '@aws-cdk/aws-lambda-nodejs';
import { RetentionDays } from '@aws-cdk/aws-logs';
import { BlockPublicAccess, Bucket } from '@aws-cdk/aws-s3';
import { Construct, CustomResource } from '@aws-cdk/core';
import { Provider } from '@aws-cdk/custom-resources';

export class ForecastDatasetResource extends Construct {
	public readonly assumeRoleArn: string;

	constructor(
		scope: Construct,
		id: string,
		props: { bucketName: string; datasetSuffix: string }
	) {
		super(scope, id);

		// Create IAM role for AWS Forecast
		const assumeRole = new Role(scope, `${id}-forecast-role`, {
			description: `${id}-forecast-role`,
			assumedBy: new ServicePrincipal('forecast.amazonaws.com'),
		});
		assumeRole.assumeRolePolicy?.addStatements(
			new PolicyStatement({
				effect: Effect.ALLOW,
				actions: ['sts:AssumeRole'],
				principals: [new ServicePrincipal('forecast.amazonaws.com')],
			})
		);
		assumeRole.addManagedPolicy(
			ManagedPolicy.fromAwsManagedPolicyName('AmazonForecastFullAccess')
		);
		assumeRole.addManagedPolicy(
			ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess')
		);
		this.assumeRoleArn = assumeRole.roleArn;

		// Create bucket
		new Bucket(scope, `${id}-bucket`, {
			bucketName: props.bucketName,
			blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
		});

		const onEventHandler = new NodejsFunction(
			scope,
			`${id}-forecasting-custom-resource-event-handler`,
			{
				runtime: Runtime.NODEJS_12_X,
				entry: `${__dirname}/handler.ts`,
				handler: 'customResourceEventHandler',
				initialPolicy: [
					new PolicyStatement({
						resources: ['*'],
						actions: ['forecast:*', 'iam:PassRole'],
					}),
				],
			}
		);

		const crProvider = new Provider(
			scope,
			`${id}-forecasting-custom-resource-provider`,
			{
				onEventHandler: onEventHandler,
				logRetention: RetentionDays.ONE_DAY,
			}
		);

		new CustomResource(scope, `${id}-forecasting-custom-resource`, {
			serviceToken: crProvider.serviceToken,
			resourceType: 'Custom::Forecast',
			properties: {
				id: id,
				datasetSuffix: props.datasetSuffix,
				bucketName: props.bucketName,
				assumeRoleArn: assumeRole.roleArn,
			},
		});
	}
}
