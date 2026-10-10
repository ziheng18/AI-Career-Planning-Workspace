/*!
 * 极简测试框架：零依赖、纯 Node。
 */
'use strict';

var state = { pass: 0, fail: 0, results: [] };

function test(name, fn) {
  try {
    fn();
    state.pass += 1;
    state.results.push({ name: name, ok: true });
    console.log('  \u2713 ' + name);
  } catch (e) {
    state.fail += 1;
    state.results.push({ name: name, ok: false, error: e.message });
    console.log('  \u2717 ' + name);
    console.log('      ' + e.message);
  }
}

function group(title) {
  console.log('\n' + title);
}

function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || '断言失败') + '：期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
  }
}

function near(actual, expected, tol, msg) {
  var t = tol == null ? 0.05 : tol;
  if (actual === null || actual === undefined || isNaN(actual)) {
    throw new Error((msg || '断言失败') + '：期望约 ' + expected + '，实际 ' + actual);
  }
  if (Math.abs(actual - expected) > t) {
    throw new Error((msg || '断言失败') + '：期望约 ' + expected + '（容差 ' + t + '），实际 ' + actual);
  }
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败：条件为假');
}

function summary() {
  console.log('\n' + '='.repeat(52));
  console.log('通过 ' + state.pass + ' 项，失败 ' + state.fail + ' 项');
  if (state.fail) {
    console.log('\n失败清单：');
    state.results.filter(function (r) { return !r.ok; }).forEach(function (r) {
      console.log('  - ' + r.name + '：' + r.error);
    });
  }
  console.log('='.repeat(52));
  return state.fail === 0 ? 0 : 1;
}

module.exports = { test: test, group: group, eq: eq, near: near, ok: ok, summary: summary, state: state };
