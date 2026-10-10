/*!
 * 测试/mobile.cjs — 在窄屏视口跑一遍浏览器诊断
 *
 * 单独包一层是因为 npm script 里设置环境变量在跨平台 shell 下写法不一，
 * 这里直接设好再复用 浏览器诊断.cjs。
 */
'use strict';
process.env.WB_VIEWPORT = process.env.WB_VIEWPORT || '420,860';
require('./浏览器诊断.cjs');
