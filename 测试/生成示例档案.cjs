/*!
 * 测试/生成示例档案.cjs — 生成 输出/示例档案.json（大三）与 输出/示例档案-大一.json
 *
 * 示例档案在界面里可以通过「载入示例档案」一键加载；
 * 这里额外导出文件，便于教师直接分发给学生，或用于离线核查。
 */
'use strict';
var fs = require('fs');
var path = require('path');
var CP = require('./load');
require('./存储垫片.cjs');
require('../导出/报告.js');

var ROOT = path.resolve(__dirname, '..');
var outDir = path.join(ROOT, '输出');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

var CASES = [
  { fn: 'demoArchive', file: '示例档案.json', label: '大三示例（能力匹配为主）' },
  { fn: 'demoArchiveFresh', file: '示例档案-大一.json', label: '大一示例（以兴趣定方向）' }
];

var failed = false;

CASES.forEach(function (c) {
  var archive = CP[c.fn]();

  // 强制重算一遍，确保写出去的是当前代码的结果，而不是示例构造函数里的历史快照
  archive.computed = CP.buildResult(archive);
  archive.actions = CP.draftActions(archive, archive.computed.score, archive.computed.match,
    archive.computed.decision, new Date().toISOString().slice(0, 10));

  // 校验：示例档案必须通过完整性检查，否则说明题库/岗位库与契约脱节
  var missing = CP.validateArchive(archive);
  if (missing.length) {
    console.error(c.label + ' 未通过完整性校验：' + JSON.stringify(missing, null, 2));
    failed = true;
    return;
  }
  if (!archive.computed || !archive.computed.match || !archive.computed.match.ranked.length) {
    console.error(c.label + ' 缺少有效计算结果');
    failed = true;
    return;
  }

  var outFile = path.join(outDir, c.file);
  fs.writeFileSync(outFile, JSON.stringify(archive, null, 2), 'utf8');

  var s = archive.computed.score;
  console.log('已生成 ' + path.relative(ROOT, outFile) + '（' + (fs.statSync(outFile).size / 1024).toFixed(1) + ' KB）');
  console.log('  ' + c.label);
  console.log('    年级：' + archive.profile.grade + '　方向：' + archive.profile.track
    + '　能力清单：' + (s.abilityGrade === 'fresh' ? '大一版（48 项）' : '大二及以上版（48 项）'));
  console.log('    霍兰德代码：' + s.holland.code + '　主锚：' + s.anchorTop.primary.label);
  var w = archive.computed.match.ranked[0].parts;
  console.log('    适配度权重：兴趣 ' + w.interestWeight + ' / 能力 ' + w.abilityWeight + ' / 锚 ' + w.anchorWeight);
  console.log('    首位岗位：' + archive.computed.match.ranked[0].name
    + '（' + archive.computed.match.ranked[0].shown + ' 分）');
  console.log('    主路径：' + archive.computed.decision.primary.name);
  console.log('    行动任务：' + archive.actions.length + ' 条'
    + (archive.computed.gaps[0] && archive.computed.gaps[0].dim === '_explore' ? '（第 1 条为方向探索）' : ''));
  var t1 = CP.getJob(archive.computed.match.ranked[0].jobId);
  var tp = CP.report && CP.report.workMixTop ? CP.report.workMixTop(t1) : null;
  if (tp) {
    console.log('    首位岗位一周时间分配：' + CP.DUTY_KEYS.map(function (d) {
      return d.label + ' ' + t1.workMix[d.k] + '%';
    }).join('　'));
  }
  console.log('');
});

process.exit(failed ? 1 : 0);
