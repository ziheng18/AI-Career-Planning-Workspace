/*!
 * 计分层测试：归一化、反向题、维度得分、一致性、霍兰德代码、职业锚
 */
'use strict';
var t = require('./tiny');
var CP = require('./load');

/** 按规则给整套题库灌入答案：fn(bankId, item, dim, index) → 原始分 */
function fill(bankId, fn) {
  var bank = CP.BANKS[bankId];
  var answers = {};
  bank.items.forEach(function (it, idx) {
    // 时间戳间隔 5 秒，模拟正常作答速度，避免误触发计时告警
    answers[it.id] = { v: fn(bankId, it, it.dim, idx), t: 1700000000000 + idx * 5000 };

  });
  return answers;
}

/** 常量作答 */
function constant(bankId, v) {
  return fill(bankId, function () { return v; });
}

module.exports = function () {
  t.group('二、计分层');

  t.test('正向题归一化：1 分→0，5 分→100，3 分→50', function () {
    var item = { id: 'x', dim: 'R', text: '' };
    t.eq(CP.normItem(item, 1, { min: 1, max: 5 }), 0);
    t.eq(CP.normItem(item, 5, { min: 1, max: 5 }), 100);
    t.eq(CP.normItem(item, 3, { min: 1, max: 5 }), 50);
  });

  t.test('反向题归一化：原始 5 分→0，原始 1 分→100', function () {
    var item = { id: 'x', dim: 'R', text: '', reverse: true };
    t.eq(CP.normItem(item, 5, { min: 1, max: 5 }), 0);
    t.eq(CP.normItem(item, 1, { min: 1, max: 5 }), 100);
    t.eq(CP.normItem(item, 3, { min: 1, max: 5 }), 50);
  });

  t.test('行为锚量表（1-4）归一化：1→0，4→100', function () {
    var item = { id: 'x', dim: 'math', text: '' };
    t.eq(CP.normItem(item, 1, { min: 1, max: 4 }), 0);
    t.eq(CP.normItem(item, 4, { min: 1, max: 4 }), 100);
    t.near(CP.normItem(item, 2, { min: 1, max: 4 }), 33.33, 0.01);
  });

  t.test('缺失作答返回 null，且不计入维度样本数', function () {
    var bank = CP.BANKS.riasec;
    var answers = {};
    answers[bank.items[0].id] = { v: 5, t: 1 };
    var s = CP.scoreBank(bank, answers);
    t.eq(s.answered, 1);
    t.eq(s.total, 36);
    t.eq(s.dims.R.n, 1);
    t.eq(s.dims.I.n, 0);
    t.eq(s.dims.I.score, null);
  });

  t.test('全选 5 → 所有维度（含反向题修正后）得分符合预期', function () {
    var s = CP.scoreBank(CP.BANKS.riasec, constant('riasec', 5));
    // R 维有 1 道反向题：5 道 100 + 1 道 0 → 100*5/6
    t.near(s.dims.R.score, 100 * 5 / 6, 0.1, 'R 维含 1 道反向题');
    // I 维有 1 道反向题
    t.near(s.dims.I.score, 100 * 5 / 6, 0.1, 'I 维含 1 道反向题');
    // A 维有 1 道反向题
    t.near(s.dims.A.score, 100 * 5 / 6, 0.1, 'A 维含 1 道反向题');
    t.eq(s.completeness, 1);
  });

  t.test('全选 1 → 反向题维度得分为 100/6', function () {
    var s = CP.scoreBank(CP.BANKS.riasec, constant('riasec', 1));
    t.near(s.dims.R.score, 100 / 6, 0.1);
  });

  t.test('一致性检验能识别直线作答（反向题反方向作答时同样成立）', function () {
    // 直线作答的正确形态：正向题选 4，反向题选 2 —— 归一化后每道题都是 75，标准差 0
    var answers = fill('riasec', function (b, it) { return it.reverse ? 2 : 4; });
    var s = CP.scoreBank(CP.BANKS.riasec, answers);
    t.eq(s.dims.R.std, 0, '归一化后应无差异');
    var flags = CP.consistencyCheck(CP.BANKS.riasec, s);
    t.eq(flags.length, 6, '六个维度都应被标记');
    t.ok(flags[0].message.indexOf('标准差') >= 0);
  });

  t.test('原样全选同一个数字不算直线作答（反向题会自动形成差异）', function () {
    // 这是反向题的设计目的：机械勾选同一选项的人，在正反题上会自相矛盾
    var s = CP.scoreBank(CP.BANKS.riasec, constant('riasec', 4));
    t.ok(s.dims.R.std > 8, '含反向题的维度应产生差异，标准差 ' + s.dims.R.std);
    t.eq(CP.consistencyCheck(CP.BANKS.riasec, s).length, 0);
  });

  t.test('作答有区分度时不误报', function () {
    var answers = fill('riasec', function (b, it, dim, idx) { return (idx % 5) + 1; });
    var s = CP.scoreBank(CP.BANKS.riasec, answers);
    var flags = CP.consistencyCheck(CP.BANKS.riasec, s);
    t.eq(flags.length, 0, '有区分度的作答不应被标记');
  });

  t.test('题数不足 5 的维度不做一致性判断（能力自评每维仅 3 题）', function () {
    var s = CP.scoreBank(CP.BANKS.ability, constant('ability', 2));
    var flags = CP.consistencyCheck(CP.BANKS.ability, s);
    t.eq(flags.length, 0, '能力自评每维 3 题，不应触发一致性告警');
  });

  t.test('作答过快会被计时检验捕获', function () {
    var bank = CP.BANKS.riasec;
    var answers = {};
    bank.items.forEach(function (it, i) { answers[it.id] = { v: 3, t: 1700000000000 + i * 500 }; }); // 每题 0.5 秒
    var r = CP.timingCheck(bank, answers);
    t.eq(r.ok, false);
    t.ok(r.secondsPerItem < 1);
    t.ok(r.message.indexOf('偏快') >= 0);
  });

  t.test('正常作答速度不报警', function () {
    var r = CP.timingCheck(CP.BANKS.riasec, constant('riasec', 3));  // 每题 5 秒
    t.eq(r.ok, true);
  });

  t.test('霍兰德代码取兴趣前三维', function () {
    var s = CP.scoreBank(CP.BANKS.riasec, constant('riasec', 3));
    // 构造：I 最高、C 次之、R 第三
    var answers = constant('riasec', 1);
    CP.itemsOfDim('riasec', 'I').forEach(function (it) { answers[it.id] = { v: it.reverse ? 1 : 5, t: 1 }; });
    CP.itemsOfDim('riasec', 'C').forEach(function (it) { answers[it.id] = { v: it.reverse ? 1 : 4, t: 1 }; });
    CP.itemsOfDim('riasec', 'R').forEach(function (it) { answers[it.id] = { v: it.reverse ? 1 : 3, t: 1 }; });
    var scored = CP.scoreBank(CP.BANKS.riasec, answers);
    var h = CP.hollandCode(scored);
    t.eq(h.code, 'ICR');
    t.eq(h.top.length, 3);
    t.ok(h.all[0].score >= h.all[1].score, '结果应按降序排列');
  });

  t.test('职业锚主锚识别正确', function () {
    var answers = constant('anchor', 1);
    CP.itemsOfDim('anchor', 'TF').forEach(function (it) { answers[it.id] = { v: it.reverse ? 1 : 5, t: 1 }; });
    CP.itemsOfDim('anchor', 'GM').forEach(function (it) { answers[it.id] = { v: it.reverse ? 1 : 3, t: 1 }; });
    var scored = CP.scoreBank(CP.BANKS.anchor, answers);
    var a = CP.dominantAnchor(scored);
    t.eq(a.primary.id, 'TF');
    t.eq(a.secondary.id, 'GM');
    t.eq(a.isDual, false);
  });

  t.test('主副锚分差小于阈值时标记为双锚', function () {
    var answers = constant('anchor', 1);
    ['TF', 'GM'].forEach(function (d) {
      CP.itemsOfDim('anchor', d).forEach(function (it) { answers[it.id] = { v: it.reverse ? 1 : 5, t: 1 }; });
    });
    var scored = CP.scoreBank(CP.BANKS.anchor, answers);
    var a = CP.dominantAnchor(scored);
    t.eq(a.isDual, true, 'TF 与 GM 同分应判为双锚');
  });

  t.test('scoreAll 对空档案不崩溃，返回全部维度为 null', function () {
    var a = CP.createBlankArchive();
    var s = CP.scoreAll(a);
    t.eq(s.riasec.dims.R.score, null);
    t.eq(s.holland.code, '');
    t.eq(s.anchorTop.primary, null);
    t.ok(Array.isArray(s.flags));
  });

  t.test('scoreAll 的 flag 汇总包含各块的一致性与计时问题', function () {
    var a = CP.createBlankArchive();
    a.answers.riasec = constant('riasec', 3);
    var s = CP.scoreAll(a);
    t.ok(s.flags.length > 0, '直线作答 + 匀速应产生告警');
    t.ok(s.flags.some(function (f) { return f.block === 'riasec'; }));
  });
};

module.exports.fill = fill;
module.exports.constant = constant;
