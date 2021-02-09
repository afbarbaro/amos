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
import { Construct, CustomResource, RemovalPolicy } from '@aws-cdk/core';
import { Provider } from '@aws-cdk/custom-resources';

export class ForecastDatasetResource extends Construct {
	public readonly assumeRoleArn: string;
	public readonly bucketName: string;
	public readonly datasetArn: string;
	public readonly datasetGroupArn: string;

	constructor(
		scope: Construct,
		id: string,
		props: { local: boolean; datasetSuffix: string }
	) {
		super(scope, id);

		// Create bucket for Forecast data
		const bucket = new Bucket(this, `${id}-bucket`, {
			bucketName: props.local ? `${id}-forecast-data` : undefined,
			blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
			autoDeleteObjects: true,
			removalPolicy: RemovalPolicy.DESTROY,
		});
		this.bucketName = bucket.bucketName;

		if (props.local) {
			return;
		}

		// Create IAM role for AWS Forecast
		const assumeRole = new Role(this, `${id}-forecast-role`, {
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

		// Custom Resource event handler
		const onEventHandler = new NodejsFunction(
			this,
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

		// Custom Resource Provider
		const crProvider = new Provider(
			this,
			`${id}-forecasting-custom-resource-provider`,
			{
				onEventHandler: onEventHandler,
				logRetention: RetentionDays.ONE_DAY,
			}
		);

		// Custom Resource
		const resource = new CustomResource(
			this,
			`${id}-forecasting-custom-resource`,
			{
				serviceToken: crProvider.serviceToken,
				resourceType: 'Custom::Forecast',
				properties: {
					id: id,
					datasetSuffix: props.datasetSuffix,
					bucketName: bucket.bucketName,
					assumeRoleArn: assumeRole.roleArn,
				},
			}
		);

		this.datasetArn = resource.getAttString('datasetArn');
		this.datasetGroupArn = resource.getAttString('datasetGroupArn');
	}
}
