/*!
 * 测试入口：node 测试/run.js
 * 也可用 npm test
 */
'use strict';
var t = require('./tiny');
var path = require('path');

var SUITES = [
  '契约.test.js',
  '计分.test.js',
  '匹配.test.js',
  '端到端.test.js',
  '导出解耦.test.js'
];

console.log('AI 职业生涯规划工作台 — 逻辑层测试');
console.log('契约版本：' + require('./load').SCHEMA_VERSION);

SUITES.forEach(function (f) {
  try {
    require(path.join(__dirname, f))();
  } catch (e) {
    t.test('测试套件 ' + f + ' 执行失败', function () { throw e; });
  }
});

process.exit(t.summary());
