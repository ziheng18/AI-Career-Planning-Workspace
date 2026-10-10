/*!
 * 测试专用加载器：按依赖顺序把数据层与逻辑层加载进 globalThis.CP。
 * 浏览器里由 工作台.html 的 <script> 顺序完成同样的事。
 */
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var FILES = [
  '数据/schema.js',
  '数据/题库.js',
  '数据/岗位库.js',
  '数据/路径库.js',
  '逻辑/计分.js',
  '逻辑/匹配.js',
  '逻辑/建议.js',
  '界面/存储.js'
];

FILES.forEach(function (rel) {
  var abs = path.join(ROOT, rel);
  var code = fs.readFileSync(abs, 'utf8');
  // 用间接 eval 在全局作用域执行，等价于浏览器的 <script> 标签
  (0, eval)(code + '\n//# sourceURL=' + rel);
});

module.exports = globalThis.CP;

// 共享测试助手：给能力清单灌入勾选式作答，两个测试套件共用同一份实现
globalThis.CP.fillAbility = function (archive, byDim, profile) {
  return require('./填充能力.cjs')(globalThis.CP, archive, byDim, profile);
};
