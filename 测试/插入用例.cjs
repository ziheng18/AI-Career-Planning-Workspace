/*!
 * 测试/插入用例.cjs — 安全地把测试用例追加到某个测试模块末尾
 *
 * 为什么需要它：反复用「编辑工具把某条 t.test 的声明行当作锚点」很容易
 * 把那条用例的声明覆盖掉——本次会话已经踩了三次，每次都导致语法错误。
 * 这个助手统一从**文件末尾**插入，不再动任何已有内容。
 *
 * 用法：
 *   node 测试/插入用例.cjs <目标文件> <片段文件>
 * 目标文件必须导出 function(){ ... }，片段会被插到最外层 `};` 之前。
 */
'use strict';
var fs = require('fs');
var path = require('path');

var target = process.argv[2];
var snippetFile = process.argv[3];
if (!target || !snippetFile) {
  console.error('用法：node 测试/插入用例.cjs <目标文件> <片段文件>');
  process.exit(1);
}

var src = fs.readFileSync(target, 'utf8');
var snippet = fs.readFileSync(snippetFile, 'utf8');

// 找最外层的 "};" —— 即从末尾往前第一个单独成行的 "};"
var lines = src.split('\n');
var insertAt = -1;
for (var i = lines.length - 1; i >= 0; i--) {
  if (lines[i] === '};') { insertAt = i; break; }
}
if (insertAt < 0) { console.error('没找到模块结尾的 };'); process.exit(1); }

var before = lines.length;
var out = lines.slice(0, insertAt)
  .concat(snippet.split('\n'))
  .concat(lines.slice(insertAt));
fs.writeFileSync(target, out.join('\n'), 'utf8');
console.log('已插入：' + path.basename(target) + '  行数 ' + before + ' → ' + out.length);
