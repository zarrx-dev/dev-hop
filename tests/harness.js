export const registry = [];

export function test(name, fn) {
    registry.push({ name, fn });
}

export const assert = {
    ok(value, message = 'expected a truthy value') {
        if (!value) throw new Error(message);
    },
    equal(actual, expected, message) {
        if (actual !== expected) {
            throw new Error(message ?? `expected ${String(expected)}, got ${String(actual)}`);
        }
    },
    deepEqual(actual, expected, message) {
        const a = JSON.stringify(actual);
        const b = JSON.stringify(expected);
        if (a !== b) throw new Error(message ?? `expected ${b}, got ${a}`);
    },
    throws(fn, message = 'expected the function to throw') {
        try {
            fn();
        } catch (_e) {
            return;
        }
        throw new Error(message);
    },
};
