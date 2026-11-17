import { rank, score } from '../extension/src/core/fuzzy.js';
import { assert, test } from './harness.js';

test('fuzzy: no match returns null', () => {
    assert.equal(score('xyz', 'telecaller'), null);
    assert.equal(score('abc', 'ab'), null);
    assert.equal(score('ba', 'ab'), null);
});

test('fuzzy: matching is case-insensitive and returns the indices', () => {
    const r = score('TELE', 'telecaller');
    assert.deepEqual(r.indices, [0, 1, 2, 3]);
    assert.ok(typeof r.score === 'number');
});

test('fuzzy: highlight indices prefer word boundaries', () => {
    assert.deepEqual(score('mp', 'my-project').indices, [0, 3]);
    assert.deepEqual(score('mp', 'myProject').indices, [0, 2]);
    assert.deepEqual(score('ab', 'xxa-b').indices, [2, 4]);
});

test('fuzzy: indices are increasing and point at matching characters', () => {
    const text = 'hotel-electric';
    const r = score('tele', text);
    assert.equal(r.indices.length, 4);
    r.indices.forEach((idx, i) => {
        assert.equal(text[idx], 'tele'[i]);
        if (i > 0) assert.ok(idx > r.indices[i - 1]);
    });
});

test('fuzzy: tele ranks telecaller over hotel-electric', () => {
    const items = [{ name: 'hotel-electric' }, { name: 'telecaller' }];
    assert.deepEqual(
        rank('tele', items, ['name']).map((i) => i.name),
        ['telecaller', 'hotel-electric'],
    );
});

test('fuzzy: consecutive runs and shorter text score higher', () => {
    assert.ok(score('abc', 'abc').score > score('abc', 'a-b-c').score);
    assert.ok(score('app', 'app').score > score('app', 'app-with-a-long-name').score);
});

test('fuzzy: rank drops non-matches and counts name above path', () => {
    const items = [
        { name: 'other', path: '/home/me/api' },
        { name: 'api', path: '/home/me/other' },
        { name: 'nothing', path: '/x' },
    ];
    const out = rank('api', items, ['name', 'path']);
    assert.deepEqual(
        out.map((i) => i.name),
        ['api', 'other'],
    );
});

test('fuzzy: rank accepts weighted fields and array values', () => {
    const items = [
        { name: 'a', aliases: ['prod', 'web'] },
        { name: 'prodigy', aliases: [] },
    ];
    const out = rank('web', items, [{ key: 'name', weight: 1 }, { key: 'aliases' }]);
    assert.deepEqual(
        out.map((i) => i.name),
        ['a'],
    );
});

test('fuzzy: empty query keeps the input order', () => {
    const items = [{ name: 'b' }, { name: 'a' }, { name: 'c' }];
    const out = rank('', items, ['name']);
    assert.deepEqual(out, items);
    assert.ok(out !== items);
    assert.deepEqual(score('', 'anything'), { score: 0, indices: [] });
});

test('fuzzy: ties keep the input order', () => {
    const items = [{ name: 'abc' }, { name: 'abc' }, { name: 'abc', n: 3 }];
    assert.deepEqual(rank('abc', items, ['name']), items);
});
