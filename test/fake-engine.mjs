// A tiny in-process engine for the harness's own tests.
//
// It implements just enough of the reference behavior to exercise the runner
// end to end (index lifecycle, documents, bulk, refresh, match_all search,
// _count). It is NOT a reference: the real expectations are confirmed against
// Elasticsearch and OpenSearch. Options let tests make it misbehave.

import http from 'node:http';

const VALID_NAME = /^[a-z0-9][a-z0-9_.-]*$/;
const KNOWN_SETTINGS = new Set(['number_of_shards', 'number_of_replicas', 'refresh_interval', 'analysis']);
const KNOWN_TYPES = new Set(['text', 'keyword', 'integer', 'long', 'float', 'double', 'date', 'boolean', 'completion']);

function error(status, type, reason) {
  return [status, { error: { root_cause: [{ type, reason }], type, reason }, status }];
}

export async function startFakeEngine({ distribution = 'elasticsearch', version = '9.5.4', breakDeleteMissing = false } = {}) {
  const indexes = new Map(); // name -> { settings, mappings, docs: Map, visible: Map, seq }
  const deleted = [];
  let generated = 0;

  const shards = { total: 1, successful: 1, failed: 0 };
  const flatSettings = settings => ({ ...(settings ?? {}), ...(settings?.index ?? {}) });

  function write(name, idx, id, source, { create = false, refresh = false } = {}) {
    const existing = idx.docs.get(id);
    if (create && existing) {
      return error(409, 'version_conflict_engine_exception', `[${id}]: version conflict, document already exists`);
    }
    const version = (existing?.version ?? 0) + 1;
    idx.docs.set(id, { source, version });
    if (refresh || idx.refreshInterval !== '-1') idx.visible = new Map(idx.docs);
    const body = { _index: name, _id: id, _version: version, result: existing ? 'updated' : 'created', _shards: shards, _seq_no: idx.seq++, _primary_term: 1 };
    if (refresh) body.forced_refresh = true;
    return [existing ? 200 : 201, body];
  }

  function remove(name, idx, id) {
    const existing = idx.docs.get(id);
    if (!existing) return [404, { _index: name, _id: id, _version: 1, result: 'not_found', _shards: shards, _seq_no: idx.seq++, _primary_term: 1 }];
    idx.docs.delete(id);
    if (idx.refreshInterval !== '-1') idx.visible = new Map(idx.docs);
    return [200, { _index: name, _id: id, _version: existing.version + 1, result: 'deleted', _shards: shards, _seq_no: idx.seq++, _primary_term: 1 }];
  }

  function handle(method, url, text) {
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const q = url.searchParams;
    let body = null;
    if (text && !url.pathname.endsWith('_bulk')) {
      try {
        body = JSON.parse(text);
      } catch {
        return error(400, 'x_content_parse_exception', 'malformed JSON');
      }
    }

    if (parts.length === 0) return [200, { name: 'fake', version: { number: version, ...(distribution === 'opensearch' ? { distribution } : {}) } }];
    if (parts[0] === '_cluster' && parts[1] === 'health') return [200, { status: 'green' }];

    if (parts[0] === '_bulk' || parts[1] === '_bulk') {
      const lines = text.split('\n').filter(Boolean).map(line => JSON.parse(line));
      const items = [];
      for (let i = 0; i < lines.length; i++) {
        const [action, meta] = Object.entries(lines[i])[0];
        const name = meta._index ?? parts[0];
        const idx = indexes.get(name);
        const source = action === 'delete' ? null : lines[++i];
        let status, result;
        if (!idx) [status, result] = error(404, 'index_not_found_exception', `no such index [${name}]`);
        else if (action === 'delete') [status, result] = remove(name, idx, meta._id);
        else [status, result] = write(name, idx, meta._id ?? `gen${++generated}`, source, { create: action === 'create' });
        items.push({ [action]: { _index: name, _id: meta._id, status, ...(result.error ? { error: result.error } : result) } });
      }
      if (q.get('refresh') === 'true') for (const idx of indexes.values()) idx.visible = new Map(idx.docs);
      return [200, { took: 1, errors: items.some(item => Object.values(item)[0].error), items }];
    }

    const name = parts[0];
    const idx = indexes.get(name);
    const missing = () => error(404, 'index_not_found_exception', `no such index [${name}]`);

    if (parts.length === 1) {
      if (method === 'PUT') {
        if (!VALID_NAME.test(name)) return error(400, 'invalid_index_name_exception', `Invalid index name [${name}], must be lowercase`);
        if (idx) return error(400, 'resource_already_exists_exception', `index [${name}] already exists`);
        const settings = flatSettings(body?.settings);
        delete settings.index;
        for (const key of Object.keys(settings)) {
          if (!KNOWN_SETTINGS.has(key)) return error(400, 'illegal_argument_exception', `unknown setting [index.${key}]`);
        }
        for (const field of Object.values(body?.mappings?.properties ?? {})) {
          if (!KNOWN_TYPES.has(field.type)) return error(400, 'mapper_parsing_exception', `No handler for type [${field.type}]`);
        }
        indexes.set(name, {
          settings, mappings: body?.mappings ?? {}, docs: new Map(), visible: new Map(), seq: 0,
          refreshInterval: String(settings.refresh_interval ?? '1s'),
        });
        return [200, { acknowledged: true, shards_acknowledged: true, index: name }];
      }
      if (!idx) return method === 'HEAD' ? [404, null] : (breakDeleteMissing && method === 'DELETE' ? [200, { acknowledged: true }] : missing());
      if (method === 'HEAD') return [200, null];
      if (method === 'GET') {
        const settings = Object.fromEntries(Object.entries(idx.settings).map(([key, value]) => [key, String(value)]));
        return [200, { [name]: { aliases: {}, mappings: idx.mappings, settings: { index: settings } } }];
      }
      if (method === 'DELETE') {
        indexes.delete(name);
        deleted.push(name);
        return [200, { acknowledged: true }];
      }
    }

    if (!idx) return missing();
    const [, endpoint, id] = parts;

    if (endpoint === '_refresh') {
      idx.visible = new Map(idx.docs);
      return [200, { _shards: shards }];
    }
    if (endpoint === '_count') return [200, { count: idx.visible.size, _shards: shards }];
    if (endpoint === '_search') {
      const hits = [...idx.visible].map(([docId, doc]) => ({ _index: name, _id: docId, _score: 1, _source: doc.source }));
      return [200, { took: 1, timed_out: false, _shards: shards, hits: { total: { value: hits.length, relation: 'eq' }, max_score: 1, hits } }];
    }
    const refresh = q.get('refresh') === 'true' || q.get('refresh') === 'wait_for';
    if (endpoint === '_create') return write(name, idx, id, body, { create: true, refresh });
    if (endpoint === '_doc') {
      if (method === 'POST' && !id) return write(name, idx, `gen${++generated}`, body, { refresh });
      if (method === 'PUT' || method === 'POST') {
        const result = write(name, idx, id, body, { create: q.get('op_type') === 'create', refresh: q.get('refresh') === 'true' });
        if (q.get('refresh') === 'wait_for') idx.visible = new Map(idx.docs);
        return result;
      }
      if (method === 'DELETE') return remove(name, idx, id);
      if (method === 'GET') {
        const doc = idx.docs.get(id);
        if (!doc) return [404, { _index: name, _id: id, found: false }];
        let source = doc.source;
        const includes = q.get('_source_includes')?.split(',');
        const excludes = q.get('_source_excludes')?.split(',');
        if (includes) source = Object.fromEntries(Object.entries(source).filter(([key]) => includes.includes(key)));
        if (excludes) source = Object.fromEntries(Object.entries(source).filter(([key]) => !excludes.includes(key)));
        return [200, { _index: name, _id: id, _version: doc.version, _seq_no: 0, _primary_term: 1, found: true, _source: source }];
      }
    }
    return error(400, 'illegal_argument_exception', `no handler for ${method} ${url.pathname}`);
  }

  const server = http.createServer((req, res) => {
    let text = '';
    req.on('data', chunk => { text += chunk; });
    req.on('end', () => {
      const [status, body] = handle(req.method, new URL(req.url, 'http://fake'), text);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === null || req.method === 'HEAD' ? undefined : JSON.stringify(body));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    indexes,
    deleted,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}
