/**
 * Node test runner.
 *
 * The suite itself is in `core.test.js` and is plain ES modules with no test
 * framework, so the same file runs here and in a browser. That is not purity -
 * it is so the engine can be verified on a machine with no toolchain at all,
 * which is the machine this shop is most likely to be worked on from.
 *
 *   node packages/pattern-core/test/run.js
 *
 * No Node? Serve the repo (tools/serve.ps1 on Windows, `npx serve .` elsewhere),
 * open it, and run this in the browser console:
 *
 *   (await import('/packages/pattern-core/test/core.test.js')).report()
 */

const { report } = await import('./core.test.js');
const r = report();

for (const line of r.lines) console.log(line);
console.log('');
console.log(`${r.passed}/${r.total} tests, ${r.assertions} assertions`);

if (r.failed) {
  console.error(`\n${r.failed} failed:`);
  for (const f of r.failures) console.error(`  ${f.name}\n    ${f.message}`);
  process.exit(1);
}
