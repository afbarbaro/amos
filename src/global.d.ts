declare namespace NodeJS {
	interface ProcessEnv {
		USE_NODEJS_FUNCTION: string;
		AWS_PROFILE: string;
		AWS_REGION: string;
		AWS_ENDPOINT_URL: string;
		ALPHAVANTAGE_KEY: string;
		RAPIDAPI_KEY: string;
		FORECAST_ROLE_ARN: string;
		FORECAST_BUCKET_NAME: string;
		FORECAST_DATASET_ARN: string;
		FORECAST_DATASET_GROUP_ARN: string;
	}
}