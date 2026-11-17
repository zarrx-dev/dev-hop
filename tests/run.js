import System from 'system';
import { registry } from './harness.js';

const testFiles = [
    'smoke.test.js',
    'sshConfig.test.js',
    'sshConfigFile.test.js',
    'template.test.js',
    'fuzzy.test.js',
    'presets.test.js',
    'sources.test.js',
    'runner.test.js',
];

for (const file of testFiles) {
    await import(`./${file}`);
}

let failed = 0;
for (const { name, fn } of registry) {
    try {
        await fn();
        print(`ok   ${name}`);
    } catch (e) {
        failed++;
        print(`FAIL ${name}: ${e.message}`);
    }
}

print(`${registry.length - failed}/${registry.length} passed`);
System.exit(failed > 0 ? 1 : 0);
