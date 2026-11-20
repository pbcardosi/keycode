import { redact } from "../util/redact.js";

export interface OtelConfig {
  endpoint: string;
  headers?: Record<string, string> | undefined;
  serviceName?: string | undefined;
  sampleRate?: number | undefined;
}

export interface OtelMetric {
  name: string;
  value: number;
  unit?: string | undefined;
  attributes: Record<string, string | number>;
}

function redactAttributes(attributes: Record<string, string | number>): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(attributes)) {
    result[key] = typeof value === "string" ? redact(value) : value;
  }
  return result;
}

function otlpAttributes(attributes: Record<string, string | number>): unknown[] {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value: typeof value === "number" ? { intValue: value } : { stringValue: value },
  }));
}

export class OtelExporter {
  private readonly config: OtelConfig;
  private readonly fetchImpl: typeof fetch;
  private buffer: OtelMetric[] = [];

  constructor(config: OtelConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  get pending(): number {
    return this.buffer.length;
  }

  record(metric: OtelMetric): void {
    const sampleRate = this.config.sampleRate ?? 1;
    if (sampleRate <= 0 || Math.random() > sampleRate) return;
    this.buffer.push({ ...metric, attributes: redactAttributes(metric.attributes) });
  }

  async flush(): Promise<boolean> {
    if (this.buffer.length === 0) return true;
    const metrics = this.buffer.map((metric) => ({
      name: metric.name,
      ...(metric.unit === undefined ? {} : { unit: metric.unit }),
      gauge: {
        dataPoints: [
          {
            asDouble: metric.value,
            attributes: otlpAttributes(metric.attributes),
          },
        ],
      },
    }));
    const body = {
      resourceMetrics: [
        {
          resource: {
            attributes: otlpAttributes({ "service.name": this.config.serviceName ?? "keycode" }),
          },
          scopeMetrics: [{ scope: { name: "keycode" }, metrics }],
        },
      ],
    };
    this.buffer = [];
    try {
      const response = await this.fetchImpl(this.config.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.config.headers },
        body: JSON.stringify(body),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
