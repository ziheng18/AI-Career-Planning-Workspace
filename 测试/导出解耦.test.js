/*!
 * 架构约束测试：导出模块必须能脱离界面层运行
 *
 * 为什么需要这一条：
 * 报告生成原本依赖 CP.fmt / CP.esc（定义在 界面/图表.js）和 CP.DUTY_KEYS（定义在 界面/页面.js）。
 * 浏览器里脚本全加载，看不出问题；但"导出报告"依赖"界面渲染"是错误的分层——
 * 它意味着离线批量生成报告必须先跑一遍 UI 代码，任何界面改动都可能悄悄打断导出。
 *
 * 本测试在一个干净的全局命名空间里，只加载 数据层 + 逻辑层 + 导出层，
 * 完全不加载 界面/ 目录下的任何文件，然后真实生成一份报告。
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var t = require('./tiny');

var ROOT = path.resolve(__dirname, '..');

/** 只加载指定文件（不含 界面/ 目录），返回该沙箱内的 CP */
function loadOnly(files) {
  var sandbox = {
    console: console,
    Date: Date,
    Math: Math,
    JSON: JSON,
    Number: Number,
    String: String,
    Object: Object,
    Array: Array,
    isNaN: isNaN,
    setTimeout: setTimeout,
    module: { exports: {} },
    exports: {},
    // 界面/存储.js 需要，但本测试不加载它；这里只兜底，避免误报
    localStorage: { getItem: function () { return null; }, setItem: function () { }, removeItem: function () { } },
    Blob: function () { },
    URL: { createObjectURL: function () { return ''; }, revokeObjectURL: function () { } },
    document: { createElement: function () { return { style: {}, click: function () { } }; }, body: { appendChild: function () { } } },
    window: { addEventListener: function () { }, scrollTo: function () { } }
  };
  sandbox.globalThis = sandbox;
  var ctx = vm.createContext(sandbox);
  files.forEach(function (rel) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  });
  return sandbox.CP;
}

module.exports = function () {
  t.group('六、架构约束：导出层不依赖界面层');

  var files = [
    '数据/schema.js', '数据/题库.js', '数据/岗位库.js', '数据/路径库.js',
    '逻辑/计分.js', '逻辑/匹配.js', '逻辑/建议.js',
    '导出/报告.js'
  ];
  var CP = null;

  t.test('不加载 界面/ 目录也能构建报告模块', function () {
    CP = loadOnly(files);
    t.ok(CP, 'CP 未定义');
    t.ok(typeof CP.report === 'object', 'CP.report 未定义');
    t.ok(typeof CP.report.toMarkdown === 'function', 'toMarkdown 缺失');
    t.ok(typeof CP.report.rawData === 'function', 'rawData 缺失');
    // 通用工具必须来自数据层，这样导出层才不需要图表模块
    t.ok(typeof CP.esc === 'function', 'CP.esc 应由数据层提供');
    t.ok(typeof CP.fmt === 'function', 'CP.fmt 应由数据层提供');
    t.ok(Array.isArray(CP.DUTY_KEYS) && CP.DUTY_KEYS.length === 4, 'CP.DUTY_KEYS 应由数据层提供');
  });

  t.test('在没有界面层的情况下能真实生成一份完整报告', function () {
    // 构造一份最小可用档案：不依赖 界面/存储.js 的示例档案
    var a = CP.createBlankArchive();
    a.profile.grade = '大三';
    a.profile.track = '人工智能';
    a.profile.gpaBand = '10-30%';
    a.profile.acceptPostgrad = '接受';
    a.decision.hoursPerWeek = 10;
    a.decision.targetCities = ['杭州'];
    a.decision.jobPref = { 'ai-pm': 'like', 'llm-app-engineer': 'like', 'ai-governance': 'exclude' };
    a.decision.criteriaOrder = CP.CRITERIA.map(function (c) { return c.id; });

    var ri = { I: 5, E: 4, S: 4, C: 3, R: 2, A: 2 };
    var an = { GM: 5, EC: 4, TF: 3, LS: 3, SE: 2, SV: 2, AU: 2, CH: 3 };
    var ab = { product: 4, comm: 4, data: 3, self: 3, model: 2, math: 2, code: 2, deploy: 1 };
    [
      ['riasec', ri, function (it, v) { return it.reverse ? 6 - v : v; }],
      ['anchor', an, function (it, v) { return it.reverse ? 6 - v : v; }],
      ['ability', ab, function (it, v) { return v; }]
    ].forEach(function (pair) {
      CP.activeItems(CP.BANKS[pair[0]], a.profile).forEach(function (it, i) {
        a.answers[pair[0]][it.id] = { v: pair[2](it, pair[1][it.dim]), t: 1700000000000 + i * 6000 };
      });
    });
    a.decision.criteriaOrder = CP.CRITERIA.map(function (c) { return c.id; });

    var res = CP.buildResult(a);
    a.computed = res;
    a.actions = CP.draftActions(a, res.score, res.match, res.decision, '2026-03-20');

    // 用最小 ui 垫片让报告模块能取到档案
    CP.ui = { archive: a, result: function () { return this.archive.computed; } };

    var md = CP.report.toMarkdown();
    t.ok(md.length > 3000, '报告过短：' + md.length);
    ['第一章　自我认知', '第二章　职业与行业认知', '第三章　目标决策与路径设计',
      '第四章　能力锻造', '第五章　行动计划', '附录　方法与来源'].forEach(function (h) {
      t.ok(md.indexOf(h) >= 0, '缺少章节：' + h);
    });
    // 职业简表必须渲染出来（这依赖岗位库的 workMix 与来自数据层的 DUTY_KEYS）
    t.ok(md.indexOf('排名较高的职业简表') >= 0, '缺少职业简表');
    t.ok(md.indexOf('一周工作内容占比') >= 0, '职业简表应含工作内容占比');
    t.ok(md.indexOf('写代码 / 做技术') >= 0, '工作内容分类未渲染');
    t.ok(md.indexOf('岗位认知核对') >= 0, '缺少岗位认知核对一节');
    // 报告中不应出现 undefined / NaN
    t.ok(md.indexOf('undefined') < 0, '报告出现 undefined');
    t.ok(md.indexOf('NaN') < 0, '报告出现 NaN');
  });

  t.test('原始数据导出同样不依赖界面层', function () {
    var raw = CP.report.rawData();
    ['answers', 'dims', 'fit', 'gaps', 'path', 'jobs', 'meta'].forEach(function (k) {
      t.ok(raw[k], '缺少 ' + k);
    });
    t.ok(raw.answers.length > 90, '逐题明细行数不足：' + raw.answers.length);
    t.eq(raw.jobs.length - 1, CP.JOB_FAMILIES.length, '岗位库参数表应含全部岗位');
  });
};
