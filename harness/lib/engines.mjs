// The engines a run can target, and how to tell which one answered.

export const ENGINES = {
  elasticsearch: {
    url: 'http://localhost:9200',
    distribution: 'elasticsearch',
    version: '9.5.4',
    ready: '/_cluster/health?wait_for_status=yellow&timeout=5s',
    reference: true,
  },
  opensearch: {
    url: 'http://localhost:9201',
    distribution: 'opensearch',
    version: '3.9.0',
    ready: '/_cluster/health?wait_for_status=yellow&timeout=5s',
    reference: true,
  },
  eloisesearch: {
    url: 'http://localhost:7700',
    distribution: 'eloisesearch',
    version: null, // whatever is being developed
    ready: '/health',
    reference: false,
  },
};

export const ENGINE_NAMES = Object.keys(ENGINES);

export function engineConfig(name, url) {
  const engine = ENGINES[name];
  if (!engine) throw new Error(`unknown engine "${name}" (use ${ENGINE_NAMES.join(', ')})`);
  return { name, ...engine, url: (url || process.env.ENGINE_URL || engine.url).replace(/\/+$/, '') };
}

/**
 * Read the engine's identity from `GET /`. OpenSearch reports
 * `version.distribution: "opensearch"`; Elasticsearch has no distribution field.
 * Eloisesearch does not serve `GET /` yet, so its `/health` version is used.
 */
export async function identify(baseUrl) {
  const root = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(10_000) });
  if (root.ok) {
    const body = await root.json();
    if (body?.version?.number) {
      return { distribution: body.version.distribution ?? 'elasticsearch', version: body.version.number };
    }
  }
  const health = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(10_000) });
  if (health.ok) {
    const body = await health.json();
    if (body?.version) return { distribution: 'eloisesearch', version: body.version };
  }
  throw new Error(`${baseUrl} did not identify itself (GET / and GET /health)`);
}

/** Fail unless the server is the engine and, for a reference, the pinned version. */
export function checkIdentity(engine, identity) {
  if (identity.distribution !== engine.distribution) {
    throw new Error(`${engine.url} is ${identity.distribution} ${identity.version}, expected ${engine.distribution}`);
  }
  if (engine.version && identity.version !== engine.version) {
    throw new Error(`${engine.url} is ${engine.name} ${identity.version}, but the pinned reference is ${engine.version}`);
  }
}
