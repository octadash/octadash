/**
 * Set up Logs, as closed in the Logs canvas: OpenTelemetry only, with the
 * code for each language. The key travels in the `x-octadash-key` header and
 * `service.name` says which part of the product a line came from.
 */

export const LOG_TABS = ['dotnet', 'node', 'python', 'go', 'collector', 'other'] as const
export type LogTab = (typeof LOG_TABS)[number]

export const LOG_SOURCE_PLATFORMS = ['dotnet', 'node', 'python', 'go', 'other'] as const

export function isLogTab(value: string): value is LogTab {
  return (LOG_TABS as readonly string[]).includes(value)
}

/** The tab a source opens on, from where its code runs. */
export function logTabOf(platform: string | null): LogTab {
  if (platform === 'nextjs') return 'node'
  return platform && isLogTab(platform) ? platform : 'dotnet'
}

export interface LogSnippetOptions {
  /** The ingest's public address. */
  ingestUrl: string
  publicKey: string
  /** The service.name to suggest. */
  service: string
}

export interface LogSnippet {
  /** The install command, when there is one. */
  install: string | null
  /** Where the code goes. */
  file: string
  code: string
}

export function logSnippet(tab: LogTab, o: LogSnippetOptions): LogSnippet {
  const base = `${o.ingestUrl.replace(/\/+$/, '')}/otlp`
  const service = o.service.replace(/["'\\\s]/g, '') || 'api'
  switch (tab) {
    case 'dotnet':
      return {
        install: 'dotnet add package Serilog.Sinks.OpenTelemetry',
        file: 'Program.cs',
        code: `// using Serilog; using Serilog.Sinks.OpenTelemetry;
Log.Logger = new LoggerConfiguration()
    .WriteTo.OpenTelemetry(o =>
    {
        o.Endpoint = "${base}";
        o.Protocol = OtlpProtocol.HttpProtobuf;
        o.Headers = new Dictionary<string, string> { ["x-octadash-key"] = "${o.publicKey}" };
        o.ResourceAttributes = new Dictionary<string, object> { ["service.name"] = "${service}" };
    })
    .CreateLogger();`,
      }
    case 'node':
      return {
        install: 'npm install pino pino-opentelemetry-transport',
        file: '.env',
        code: `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=${base}/v1/logs
OTEL_EXPORTER_OTLP_LOGS_HEADERS=x-octadash-key=${o.publicKey}
OTEL_RESOURCE_ATTRIBUTES=service.name=${service}

# logger.js
# const pino = require('pino')
# module.exports = pino(pino.transport({ target: 'pino-opentelemetry-transport' }))`,
      }
    case 'python':
      return {
        install: 'pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-http',
        file: 'logging_setup.py',
        code: `import logging
from opentelemetry._logs import set_logger_provider
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.resources import Resource

provider = LoggerProvider(resource=Resource.create({"service.name": "${service}"}))
provider.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter(
    endpoint="${base}/v1/logs",
    headers={"x-octadash-key": "${o.publicKey}"},
)))
set_logger_provider(provider)
logging.getLogger().addHandler(LoggingHandler(level=logging.INFO, logger_provider=provider))`,
      }
    case 'go':
      return {
        install:
          'go get go.opentelemetry.io/otel/sdk/log go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp go.opentelemetry.io/contrib/bridges/otelslog',
        file: 'main.go',
        code: `exporter, err := otlploghttp.New(ctx,
	otlploghttp.WithEndpointURL("${base}/v1/logs"),
	otlploghttp.WithHeaders(map[string]string{"x-octadash-key": "${o.publicKey}"}),
)
if err != nil {
	panic(err)
}
provider := sdklog.NewLoggerProvider(
	sdklog.WithProcessor(sdklog.NewBatchProcessor(exporter)),
	sdklog.WithResource(resource.NewSchemaless(attribute.String("service.name", "${service}"))),
)
defer provider.Shutdown(ctx)
logger := otelslog.NewLogger("${service}", otelslog.WithLoggerProvider(provider))
logger.Info("started")`,
      }
    case 'collector':
      return {
        install: null,
        file: 'otel-collector.yaml',
        code: `exporters:
  otlphttp/octadash:
    endpoint: ${base}
    headers:
      x-octadash-key: ${o.publicKey}

service:
  pipelines:
    logs:
      receivers: [otlp]
      exporters: [otlphttp/octadash]`,
      }
    default:
      return {
        install: null,
        file: '.env',
        code: `OTEL_LOGS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=${base}/v1/logs
OTEL_EXPORTER_OTLP_LOGS_HEADERS=x-octadash-key=${o.publicKey}
OTEL_RESOURCE_ATTRIBUTES=service.name=${service}`,
      }
  }
}
