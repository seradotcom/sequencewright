import { createHash } from 'node:crypto';
export const BRIDGE_SCHEMA = 'semwright-native-app-bridge/1';
export const MAX_VALUE_BYTES = 256 * 1024;
export const MAX_PAGE_ITEMS = 256;
export const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
export class NativeError extends Error {
    code;
    outcomeKnown;
    constructor(code, message, outcomeKnown = true){
        super(message), this.code = code, this.outcomeKnown = outcomeKnown;
        this.name = 'NativeError';
    }
    record() {
        return {
            code: this.code,
            message: this.message,
            outcome_known: this.outcomeKnown
        };
    }
}
export function requireCondition(condition, message, code = 'InvalidArgument') {
    if (!condition) throw new NativeError(code, message);
}
export function object(value, allowed, required = []) {
    requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected an object');
    const prototype = Object.getPrototypeOf(value);
    requireCondition(prototype === Object.prototype || prototype === null, 'Expected a plain JSON object');
    const result = value;
    if (allowed) requireCondition(Object.keys(result).every((key)=>allowed.includes(key)), 'Unexpected object field');
    requireCondition(required.every((key)=>Object.hasOwn(result, key)), 'Missing required object field');
    return result;
}
function wellFormed(value) {
    for(let i = 0; i < value.length; ++i){
        const unit = value.charCodeAt(i);
        if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = value.charCodeAt(++i);
            if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
        } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
    }
    return true;
}
export function text(value, maxBytes, label = 'identifier') {
    requireCondition(typeof value === 'string' && value.length > 0 && wellFormed(value) && Buffer.byteLength(value) <= maxBytes && !/[\u0000-\u001f\u007f-\u009f]/u.test(value), `Invalid ${label}`);
    return value;
}
export function integer(value, minimum, maximum) {
    requireCondition(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum, 'Integer outside declared bounds');
    return value;
}
export function validateValue(value) {
    let count = 0;
    const pending = [
        [
            value,
            0
        ]
    ];
    const containers = new Set();
    while(pending.length){
        const [item, depth, leaving] = pending.pop();
        if (leaving) {
            containers.delete(item);
            continue;
        }
        requireCondition(++count <= 16_384 && depth <= 32, 'JSON structural budget', 'ResourceExhausted');
        if (item === null || typeof item === 'boolean') continue;
        if (typeof item === 'number') {
            requireCondition(Number.isFinite(item) && Math.abs(item) <= MAX_SAFE_INTEGER, 'Number outside shared exact finite range');
        } else if (typeof item === 'string') {
            requireCondition(wellFormed(item), 'Unpaired Unicode surrogate');
        } else if (Array.isArray(item)) {
            requireCondition(!containers.has(item), 'Cyclic JSON container');
            containers.add(item);
            pending.push([
                item,
                depth,
                true
            ]);
            requireCondition(Object.getPrototypeOf(item) === Array.prototype, 'JSON array must have its ordinary prototype');
            const descriptors = Object.getOwnPropertyDescriptors(item);
            requireCondition(Object.keys(item).length === item.length && Reflect.ownKeys(item).length === item.length + 1, 'Sparse or extended array');
            for(let index = 0; index < item.length; ++index){
                const descriptor = descriptors[String(index)];
                requireCondition(descriptor !== undefined && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, 'Accessor or hidden array element');
                pending.push([
                    descriptor.value,
                    depth + 1
                ]);
            }
        } else {
            const record = object(item);
            requireCondition(!containers.has(record), 'Cyclic JSON container');
            containers.add(record);
            pending.push([
                record,
                depth,
                true
            ]);
            const descriptors = Object.getOwnPropertyDescriptors(record);
            requireCondition(Reflect.ownKeys(record).length === Object.keys(record).length, 'Non-JSON object property');
            for (const [key, descriptor] of Object.entries(descriptors)){
                requireCondition(wellFormed(key) && Object.hasOwn(descriptor, 'value'), 'Accessor or invalid JSON key');
                pending.push([
                    descriptor.value,
                    depth + 1
                ]);
            }
        }
    }
    requireCondition(Buffer.byteLength(JSON.stringify(value)) <= MAX_VALUE_BYTES, 'JSON byte budget', 'ResourceExhausted');
}
export function version(value) {
    const fields = object(value, [
        'resource',
        'generation',
        'revision'
    ], [
        'resource',
        'generation',
        'revision'
    ]);
    return {
        resource: text(fields.resource, 512),
        generation: text(fields.generation, 256),
        revision: text(fields.revision, 512, 'opaque revision')
    };
}
export function sameVersion(left, right) {
    return left.resource === right.resource && left.generation === right.generation && left.revision === right.revision;
}
export function query(value) {
    const fields = object(value, [
        'resource',
        'scope',
        'limit',
        'cursor'
    ], [
        'resource',
        'scope',
        'limit'
    ]);
    const result = {
        resource: text(fields.resource, 512),
        scope: text(fields.scope, 128),
        limit: integer(fields.limit, 1, MAX_PAGE_ITEMS),
        cursor: null
    };
    if (fields.cursor !== undefined && fields.cursor !== null) {
        const cursor = object(fields.cursor, [
            'version',
            'scope',
            'token'
        ], [
            'version',
            'scope',
            'token'
        ]);
        result.cursor = {
            version: version(cursor.version),
            scope: text(cursor.scope, 128),
            token: text(cursor.token, 1024)
        };
        requireCondition(result.cursor.scope === result.scope && result.cursor.version.resource === result.resource, 'Cursor scope differs from query', 'StaleReference');
    }
    return result;
}
export function observation(value, request) {
    validateValue(value);
    query(request);
    const fields = object(value, [
        'version',
        'scope',
        'items',
        'next',
        'complete'
    ], [
        'version',
        'scope',
        'items',
        'next',
        'complete'
    ]);
    const current = version(fields.version);
    requireCondition(current.resource === request.resource && fields.scope === request.scope && Array.isArray(fields.items) && fields.items.length <= request.limit && typeof fields.complete === 'boolean', 'Observation differs from requested scope or budget');
    if (request.cursor) requireCondition(sameVersion(request.cursor.version, current), 'Revision changed during pagination', 'StaleReference');
    let next = null;
    if (fields.next !== null) {
        const raw = object(fields.next, [
            'version',
            'scope',
            'token'
        ], [
            'version',
            'scope',
            'token'
        ]);
        next = {
            version: version(raw.version),
            scope: text(raw.scope, 128),
            token: text(raw.token, 1024)
        };
        requireCondition(sameVersion(next.version, current) && next.scope === request.scope && next.token !== request.cursor?.token && !fields.complete, 'Unbound or non-progressing continuation');
    }
    return {
        version: current,
        scope: request.scope,
        items: fields.items,
        next,
        complete: fields.complete
    };
}
export function requestIdentity(value) {
    const fields = object(value, [
        'resource',
        'epoch',
        'key',
        'request_sha256'
    ], [
        'resource',
        'epoch',
        'key',
        'request_sha256'
    ]);
    const digest = text(fields.request_sha256, 64);
    requireCondition(/^[0-9a-f]{64}$/u.test(digest), 'Request SHA-256 is invalid');
    return {
        resource: text(fields.resource, 512),
        epoch: integer(fields.epoch, 0, MAX_SAFE_INTEGER),
        key: text(fields.key, 128),
        request_sha256: digest
    };
}
export function recoveryRecord(value, requested) {
    validateValue(value);
    requestIdentity(requested);
    const record = object(value);
    const identity = requestIdentity(record.identity);
    requireCondition(identity.resource === requested.resource && identity.epoch === requested.epoch && identity.key === requested.key && identity.request_sha256 === requested.request_sha256, 'Historical result binding differs', 'Conflict');
    switch(record.state){
        case 'recorded':
            object(record, [
                'state',
                'identity',
                'result'
            ], [
                'result'
            ]);
            validateValue(record.result);
            break;
        case 'pending':
        case 'outcome_unknown':
            object(record, [
                'state',
                'identity'
            ]);
            break;
        case 'retention_expired':
            object(record, [
                'state',
                'identity',
                'current_epoch'
            ], [
                'current_epoch'
            ]);
            integer(record.current_epoch, identity.epoch + 1, MAX_SAFE_INTEGER);
            break;
        default:
            throw new NativeError('InvalidArgument', 'Unknown recovery state');
    }
    return record;
}
function privatePublication(value) {
    const fields = object(value, [
        'candidate_sha256',
        'destination',
        'request'
    ], [
        'candidate_sha256',
        'destination',
        'request'
    ]);
    const candidate_sha256 = text(fields.candidate_sha256, 64);
    requireCondition(/^[0-9a-f]{64}$/u.test(candidate_sha256), 'Publication candidate SHA-256 is invalid');
    const destination = version(fields.destination);
    const request = requestIdentity(fields.request);
    requireCondition(request.resource === destination.resource, 'Publication request and destination differ', 'Conflict');
    return {
        candidate_sha256,
        destination,
        request
    };
}
export function applicationContext(requestId, expected = null, signal = new AbortController().signal) {
    return Object.freeze({
        requestId: text(requestId, 256),
        expected: expected === null ? null : version(expected),
        signal
    });
}
export function checkCancelled(context) {
    if (context.signal.aborted) throw new NativeError('Cancelled', 'Cancelled before application effects');
}
export async function dispatchApplication(app, method, operation, args, context) {
    checkCancelled(context);
    validateValue(args);
    let result;
    if (method === 'observe') {
        if (!app.observe) throw new NativeError('Unsupported', 'Observation interface is unavailable');
        const request = query(args);
        result = observation(await app.observe(request, context), request);
    } else if (method === 'lookup') {
        if (!app.lookup) throw new NativeError('Unsupported', 'Recovery interface is unavailable');
        const request = requestIdentity(args);
        result = recoveryRecord(await app.lookup(request, context), request);
    } else if (method === 'publish') {
        if (!app.publish) throw new NativeError('Unsupported', 'Private publication interface is unavailable');
        const candidate = privatePublication(args);
        requireCondition(context.expected !== null && sameVersion(context.expected, candidate.destination), 'Publication destination is stale', 'StaleReference');
        result = await app.publish(candidate, context);
    } else if (method === 'invoke') {
        const handler = operation === null ? undefined : app.operations?.get(operation);
        if (!handler) throw new NativeError('Unsupported', 'Operation is not exposed');
        result = await handler(args, context);
    } else throw new NativeError('Unsupported', 'Unknown bridge method');
    try {
        validateValue(result);
    } catch  {
        throw new NativeError('PluginProtocolError', 'Application result exceeds its JSON contract', ![
            'invoke',
            'publish'
        ].includes(method));
    }
    return result;
}
export function bridgeEntrypoint(factory) {
    return async (raw)=>{
        let id = 'invalid-frame';
        let app;
        let mutation = false;
        let reply;
        try {
            validateValue(raw);
            const frame = object(raw, [
                'schema_version',
                'id',
                'method',
                'operation',
                'args',
                'expected',
                'runtime'
            ], [
                'schema_version',
                'id',
                'method',
                'operation',
                'args',
                'expected',
                'runtime'
            ]);
            requireCondition(frame.schema_version === BRIDGE_SCHEMA, 'Bridge version mismatch', 'ProtocolMismatch');
            id = text(frame.id, 256);
            const method = text(frame.method, 32);
            requireCondition([
                'observe',
                'lookup',
                'publish',
                'invoke'
            ].includes(method), 'Unknown bridge method', 'Unsupported');
            mutation = method === 'invoke' || method === 'publish';
            const operation = frame.operation === null ? null : text(frame.operation, 192);
            const runtime = object(frame.runtime, [
                'data_root',
                'output_root'
            ], [
                'data_root',
                'output_root'
            ]);
            const paths = Object.freeze({
                data_root: text(runtime.data_root, 4096),
                output_root: runtime.output_root === null ? null : text(runtime.output_root, 4096)
            });
            const context = applicationContext(id, frame.expected === null ? null : version(frame.expected));
            app = factory(paths, !mutation);
            const data = await dispatchApplication(app, method, operation, frame.args, context);
            reply = {
                schema_version: BRIDGE_SCHEMA,
                id,
                ok: true,
                data
            };
        } catch (error) {
            const failure = error instanceof NativeError ? error : new NativeError('BackendFailed', 'Application failed without a confirmed completion', !mutation);
            reply = {
                schema_version: BRIDGE_SCHEMA,
                id,
                ok: false,
                error: failure.record()
            };
        } finally{
            try {
                app?.close?.();
            } catch  {}
        }
        const encoded = JSON.stringify(reply);
        if (Buffer.byteLength(encoded) > MAX_VALUE_BYTES) {
            process.stdout.write(JSON.stringify({
                schema_version: BRIDGE_SCHEMA,
                id,
                ok: false,
                error: new NativeError('ResourceExhausted', 'Application reply exceeded bridge budget', !mutation).record()
            }) + '\n');
        } else process.stdout.write(encoded + '\n');
    };
}
export function exactRequestDigest(domain, value) {
    validateValue(value);
    text(domain, 128);
    function encode(item) {
        if (typeof item === 'number') {
            requireCondition(Number.isSafeInteger(item), 'Exact request encoding requires integers');
            return String(Object.is(item, -0) ? 0 : item);
        }
        if (item === null || typeof item !== 'object') return JSON.stringify(item);
        if (Array.isArray(item)) return '[' + item.map(encode).join(',') + ']';
        return '{' + Object.keys(item).sort((a, b)=>Buffer.compare(Buffer.from(a), Buffer.from(b))).map((key)=>JSON.stringify(key) + ':' + encode(item[key])).join(',') + '}';
    }
    return createHash('sha256').update(domain + '\n' + encode(value)).digest('hex');
}
