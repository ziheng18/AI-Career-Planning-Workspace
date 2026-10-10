/*!
 * 测试/存储垫片.cjs — 让 Node 侧也能加载依赖浏览器 API 的脚本
 *
 * 界面/存储.js 在定义 CP.demoArchive 时并不触碰 DOM，
 * 但它引用了 localStorage / Blob 等浏览器对象。这里提供最小垫片，
 * 使得"生成示例档案"这类离线任务可以复用同一份源码，而不是复制一份逻辑出来。
 */
'use strict';

if (typeof globalThis.localStorage === 'undefined') {
  var mem = Object.create(null);
  globalThis.localStorage = {
    getItem: function (k) { return mem[k] === undefined ? null : mem[k]; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; }
  };
}
if (typeof globalThis.Blob === 'undefined') {
  globalThis.Blob = function (parts, opts) { this.parts = parts; this.type = (opts || {}).type; };
}
if (typeof globalThis.URL === 'undefined') {
  globalThis.URL = { createObjectURL: function () { return 'blob:node'; }, revokeObjectURL: function () { } };
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: function () { return { style: {}, setAttribute: function () { }, click: function () { } }; },
    body: { appendChild: function () { }, removeChild: function () { } },
    getElementById: function () { return null; }
  };
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = { addEventListener: function () { }, scrollTo: function () { } };
}

require('../界面/存储.js');
module.exports = globalThis.CP;
