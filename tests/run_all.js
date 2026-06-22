// ============================================================
// NODE-ONLY TEST RUNNER — DO NOT ADD TO THE APPS SCRIPT PROJECT
// ============================================================
// Runs every test/simulation in this folder and prints a single summary.
// Usage:  node tests/run_all.js
// ============================================================
if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
  // Not running under Node — do nothing.
} else {
  (function () {
    const { execFileSync } = require('child_process');
    const fs = require('fs');
    const path = require('path');

    const dir = __dirname;
    // Every test file except this runner.
    const files = fs.readdirSync(dir)
      .filter(f => /\.(js)$/.test(f) && f !== 'run_all.js')
      .sort();

    const COMPLETE = /=== ALL .*COMPLETE ===/;
    const FAILMARK = /✗ FAIL/;

    let suitesPassed = 0, suitesFailed = 0;
    const results = [];

    console.log('\n══════════════════════════════════════════════');
    console.log(' SME ERP — full test suite');
    console.log('══════════════════════════════════════════════\n');

    files.forEach(f => {
      let out = '';
      let crashed = false;
      try {
        out = execFileSync('node', [path.join(dir, f)], { encoding: 'utf8' });
      } catch (e) {
        out = (e.stdout || '') + (e.stderr || '');
        crashed = true;
      }

      const failLines = out.split('\n').filter(l => FAILMARK.test(l));
      const completed = COMPLETE.test(out);
      const passed = completed && failLines.length === 0 && !crashed;

      // Count the ✓ assertions for a sense of coverage.
      const checks = (out.match(/✓/g) || []).length;

      if (passed) { suitesPassed++; } else { suitesFailed++; }
      results.push({ f, passed, checks, failLines, crashed, completed });

      console.log(`${passed ? '✅ PASS' : '❌ FAIL'}  ${f}   (${checks} assertions)`);
      if (!passed) {
        if (crashed) console.log('        ↳ suite crashed before completing');
        else if (!completed) console.log('        ↳ suite did not reach its COMPLETE marker');
        failLines.forEach(l => console.log('        ↳ ' + l.trim()));
      }
    });

    const totalChecks = results.reduce((s, r) => s + r.checks, 0);

    console.log('\n──────────────────────────────────────────────');
    console.log(` Suites: ${suitesPassed} passed, ${suitesFailed} failed` +
                `   ·   ${totalChecks} assertions total`);
    console.log('──────────────────────────────────────────────\n');

    process.exitCode = suitesFailed === 0 ? 0 : 1;
  })();
}
