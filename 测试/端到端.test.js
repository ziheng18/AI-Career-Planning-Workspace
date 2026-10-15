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

  t.test('大一档案的完整性校验按大一版清单，且 GPA 不参与校验', function () {
    var a = freshArchive();
    a.decision.jobPref = { 'algo-research': 'like' };
    a.decision.criteriaOrder = CP.CRITERIA.map(function (c) { return c.id; });
    var missing = CP.validateArchive(a);
    t.eq(missing.length, 0, '大一档案应通过校验，实际：' + JSON.stringify(missing));
    // GPA 档位与年级无关，也不参与适配度计算——留空、或填任何档位，校验都应通过
    t.eq(a.profile.gpaBand, '', '空档案的 GPA 档位默认应为空');
    ['尚未评定', '不便填写', '前 10%'].forEach(function (v) {
      a.profile.gpaBand = v;
      t.eq(CP.validateArchive(a).length, 0, 'GPA 填「' + v + '」不应影响校验');
    });
    // 大一示例档案用的是"尚未评定"——大一通常还没出排名
    t.eq(CP.demoArchiveFresh().profile.gpaBand, '尚未评定', '大一示例的 GPA 档位应为「尚未评定」');
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
    var rows = CP.yearPlan(a, r.score, r.decision, r.match);

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
      var rows = CP.yearPlan(a, null, null, null);
      t.eq(rows[0].year, g, g + ' 应从自己开始');
      t.eq(rows.length, 4 - order.indexOf(g), g + ' 应看到剩余 ' + (4 - order.indexOf(g)) + ' 个学年');
    });
    // 研究生只看到研一以后
    var m = fullArchive();
    m.profile.grade = '研一';
    var mrows = CP.yearPlan(m, null, null, null);
    t.eq(mrows.length, 3);
    t.eq(mrows[0].year, '研一');
  });

  t.test('逐年规划建议随本人的测评结果变化（不是一份通用模板）', function () {
    // 这是本模块的核心要求：两个兴趣与能力差异极大的人，拿到的规划必须不同。
    // 回归背景：旧版只读「年级 + 主路径」，两份差异极大的档案会得到几乎一样的规划；
    // 而且没填路径评分时主路径由数组顺序决定，会给出"你该走研究路线"这种无依据的定调。
    function profile(riasec, abilityMap, jobPref) {
      var a = CP.createBlankArchive();
      a.profile.grade = '大三';
      a.profile.track = '人工智能';
      a.decision.hoursPerWeek = 10;
      CP.activeItems(CP.BANKS.riasec, null).forEach(function (it) {
        a.answers.riasec[it.id] = { v: riasec[it.dim] || 2, t: 1 };
      });
      CP.activeItems(CP.BANKS.anchor, null).forEach(function (it) {
        a.answers.anchor[it.id] = { v: 3, t: 1 };
      });
      CP.fillAbility(a, abilityMap);
      a.decision.jobPref = jobPref;
      a.decision.criteriaOrder = CP.CRITERIA.map(function (c) { return c.id; });
      return a;
    }

    var strong = profile({ I: 5, R: 4, C: 4, A: 2, S: 2, E: 2 },
      { math: 5, code: 5, data: 4, model: 5, deploy: 3, product: 2, comm: 3, self: 4 },
      { 'algo-research': 'like', 'nlp-engineer': 'like' });
    var weak = profile({ I: 2, R: 1, C: 2, A: 5, S: 5, E: 4 },
      { math: 1, code: 1, data: 1, model: 1, deploy: 1, product: 1, comm: 3, self: 2 },
      { 'ai-pm': 'like', 'ai-solution': 'like', 'llm-app-engineer': 'like' });

    var rs = CP.buildResult(strong);
    var rw = CP.buildResult(weak);
    var ps = CP.yearPlan(strong, rs.score, rs.decision, rs.match);
    var pw = CP.yearPlan(weak, rw.score, rw.decision, rw.match);

    var flat = function (rows) {
      return rows.map(function (r) {
        return r.year + '|' + r.action + '|' + (r.focus || []).join('；');
      }).join('\n');
    };
    t.ok(flat(ps) !== flat(pw), '两个差异极大的档案应得到不同的规划');

    // 能力缺口必须来自实测：乙的能力弱得多，缺口分值应显著更大
    var gapOf = function (rows, probe) {
      var hit = null;
      rows.forEach(function (r) {
        (r.focus || []).forEach(function (f) {
          if (f.indexOf(probe) >= 0) {
            var m = /还差 (\d+) 分/.exec(f);
            if (m) hit = Number(m[1]);
          }
        });
      });
      return hit;
    };
    // 档案里最高的能力维度得分不同，缺口数字必须跟着变（而不是同一串写死的文案）
    var allFocus = function (rows) {
      return rows.map(function (r) { return (r.focus || []).join('；'); }).join('；');
    };
    t.ok(allFocus(ps) !== allFocus(pw), '个性化要点也应不同');
    t.ok(allFocus(ps).indexOf('重点补') >= 0, '应点出要补的能力维度');
    t.ok(/还差 \d+ 分/.test(allFocus(ps)), '缺口应带具体分值');
    // 强者的缺口分值一定小于弱者
    var nums = function (txt) { return (txt.match(/还差 (\d+) 分/g) || []).map(function (x) { return Number(x.replace(/\D/g, '')); }); };
    var nStrong = nums(allFocus(ps)), nWeak = nums(allFocus(pw));
    t.ok(nStrong.length && nWeak.length, '两边都应有缺口分值');
    t.ok(Math.min.apply(null, nWeak) > Math.min.apply(null, nStrong),
      '能力弱的一方缺口分值应更大：弱 ' + nWeak.join(',') + ' vs 强 ' + nStrong.join(','));

    // 兴趣方向要参与措辞：艺术社会型不该被劝去"选研究细分方向"
    t.ok(allFocus(pw).indexOf('表达空间') >= 0 || allFocus(pw).indexOf('与人打交道') >= 0
      || allFocus(pw).indexOf('推进事情') >= 0,
      '兴趣方向应体现在建议里，实际：' + allFocus(pw));
  });

  t.test('逐年规划建议不依赖"可能没填"的路径评分', function () {
    // 回归：没填 pathScores 时六条路径默认分几乎并列，主路径由数组顺序决定。
    // 旧版据此给每条建议加"研究路线 / 就业路线"后缀，等于凭空定调。
    var a = fullArchive();
    a.decision.criteriaOrder = CP.CRITERIA.map(function (c) { return c.id; });
    a.decision.pathScores = {};                  // 完全不填
    var r = CP.buildResult(a);
    var rows = CP.yearPlan(a, r.score, r.decision, r.match);
    var flat = rows.map(function (x) { return x.action; }).join(' | ');
    ['研究路线', '就业路线', '考公节奏'].forEach(function (w) {
      t.ok(flat.indexOf(w) < 0, '未填路径评分时不应出现"' + w + '"这种无依据的定调');
    });
    // 但培养路线应改由**首位岗位的学历门槛**推出，那才是实测依据
    var top = r.match.ranked[0];
    t.ok(top && top.minEdu, '应能拿到首位岗位的学历门槛');
  });

  t.test('逐年规划建议在缺参数时安全退化', function () {
    var a = fullArchive();
    t.ok(CP.yearPlan(a, null, null, null).length > 0, '没有 score/decision/match 时也应给出骨架');
    t.ok(CP.yearPlan(null, null, null, null).length > 0, '档案为空时应回退到默认年级');
    // 缺数据时不应出现 undefined / NaN
    var txt = CP.yearPlan(a, null, null, null).map(function (r) {
      return r.action + (r.focus || []).join('');
    }).join('');
    t.ok(txt.indexOf('undefined') < 0, '不应出现 undefined');
    t.ok(txt.indexOf('NaN') < 0, '不应出现 NaN');
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
