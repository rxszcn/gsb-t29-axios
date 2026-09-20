// P6: seedCache observability — per-request fresh env.fetch closures (documented SvelteKit pattern)
import http from 'node:http';

// count Request constructions (capability probe side effects)
let reqCtorCalls = 0;
const RealRequest = globalThis.Request;
globalThis.Request = class PatchedRequest extends RealRequest {
  constructor(...args) { reqCtorCalls++; super(...args); }
};

const { default: axios } = await import("../index.js");

const server = http.createServer((req, res) => res.end('ok'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const registry = new FinalizationRegistry((tag) => console.log('GC observed for', tag));

async function runFresh(n, label) {
  reqCtorCalls = 0;
  const keep = [];
  for (let i = 0; i < n; i++) {
    const freshFetch = (input, init) => RealRequest && globalThis.fetch(input, init);
    // keep refs alive like one per-request closure would be kept during its request
    const r = await axios.get(base + '/x', {
      adapter: 'fetch',
      env: { fetch: freshFetch, Request: globalThis.Request, Response: globalThis.Response },
    });
    if (typeof globalThis.WeakRef === 'function') keep.push(new WeakRef(freshFetch));
  }
  console.log(label, n, 'fresh closures -> Request ctor calls:', reqCtorCalls);
  return keep;
}

async function runSame(n, label) {
  reqCtorCalls = 0;
  const sameFetch = (input, init) => globalThis.fetch(input, init);
  for (let i = 0; i < n; i++) {
    await axios.get(base + '/x', {
      adapter: 'fetch',
      env: { fetch: sameFetch, Request: globalThis.Request, Response: globalThis.Response },
    });
  }
  console.log(label, n, 'SAME closure -> Request ctor calls:', reqCtorCalls);
}

const refs = await runFresh(6, 'FRESH ');
await runSame(6, 'SAME  ');

// D: behaviour isolation — two custom Request classes, same typeof, different
// stream capability. Each must get its own capability probe (constructor count).
function countedBase(rejectStream) {
  return class extends RealRequest {
    constructor(input, init) {
      if (rejectStream && init && init.body && typeof init.body.getReader === 'function') {
        throw new TypeError('custom: stream body unsupported');
      }
      super(input, init);
    }
  };
}
let callsA = 0;
let callsB = 0;
const ReqA = class extends countedBase(false) { constructor(...a) { callsA++; super(...a); } };
const ReqB = class extends countedBase(true) { constructor(...a) { callsB++; super(...a); } };
for (const [Req, label] of [[ReqA, 'A'], [ReqB, 'B']]) {
  const freshFetch = (input, init) => globalThis.fetch(input, init);
  await axios.get(base + '/x', {
    adapter: 'fetch',
    env: { fetch: freshFetch, Request: Req, Response: globalThis.Response },
  });
  await axios.get(base + '/x', {
    adapter: 'fetch',
    env: { fetch: (i2, o2) => globalThis.fetch(i2, o2), Request: Req, Response: globalThis.Response },
  });
  void label;
}
console.log('D callsA>0:', callsA > 0, '| callsB>0:', callsB > 0, '(both must be true)');

// retention check: closures dropped by caller, does axios still hold them?
for (let i = 0; i < 3; i++) { if (global.gc) global.gc(); }
await new Promise((r) => setTimeout(r, 200));
for (let i = 0; i < 3; i++) { if (global.gc) global.gc(); }
await new Promise((r) => setTimeout(r, 200));
let alive = 0;
for (const wr of refs) if (wr.deref() !== undefined) alive++;
console.log('RETENTION: of 6 caller-dropped env.fetch closures still reachable:', alive);
console.log('heapUsed MB:', (process.memoryUsage().heapUsed / 1048576).toFixed(1));
server.close();
process.exit(0);
