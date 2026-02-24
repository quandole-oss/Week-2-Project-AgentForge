import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';

const langfuseEnabled = !!process.env.LANGFUSE_SECRET_KEY;

if (langfuseEnabled) {
  const sdk = new NodeSDK({
    spanProcessors: [new LangfuseSpanProcessor()]
  });

  sdk.start();
}
