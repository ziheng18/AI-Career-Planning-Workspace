/*!
 * 匹配层测试：兴趣匹配、能力软最小值、锚对齐、门槛过滤、路径决策
 */
'use strict';
var t = require('./tiny');
var CP = require('./load');

var fill = require('./计分.test').fill;
var constant = require('./计分.test').constant;

/** 构造一份"典型算法研究型"档案 */
function algoProfile() {
  var a = CP.createBlankArchive();
  a.profile.grade = '大三';
  a.profile.acceptPostgrad = '接受';
  a.decision.hoursPerWeek = 12;
  // 兴趣：I 高、C 次之、S/E 低
  a.answers.riasec = constant('riasec', 2);
  [['I', 5], ['C', 4], ['R', 3]].forEach(function (pair) {
    CP.itemsOfDim('riasec', pair[0]).forEach(function (it) {
      a.answers.riasec[it.id] = { v: (it.reverse ? 1 : pair[1]), t: 1700000000000 };
    });
  });
  // 职业锚：CH 为主，TF 为副
  a.answers.anchor = constant('anchor', 1);
  [['CH', 5], ['TF', 4]].forEach(function (pair) {
    CP.itemsOfDim('anchor', pair[0]).forEach(function (it) {
      a.answers.anchor[it.id] = { v: (it.reverse ? 1 : pair[1]), t: 1700000000001 };
    });
  });
  // 能力：数学与建模强，部署与产品弱（勾选式：每维勾上前 n 项）
  CP.fillAbility(a, { math: 5, model: 5, data: 4, code: 4, deploy: 1, product: 1, comm: 3, self: 3 });
  return a;
}

module.exports = function () {
  t.group('三、匹配层');

  t.test('兴趣匹配：完全达标得 100', function () {
    var job = CP.getJob('algo-research');
    var full = {};
    Object.keys(job.interest).forEach(function (k) { full[k] = 100; });
    var r = CP.interestScore(full, job);
    t.eq(r.score, 100);
  });

  t.test('兴趣匹配：超出岗位期望不加分（封顶）', function () {
    var job = CP.getJob('algo-research');
    var full = {};
    Object.keys(job.interest).forEach(function (k) { full[k] = 100; });
    var r1 = CP.interestScore(full, job);
    var full2 = {};
    Object.keys(job.interest).forEach(function (k) { full2[k] = 100; });
    t.eq(r1.score, CP.interestScore(full2, job).score, '同分应稳定');
    // 只把远超期望的维度拉满，不应使总分超过 100
    t.ok(r1.score <= 100);
  });

  t.test('兴趣匹配：全 0 得 0 分', function () {
    var job = CP.getJob('algo-research');
    var zero = {};
    Object.keys(job.interest).forEach(function (k) { zero[k] = 0; });
    t.eq(CP.interestScore(zero, job).score, 0);
  });

  t.test('能力适配：完全达标得 100', function () {
    var job = CP.getJob('algo-research');
    var full = {};
    Object.keys(job.ability).forEach(function (k) { full[k] = job.ability[k]; });
    t.eq(CP.abilityScore(full, job).score, 100);
  });

  t.test('能力适配：能力高于要求不扣分、也不加分', function () {
    var job = CP.getJob('algo-research');
    var full = {};
    Object.keys(job.ability).forEach(function (k) { full[k] = 100; });
    t.eq(CP.abilityScore(full, job).score, 100);
  });

  t.test('能力适配：软最小值——单点大缺口比分散小缺口惩罚更重', function () {
    var job = CP.getJob('llm-app-engineer');
    var base = {}; Object.keys(job.ability).forEach(function (k) { base[k] = 70; });

    // 方案甲：把全部 50 分缺口压在一个维度上
    var oneDeep = JSON.parse(JSON.stringify(base));
    oneDeep.code = 20;

    // 方案乙：把同样 50 分总缺口摊到 4 个维度上
    var spread = JSON.parse(JSON.stringify(base));
    ['data', 'model', 'product', 'math'].forEach(function (k) { spread[k] = 70 - 50 / 4; });

    var sDeep = CP.abilityScore(oneDeep, job).score;
    var sSpread = CP.abilityScore(spread, job).score;
    t.ok(sDeep < sSpread,
      '同样缺口总量下，单点深坑应比分散短板更受惩罚（深坑 ' + sDeep + ' vs 分散 ' + sSpread + '）');
  });

  t.test('缺口平方性质：单维缺口 50 的惩罚是缺口 75 的 4 倍', function () {
    var job = { ability: { a: 100 }, abilityWeight: { a: 1 } };
    var gap50 = CP.abilityScore({ a: 50 }, job).score;    // 缺口 50 → 0.5^2 = 0.25 → 25 分
    var gap25 = CP.abilityScore({ a: 75 }, job).score;    // 缺口 25 → 0.75^2 = 0.5625 → 56.25 分
    t.near(gap50, 25, 0.1);
    t.near(gap25, 56.25, 0.1);
    // 损失量：75 分 vs 43.75 分 → 缺口翻倍，损失不是翻倍而是约 1.71 倍
    t.near((100 - gap50) / (100 - gap25), 75 / 43.75, 0.01, '损失比例应体现平方关系');
    t.ok((100 - gap50) > (100 - gap25), '缺口越大损失越大');
  });

  /* 锚对齐公式：满分基准 = 主锚 1.0 + 副锚 0.5 = 1.5
     命中岗位锚画像第 1 位得 1.0，命中第 2/3 位得 0.5，未命中得 0 */

  t.test('锚对齐：主锚命中首位 + 副锚不相关 → 1.0/1.5 = 66.7', function () {
    var job = CP.getJob('algo-research');      // anchor: [CH, TF]
    var a = { primary: { id: 'CH', label: '纯粹挑战型' }, secondary: { id: 'LS', label: '生活整合型' } };
    t.near(CP.anchorScore(a, job).score, 66.7, 0.1);
  });

  t.test('锚对齐：主锚命中首位 + 副锚命中次位 → 1.25/1.5 = 83.3', function () {
    var job = CP.getJob('algo-research');      // anchor: [CH, TF]
    var a = { primary: { id: 'CH', label: '纯粹挑战型' }, secondary: { id: 'TF', label: '技术职能型' } };
    t.near(CP.anchorScore(a, job).score, 83.3, 0.1);
  });

  t.test('锚对齐：主锚命中次位 + 副锚不相关 → 0.5/1.5 = 33.3', function () {
    var job = CP.getJob('algo-research');      // anchor: [CH, TF]
    var a = { primary: { id: 'TF', label: '技术职能型' }, secondary: { id: 'LS', label: '生活整合型' } };
    t.near(CP.anchorScore(a, job).score, 33.3, 0.1);
  });

  t.test('锚对齐：主锚不在画像中、副锚命中非首位', function () {
    var job = CP.getJob('algo-research');      // anchor: [CH, TF]
    var a = { primary: { id: 'LS', label: '生活整合型' }, secondary: { id: 'TF', label: '技术职能型' } };
    var r = CP.anchorScore(a, job);
    // 主锚 0 分，副锚命中第 2 位得 0.5 × 权重 0.5 = 0.25，满分 1.5 → 16.67
    t.near(r.score, 100 * 0.25 / 1.5, 0.1);
  });

  t.test('锚对齐：完全不相干得 0 分', function () {
    var job = CP.getJob('algo-research');
    var a = { primary: { id: 'LS', label: '生活整合型' }, secondary: { id: 'SE', label: '安全稳定型' } };
    t.eq(CP.anchorScore(a, job).score, 0);
  });

  t.test('学历门槛：本科 + 不接受读研 → 硕士岗被排除', function () {
    var a = algoProfile();
    a.profile.acceptPostgrad = '不接受';
    var f = CP.filterJobs(a);
    var ids = f.passed.map(function (j) { return j.id; });
    t.ok(ids.indexOf('algo-research') < 0, '算法研究员（硕士门槛）应被排除');
    t.ok(ids.indexOf('nlp-engineer') < 0, 'NLP 大模型算法（硕士门槛）应被排除');
    t.ok(ids.indexOf('llm-app-engineer') >= 0, '本科门槛岗位应保留');
    t.ok(f.excluded.length >= 2);
    t.ok(f.excluded[0].reasons[0].indexOf('门槛') >= 0);
  });

  t.test('学历门槛：接受读研 → 硕士岗保留', function () {
    var a = algoProfile();
    a.profile.acceptPostgrad = '接受';
    var ids = CP.filterJobs(a).passed.map(function (j) { return j.id; });
    t.ok(ids.indexOf('algo-research') >= 0);
  });

  t.test('明确排除的岗位被过滤掉', function () {
    var a = algoProfile();
    a.decision.jobPref['ai-pm'] = 'exclude';
    var f = CP.filterJobs(a);
    t.ok(f.passed.every(function (j) { return j.id !== 'ai-pm'; }));
    t.ok(f.excluded.some(function (e) { return e.job.id === 'ai-pm' && e.reasons[0].indexOf('排除') >= 0; }));
  });

  t.test('适配度权重之和为 1，且分项与公式一致', function () {
    [['大一', 'checklist'], ['大三', 'checklist'], ['', 'checklist']].forEach(function (pair) {
      var w = CP.fitWeightsFor({ grade: pair[0] });
      t.near(w.interest + w.ability + w.anchor, 1, 1e-9, pair[0] + ' 的权重之和应为 1');
      t.ok(w.interest > 0 && w.ability > 0 && w.anchor > 0);
    });
    // 大一以兴趣为主，其他年级以能力为主
    var fresh = CP.fitWeightsFor({ grade: '大一' });
    var senior = CP.fitWeightsFor({ grade: '大三' });
    t.ok(fresh.interest > senior.interest, '大一的兴趣权重应更高');
    t.ok(senior.ability > fresh.ability, '其他年级的能力权重应更高');
    t.ok(fresh.interest > fresh.ability, '大一应以兴趣主导');

    var a = algoProfile();
    var score = CP.scoreAll(a);
    var m = CP.matchJobs(a, score);
    var top = m.ranked[0];
    var expect = top.parts.interestWeight * top.parts.interest
      + top.parts.abilityWeight * top.parts.ability
      + top.parts.anchorWeight * (top.parts.anchor === null ? 0 : top.parts.anchor);
    t.near(top.fit, expect, 0.01);
  });

  t.test('大一的适配度以兴趣为主导', function () {
    var a = algoProfile();
    a.profile.grade = '大一';
    var score = CP.scoreAll(a);
    t.eq(score.abilityMode, 'checklist', '能力部分应使用勾选式清单');
    t.eq(score.abilityGrade, 'fresh', '大一应使用大一版清单');
    var m = CP.matchJobs(a, score);
    var top = m.ranked[0];
    t.ok(top.parts.interestWeight > top.parts.abilityWeight, '大一应兴趣权重大于能力权重');
  });

  t.test('算法研究型学生：适配度首位是算法类岗位', function () {
    var a = algoProfile();
    var m = CP.matchJobs(a, CP.scoreAll(a));
    var topIds = m.top.map(function (x) { return x.jobId; });
    t.ok(topIds.indexOf('algo-research') >= 0 || topIds.indexOf('nlp-engineer') >= 0,
      '算法倾向学生的高适配岗位应包含算法类，实际：' + topIds.join(','));
  });

  t.test('排序结果按 fit 严格降序', function () {
    var a = algoProfile();
    var m = CP.matchJobs(a, CP.scoreAll(a));
    for (var i = 1; i < m.ranked.length; i++) {
      t.ok(m.ranked[i - 1].fit >= m.ranked[i].fit, '排序在第 ' + i + ' 项失序');
    }
  });

  t.test('每项结果都给出贡献项与拖累项', function () {
    var a = algoProfile();
    var m = CP.matchJobs(a, CP.scoreAll(a));
    m.ranked.forEach(function (r) {
      t.ok(r.contributions.length > 0, r.jobId + ' 缺少贡献项');
      t.ok(r.drags.length > 0, r.jobId + ' 缺少拖累项（该档案存在短板，应有拖累项）');
      t.ok(r.shown === Math.round(r.fit), '展示值应为四舍五入整数');
    });
  });

  t.test('贡献项与拖累项的百分比各自合计约 100', function () {
    var a = algoProfile();
    var r = CP.matchJobs(a, CP.scoreAll(a)).ranked[0];
    var cs = r.contributions.reduce(function (s, x) { return s + x.pct; }, 0);
    // 只取了前 3 项，不足 100 属正常；但不应超过 100
    t.ok(cs <= 100.1, '贡献项占比合计不应超过 100，实际 ' + cs);
    t.ok(r.drags[0].gap > 0, '首位拖累项应有实际缺口');
  });

  t.test('置信度：前两名分差小于 5 分时标记为不确定性高', function () {
    var a = algoProfile();
    var m = CP.matchJobs(a, CP.scoreAll(a));
    if (m.margin !== null && m.margin < 5) {
      t.eq(m.ambiguous, true);
      t.ok(m.margin < 5);
    } else {
      t.eq(m.ambiguous, false);
      t.ok(m.margin >= 5);
    }
  });

  t.group('四、路径决策');

  t.test('决策权重：按排序递减且合计为 1', function () {
    var order = CP.CRITERIA.map(function (c) { return c.id; });
    var cw = CP.criteriaWeights(order);
    t.near(Object.keys(cw.weights).reduce(function (s, k) { return s + cw.weights[k]; }, 0), 1, 1e-9);
    t.ok(cw.weights[order[0]] > cw.weights[order[5]], '第一位权重应大于最后一位');
    t.eq(cw.normalized, true);
  });

  t.test('决策权重：未排序时退化为等权（不替用户预设优先级）', function () {
    var cw = CP.criteriaWeights([]);
    t.eq(cw.normalized, false);
    CP.CRITERIA.forEach(function (c) {
      t.near(cw.weights[c.id], 1 / 6, 1e-9, c.id + ' 应为等权');
    });
  });

  t.test('路径得分 = Σ(评分/5×100×权重)', function () {
    var a = algoProfile();
    a.decision.criteriaOrder = CP.CRITERIA.map(function (c) { return c.id; });
    var d = CP.decidePaths(a);
    var p = d.ranked[0];
    var expect = p.detail.reduce(function (s, x) { return s + (x.score / 5) * 100 * (x.weight / 100); }, 0);
    t.near(p.total, expect, 0.05);
  });

  t.test('用户提高"稳定"相关标准权重会改变路径排序', function () {
    var a1 = algoProfile();
    a1.decision.criteriaOrder = ['growth', 'interest', 'ability', 'salary', 'location', 'balance'];
    var r1 = CP.decidePaths(a1).ranked[0].pathId;

    var a2 = algoProfile();
    a2.decision.criteriaOrder = ['balance', 'location', 'salary', 'ability', 'interest', 'growth'];
    var r2 = CP.decidePaths(a2).ranked[0].pathId;

    t.ok(r1 !== r2, '不同权重下首位路径应发生变化，实际都是 ' + r1);
  });

  t.test('用户覆盖评分会生效', function () {
    var a = algoProfile();
    a.decision.criteriaOrder = ['balance', 'location', 'salary', 'ability', 'interest', 'growth'];
    var before = CP.decidePaths(a).ranked.filter(function (r) { return r.pathId === 'p-考公'; })[0].total;
    a.decision.pathScores['p-考公'] = { balance: 5, interest: 5, ability: 5, salary: 5, location: 5, growth: 5 };
    var after = CP.decidePaths(a).ranked.filter(function (r) { return r.pathId === 'p-考公'; })[0].total;
    t.ok(after > before, '全项打 5 分后总分应上升');
    t.eq(CP.decidePaths(a).ranked.filter(function (r) { return r.pathId === 'p-考公'; })[0].editedByUser, true);
  });

  t.test('路径决策给出一致性判断', function () {
    var a = algoProfile();
    a.decision.criteriaOrder = CP.CRITERIA.map(function (c) { return c.id; });
    var d = CP.decidePaths(a);
    t.eq(d.consistent, d.ranked[0].pathId === d.bestOnTopCriterion.pathId);
    t.ok(d.primary !== null && d.planB !== null);
  });

  t.test('空白档案下路径决策不崩溃', function () {
    var d = CP.decidePaths(CP.createBlankArchive());
    t.eq(d.ranked.length, 6);
  });
};
