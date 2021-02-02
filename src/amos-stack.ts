import { LambdaIntegration, RestApi } from '@aws-cdk/aws-apigateway';
import { Code, Runtime, Function } from '@aws-cdk/aws-lambda';
import { NodejsFunction } from '@aws-cdk/aws-lambda-nodejs';
import { Bucket } from '@aws-cdk/aws-s3';
import * as cdk from '@aws-cdk/core';
import { CfnOutput } from '@aws-cdk/core';
import { readdirSync } from 'fs';

const USE_NODEJSFUNCTION = false;
const lambdaPath = `${__dirname.replace(
	'/src',
	USE_NODEJSFUNCTION ? '/src' : '/dist/src'
)}/lambda`;

console.info(`Lambda Path: ${lambdaPath}`);

export class AmosStack extends cdk.Stack {
	constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		const api = new RestApi(this, 'api', {});
		const s3Bucket = Bucket.fromBucketName(
			this,
			'LocalStackBucket',
			'__local__'
		);

		readdirSync(lambdaPath).forEach((lambdaDir) => {
			console.info(`Configuring Lambda ${lambdaDir}`);

			let lambda;
			if (USE_NODEJSFUNCTION) {
				lambda = new NodejsFunction(this, lambdaDir, {
					entry: `${lambdaPath}/${lambdaDir}/index.ts`,
					handler: 'handler',
				});
			} else {
				lambda = new Function(this, lambdaDir, {
					runtime: Runtime.NODEJS_12_X,
					// code: Code.fromAsset('dist/lib/forecast'),
					code: Code.fromBucket(s3Bucket, `${lambdaPath}/${lambdaDir}`),
					handler: 'index.handler',
				});
			}

			const lambdaIntegration = new LambdaIntegration(lambda);
			const lambdaResource = api.root.addResource(lambdaDir);
			lambdaResource.addMethod('GET', lambdaIntegration);
			// console.info(`http://localhost:4566/restapis/${api.restApiId}/prod/_user_request_${lambdaResource.path}`);
			new CfnOutput(this, `Endpoint-${lambdaDir}`, {
				value: `http://localhost:4566/restapis/${api.restApiId}/prod/_user_request_${lambdaResource.path}`,
			});

			// const lambda2 = new NodejsFunction(this, 'data-processing', {
			//   entry: `${lambdaPath}/data-processing/index.ts`,
			//   handler: "handler"
			// });

			// const lambdaIntegration2 = new LambdaIntegration(lambda2)
			// const lambdaResource2 = api.root.addResource('data-processing')
			// lambdaResource2.addMethod("GET", lambdaIntegration2)
			// new CfnOutput(this, "Endpoint2", { value: `http://localhost:4566/restapis/${api.restApiId}/prod/_user_request_${lambdaResource2.path}` });
		});
	}
}
