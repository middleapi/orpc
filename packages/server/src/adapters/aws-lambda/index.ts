export * from './handler'
export * from './rpc-handler'

export type {
  AnyAPIGatewayProxyEvent,
  APIGatewayProxyEvent,
  /**
   * AWS API Gateway proxy event, payload format 2.0, also used by Lambda Function URLs.
   *
   * @see {@link https://orpc.dev/docs/adapters/aws-lambda | AWS Lambda Adapter}
   */
  APIGatewayProxyEventV2,
  /**
   * Shape of the `awslambda` global the Lambda Node.js runtime injects when response streaming is enabled.
   * Declare it yourself: `declare const awslambda: AwsLambdaGlobal`.
   *
   * @see {@link https://orpc.dev/docs/adapters/aws-lambda | AWS Lambda Adapter}
   */
  AwsLambdaGlobal,
  HttpResponseStream,
} from '@standard-server/aws-lambda'
