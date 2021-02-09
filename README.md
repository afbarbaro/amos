# Timeseries Forecasting using AWS Forecast

This is a self-contained, fully-reproducible project to forecast time series using serverless Lambda functions with TypeScript, AWS CDK, and Localstack.


## Useful npm commands

### Build, watch, test

- `npm run build` Compile Typescript to js
- `npm run watch` Watch for changes to Typescript and compile
- `npm run test` Run the Jest unit tests

### Deploy to localstack

- `localstack:start` Start the localhost container
- `npm run cdklocal:bootstrap` Bootstrap the CDK stack to be able to deploy it to localstack
- `npm run cdklocal:deploy` Deploy the stack to localstack
- `localstack:stop` Stop the localhost container
- Check localstack status
  http://localhost:4566/health
- Check buckets content
  `aws --endpoint-url=http://localhost:4566 s3 ls amos`

### Deploy to AWS

- `npm run cdk:bootstrap` Bootstrap the CDK stack to be able to deploy it to AWS
- `npm run cdk:deploy` Deploy the stack to AWS

## AWS Forecast resources

- Datasets
  https://github.com/awsdocs/amazon-forecast-developer-guide/blob/main/doc_source/howitworks-datasets-groups.md
  https://github.com/aws-samples/amazon-forecast-samples/blob/master/notebooks/basic/Tutorial/1.Getting_Data_Ready.ipynb

## CDK resources

- Custom Resources
  https://github.com/aws/aws-cdk/tree/master/packages/%40aws-cdk/custom-resources
  https://github.com/aws/aws-cdk/blob/master/packages/%40aws-cdk/custom-resources/test/provider-framework/integration-test-fixtures/s3-file-handler/index.ts
  
## Credits and useful references

This repository expands on several original ideas and guidance provided by these blog post and accompanying repositories.

- https://dev.to/_mikigraf/localstack-cdk-local-aws-development-58ff
  - https://github.com/mikigraf/CDK-with-Localstack
- https://dev.to/martzcodes/dynamodb-lambdas-and-api-gw-with-localstack-or-not-4bm8#lambdas
  - https://github.com/martzcodes/blog-cdk-localstack/blob/master/lib/blog-cdk-localstack-stack.ts

