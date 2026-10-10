/*!
 * 端到端测试：从空档案到完整结果快照 + 行动计划草案
 */
'use strict';
var t = require('./tiny');
var CP = require('./load');
var constant = require('./计分.test').constant;

function fullArchive() {
  var a = CP.createBlankArchive();
  a.profile.grade = '大三';
  a.profile.track = '人工智能';
  a.profile.gpaBand = '10-30%';
  a.profile.acceptPostgrad = '接受';
  a.decision.hoursPerWeek = 10;
  a.decision.targetCities = ['杭州', '上海'];

  // 兴趣：I 主导，E/S 中等，R/C 偏低，A 低
  a.answers.riasec = constant('riasec', 2);
  [['I', 5], ['E', 4], ['S', 4], ['C', 3], ['R', 2], ['A', 2]].forEach(function (pair) {
    CP.itemsOfDim('riasec', pair[0]).forEach(function (it) {
      a.answers.riasec[it.id] = { v: (it.reverse ? 6 - pair[1] : pair[1]), t: 1700000000000 };
    });
  });

  a.answers.anchor = constant('anchor', 2);
  [['GM', 5], ['EC', 4], ['TF', 3]].forEach(function (pair) {
    CP.itemsOfDim('anchor', pair[0]).forEach(function (it) {
      a.answers.anchor[it.id] = { v: (it.reverse ? 6 - pair[1] : pair[1]), t: 1700000000000 };
    });
  });

  // 能力：用"每维勾上前 n 项"描述水平（旧写法 v:2 在勾选式下没有意义）
  CP.fillAbility(a, { product: 4, comm: 4, data: 3, code: 2, deploy: 1, math: 2, model: 2, self: 3 });

  a.decision.jobPref = {
    'ai-pm': 'like', 'llm-app-engineer': 'like', 'ai-solution': 'like',
    'algo-research': 'neutral', 'ai-governance': 'exclude'
  };
  a.decision.criteriaOrder = ['interest', 'growth', 'ability', 'salary', 'location', 'balance'];
  return a;
}

module.exports = function () {
  t.group('五、端到端');

  t.test('完整档案通过完整性校验', function () {
    var a = fullArchive();
    var missing = CP.validateArchive(a);
    t.eq(missing.length, 0, '不应有缺失项，实际：' + JSON.stringify(missing));
  });

  t.test('buildResult 产出完整的五段结果', function () {
    var a = fullArchive();
    var r = CP.buildResult(a);
    ['score', 'match', 'decision', 'gaps', 'swot', 'missing', 'generatedAt'].forEach(function (k) {
      t.ok(r[k] !== undefined, '结果缺少 ' + k);
    });
    t.eq(r.score.holland.code.length, 3);
    t.ok(r.match.top.length === 3, '推荐岗位应为 3 个');
    t.eq(r.decision.ranked.length, 6);
    t.ok(r.gaps.length > 0, '应产出差距任务');
  });

  t.test('结果可序列化为 JSON 并原样还原', function () {
    var a = fullArchive();
    var r = CP.buildResult(a);
    var s = JSON.stringify(r);
    var back = JSON.parse(s);
    t.eq(back.match.top[0].jobId, r.match.top[0].jobId);
    t.near(back.match.top[0].fit, r.match.top[0].fit, 1e-9);
    t.eq(back.score.holland.code, r.score.holland.code);
  });

  t.test('重复计算结果稳定（幂等、不含随机性）', function () {
    var a = fullArchive();
    var r1 = CP.buildResult(a);
    var r2 = CP.buildResult(a);
    r2.generatedAt = r1.generatedAt;
    t.eq(JSON.stringify(r1), JSON.stringify(r2), '同一份档案两次计算结果应完全一致');
  });

  t.test('产品/沟通倾向的学生，首位推荐偏离纯算法岗', function () {
    var a = fullArchive();
    var r = CP.buildResult(a);
    var top1 = r.match.top[0].jobId;
    t.ok(top1 !== 'algo-research', '产品倾向学生首位不应是纯算法研究岗，实际 ' + top1);
  });

  t.test('被排除的岗位不出现在推荐中，但出现在排除清单里', function () {
    var a = fullArchive();
    var r = CP.buildResult(a);
    t.ok(r.match.ranked.every(function (x) { return x.jobId !== 'ai-governance'; }));
    t.ok(r.match.excluded.some(function (e) { return e.job.id === 'ai-governance'; }));
  });

  t.test('差距任务带验收作品与工时估算', function () {
    var a = fullArchive();
    var r = CP.buildResult(a);
    r.gaps.forEach(function (g) {
      t.ok(g.tasks.length > 0, g.dim + ' 缺少学习任务');
      t.ok(g.deliverables.length > 0, g.dim + ' 缺少验收作品');
      t.ok(g.hours > 0, g.dim + ' 缺少工时估算');
      t.ok(g.dueWeeks > 0, g.dim + ' 缺少周数估算');
    });
  });

  t.test('行动计划草案含差距任务与路径里程碑', function () {
    var a = fullArchive();
    var r = CP.buildResult(a);
    var acts = CP.draftActions(a, r.score, r.match, r.decision, '2026-03-01');
    t.ok(acts.length > 0);
    t.ok(acts.some(function (x) { return x.fromGap; }), '应含差距驱动任务');
    t.ok(acts.some(function (x) { return x.note && x.note.indexOf('主路径') >= 0; }), '应含路径里程碑');
    acts.forEach(function (x) {
      t.ok(x.title && x.id && x.status === 'todo', '行动项字段不完整');
      t.ok(/^\d{4}-\d{2}-\d{2}$/.test(x.due), '截止日期格式应为 YYYY-MM-DD，实际 ' + x.due);
    });
  });

  t.test('行动计划会插入一条岗位认知核对任务，且不再要求访谈', function () {
    var a = fullArchive();
    var r = CP.buildResult(a);
    var acts = CP.draftActions(a, r.score, r.match, r.decision, '2026-03-01');
    t.ok(acts.some(function (x) { return x.title.indexOf('核对') >= 0 && x.title.indexOf('日常工作内容') >= 0; }),
      '应插入岗位认知核对任务');
    t.ok(!acts.some(function (x) { return x.title.indexOf('访谈') >= 0; }), '不应再出现访谈任务');
  });

  t.test('SWOT 四象限均有内容', function () {
    var a = fullArchive();
    var r = CP.buildResult(a);
    ['strengths', 'weaknesses', 'opportunities', 'threats'].forEach(function (k) {
      t.ok(r.swot[k].length > 0, 'SWOT 的 ' + k + ' 为空');
    });
  });

  t.test('空白档案端到端不崩溃', function () {
    var a = CP.createBlankArchive();
    var r = CP.buildResult(a);
    t.ok(r.match.ranked.length > 0, '即使无作答也应给出岗位列表');
    t.ok(r.missing.length > 0);
  });

  t.test('极端档案：全部满分不崩溃且适配度不超过 100', function () {
    var a = fullArchive();
    CP.fillAbility(a, 6);                       // 每维勾满 6 项 = 能力全满
    a.answers.riasec = constant('riasec', 5);
    a.answers.anchor = constant('anchor', 5);
    var r = CP.buildResult(a);
    r.match.ranked.forEach(function (x) {
      t.ok(x.fit <= 100.001, x.jobId + ' 适配度越界：' + x.fit);
      t.ok(x.fit >= 0, x.jobId + ' 适配度为负');
    });
  });

  t.test('极端档案：全部最低分不产生 NaN', function () {
    var a = fullArchive();
    CP.fillAbility(a, 1);                       // 每维只勾第 1 项 = 能力最低档
    a.answers.riasec = constant('riasec', 1);
    a.answers.anchor = constant('anchor', 1);
    var r = CP.buildResult(a);
    r.match.ranked.forEach(function (x) {
      t.ok(!isNaN(x.fit), x.jobId + ' 适配度为 NaN');
      t.ok(x.parts.interest !== null && !isNaN(x.parts.interest));
    });
    t.ok(!isNaN(r.decision.ranked[0].total));
  });

  /* ============================================================
   * 大一模式：以兴趣定方向
   * ============================================================ */

  function freshArchive() {
    var a = CP.createBlankArchive();
    a.profile.grade = '大一';
    a.profile.track = '人工智能';
    a.profile.acceptPostgrad = '未定';
    a.decision.hoursPerWeek = 12;

    function put(blockId, fn, profile) {
      CP.activeItems(CP.BANKS[blockId], profile === null ? undefined : (profile || a.profile)).forEach(function (it, i) {
        a.answers[blockId][it.id] = { v: fn(it, i), t: 1700000000000 + i * 6000 };
      });
    }
    // 兴趣高度集中在研究型
    var ri = { I: 5, C: 4, E: 3, R: 2, A: 2, S: 2 };
    put('riasec', function (it) { return it.reverse ? 6 - ri[it.dim] : ri[it.dim]; });
    var an = { CH: 5, TF: 4, LS: 3, AU: 3, EC: 2, SV: 2, GM: 2, SE: 2 };
    put('anchor', function (it) { return it.reverse ? 6 - an[it.dim] : an[it.dim]; });
    // 大一版清单：每维勾上前 n 项（数学/编程跟做过，部署刚起步）
    CP.fillAbility(a, { math: 3, code: 3, data: 2, model: 2, deploy: 1, product: 2, comm: 3, self: 4 });
    return a;
  }

  t.test('大一档案：能力用勾选式清单计分，最低档不为 0 分', function () {
    var a = freshArchive();
    var s = CP.scoreAll(a);
    t.eq(s.abilityMode, 'checklist');
    t.eq(s.abilityGrade, 'fresh', '大一应使用大一版清单');
    t.eq(Object.keys(a.answers.ability).length, 20, '应记录 20 个勾选项');
    // 只勾第 1 项 → 得到该项权重占全维的比例，而不是 0
    var w = CP.ABILITY_WEIGHTS.fresh;
    var total = w.reduce(function (x, y) { return x + y; }, 0);
    t.eq(s.ability.dims.deploy.score, CP.round(w[0] / total * 100, 1), '只勾第 1 项应得到第 1 项的权重占比');
    t.ok(s.ability.dims.deploy.score > 0, '最低档必须给正分，否则等于说"没学过=没有潜力"');
    t.ok(s.ability.dims.self.score > s.ability.dims.deploy.score, '勾得多的维度应更高');
  });

  t.test('大一档案的完整性校验按大一版清单，且不再要求 GPA', function () {
    var a = freshArchive();
    a.decision.jobPref = { 'algo-research': 'like' };
    a.decision.criteriaOrder = CP.CRITERIA.map(function (c) { return c.id; });
    var missing = CP.validateArchive(a);
    t.eq(missing.length, 0, '大一档案应通过校验，实际：' + JSON.stringify(missing));
    t.eq(a.profile.gpaBand, '', '大一不应有 GPA 档位');
  });

  t.test('大一档案：岗位适配度以兴趣为主导，且算法类岗位排前', function () {
    var a = freshArchive();
    a.decision.jobPref = { 'algo-research': 'like', 'nlp-engineer': 'like', 'cv-engineer': 'neutral', 'ai-pm': 'exclude' };
    a.decision.criteriaOrder = CP.CRITERIA.map(function (c) { return c.id; });
    var r = CP.buildResult(a);
    t.eq(r.match.abilityMode, 'checklist');
    t.ok(r.match.isFreshman, '应标记为大一口径');
    var w = CP.fitWeightsFor(a.profile);
    t.ok(w.interest > w.ability, '大一兴趣权重应大于能力权重');
    var topIds = r.match.top.map(function (x) { return x.jobId; });
    t.ok(topIds.indexOf('algo-research') >= 0 || topIds.indexOf('nlp-engineer') >= 0,
      '研究型兴趣的大一学生，推荐里应出现算法类岗位，实际：' + topIds.join(','));
  });

  t.test('兴趣相同、能力不同时，大一的排名变化小于高年级', function () {
    function fitFor(grade, checked) {
      var a = freshArchive();
      a.profile.grade = grade;
      a.decision.jobPref = { 'algo-research': 'like', 'nlp-engineer': 'like' };
      a.decision.criteriaOrder = CP.CRITERIA.map(function (c) { return c.id; });
      // 覆盖能力作答：每维勾满 / 只勾第 1 项
      CP.fillAbility(a, checked);
      var r = CP.buildResult(a);
      var j = r.match.ranked.filter(function (x) { return x.jobId === 'algo-research'; })[0];
      return j.fit;
    }
    var dFresh = Math.abs(fitFor('大一', 6) - fitFor('大一', 1));
    var dSenior = Math.abs(fitFor('大三', 6) - fitFor('大三', 1));
    t.ok(dFresh < dSenior,
      '同样改变能力作答，大一的适配度变化应更小（兴趣主导），实际大一 ' + dFresh.toFixed(1) + ' vs 大三 ' + dSenior.toFixed(1));
  });

  t.test('大一的差距任务：第一条是顺着兴趣做一个小项目', function () {
    var a = freshArchive();
    a.decision.jobPref = { 'algo-research': 'like' };
    a.decision.criteriaOrder = CP.CRITERIA.map(function (c) { return c.id; });
    var r = CP.buildResult(a);
    t.ok(r.gaps.length >= 2, '应产出多条任务');
    t.eq(r.gaps[0].dim, '_explore', '第一条应为方向探索任务');
    t.ok(r.gaps[0].deliverables.length > 0, '探索任务也要有验收作品');
    t.ok(r.gaps[0].basis.indexOf('兴趣') >= 0, '探索任务应给出行动依据');
  });

  t.test('大一差距任务按"与兴趣方向贴合度"排序，而不是按缺口大小', function () {
    var a = freshArchive();
    a.decision.jobPref = { 'algo-research': 'like' };
    a.decision.criteriaOrder = CP.CRITERIA.map(function (c) { return c.id; });
    var r = CP.buildResult(a);
    var real = r.gaps.filter(function (g) { return g.dim !== '_explore'; });
    t.ok(real.length >= 2, '应有多条能力任务');
    // 每条都要有排序依据说明
    real.forEach(function (g) {
      t.ok(g.basis.indexOf('兴趣方向') >= 0, g.dim + ' 应给出兴趣贴合度依据');
      t.ok(g.interestFit !== null && g.interestFit >= 0 && g.interestFit <= 100, g.dim + ' 的贴合度应在 0-100');
    });
    // 排序应与贴合度一致（降序）
    for (var i = 1; i < real.length; i++) {
      t.ok(real[i - 1].interestFit >= real[i].interestFit,
        '应按贴合度降序，第 ' + i + ' 项失序：' + real[i - 1].interestFit + ' < ' + real[i].interestFit);
    }
    // 与高年级的排序口径不同
    var a2 = fullArchive();
    var r2 = CP.buildResult(a2);
    t.ok(r2.gaps.every(function (g) { return g.dim !== '_explore'; }), '非大一不应插入探索任务');
    if (r2.gaps.length) t.ok(r2.gaps[0].basis.indexOf('缺口严重度') >= 0, '高年级应按缺口严重度排序');
  });

  t.test('逐年规划建议锚到具体学年，且不含已经过去的学年', function () {
    var a = fullArchive();
    a.decision.criteriaOrder = CP.CRITERIA.map(function (c) { return c.id; });
    var r = CP.buildResult(a);
    var rows = CP.yearPlan(a, r.decision, r.match);

    t.ok(rows.length > 0, '应给出学年安排');
    rows.forEach(function (x) {
      t.ok(x.year && x.action && x.note, '每条都要有 year / action / note');
      // 每一条都必须锚到具体学年，不能是"未来一年"这种含糊说法
      t.ok(/^(大[一二三四]|研[一二三])$/.test(x.year), '学年标签不规范：' + x.year);
      t.ok(x.action.length > 8, x.year + ' 的行动太短');
      t.ok(x.note.length > 6, x.year + ' 缺少判断标准');
    });
    // 起点必须是本人当前年级
    t.eq(rows[0].year, a.profile.grade, '第一条应从当前年级开始');
    // 已经过去的学年不应出现
    var order = ['大一', '大二', '大三', '大四', '研一', '研二', '研三'];
    var startIdx = order.indexOf(a.profile.grade);
    rows.forEach(function (x) {
      t.ok(order.indexOf(x.year) >= startIdx, x.year + ' 已经过去了，不应再出现');
    });
  });

  t.test('逐年规划建议随年级推出对应的剩余学年', function () {
    var order = ['大一', '大二', '大三', '大四'];
    order.forEach(function (g) {
      var a = fullArchive();
      a.profile.grade = g;
      var rows = CP.yearPlan(a, null, null);
      t.eq(rows[0].year, g, g + ' 应从自己开始');
      t.eq(rows.length, 4 - order.indexOf(g), g + ' 应看到剩余 ' + (4 - order.indexOf(g)) + ' 个学年');
    });
    // 研究生只看到研一以后
    var m = fullArchive();
    m.profile.grade = '研一';
    var mrows = CP.yearPlan(m, null, null);
    t.eq(mrows.length, 3);
    t.eq(mrows[0].year, '研一');
  });

  t.test('逐年规划建议按主路径调整侧重', function () {
    var a = fullArchive();
    a.decision.criteriaOrder = CP.CRITERIA.map(function (c) { return c.id; });

    // 考公路径：每条都应提示考公节奏
    a.decision.pathScores = {};
    var r = CP.buildResult(a);
    var examRows = CP.yearPlan(a, { primary: { pathId: 'p-考公', name: '考公' } }, r.match);
    t.ok(examRows.every(function (x) { return x.action.indexOf('考公') >= 0; }),
      '考公主路径应在每条建议里点出考公节奏');

    // 研究型路径：中期学年（大二/研一/研二）应提示科研优先
    var b = fullArchive();
    b.profile.grade = '大二';
    var resRows = CP.yearPlan(b, { primary: { pathId: 'p-baoyan', name: '保研' } }, r.match);
    t.ok(resRows.some(function (x) { return x.action.indexOf('研究') >= 0; }),
      '研究型主路径应在大二点出科研优先，实际：' + resRows.map(function (x) { return x.action; }).join(' | '));

    // 就业型路径：大三应提示实习优先
    var c = fullArchive();
    c.profile.grade = '大三';
    var jobRows = CP.yearPlan(c, { primary: { pathId: 'p-直接就业', name: '直接就业' } }, r.match);
    t.ok(jobRows.some(function (x) { return x.action.indexOf('就业路线') >= 0; }),
      '就业型主路径应在大三点出实习优先');

    // 缺参数不应崩
    t.ok(CP.yearPlan(a, null, null).length > 0, '没有 decision 时也应给出建议');
    t.ok(CP.yearPlan(null, null, null).length > 0, '档案为空时应回退到默认年级');
  });

  t.test('大一的 SWOT 用"待补"而不是"短板"措辞', function () {
    var a = freshArchive();
    a.decision.jobPref = { 'algo-research': 'like' };
    a.decision.criteriaOrder = CP.CRITERIA.map(function (c) { return c.id; });
    var r = CP.buildResult(a);
    var txt = r.swot.weaknesses.join('');
    t.ok(txt.indexOf('尚未开始') >= 0 || txt.indexOf('不是做不到') >= 0,
      '大一的劣势表述应说明"没学过 ≠ 做不到"，实际：' + txt);
    t.ok(r.swot.opportunities.join('').indexOf('3 年') >= 0, '应指出大一还有时间优势');
    t.ok(r.swot.threats.join('').indexOf('只上课不动手') >= 0, '应给出大一最真实的风险');
  });

  t.test('大一档案整体可重复计算（幂等）', function () {
    var a = freshArchive();
    a.decision.jobPref = { 'algo-research': 'like' };
    a.decision.criteriaOrder = CP.CRITERIA.map(function (c) { return c.id; });
    var r1 = CP.buildResult(a);
    var r2 = CP.buildResult(a);
    r2.generatedAt = r1.generatedAt;
    t.eq(JSON.stringify(r1), JSON.stringify(r2), '大一档案两次计算结果应完全一致');
  });
};
