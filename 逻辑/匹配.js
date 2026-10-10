/*!
 * 逻辑/匹配.js — 第 2~5 层：兴趣匹配、能力适配、锚对齐、门槛过滤、路径决策
 *
 * 全部为纯函数。核心公式（与界面"查看推导"面板逐项对应）：
 *
 *   interest(job) = 100 × Σ w_k·min(I_k / r_k, 1) / Σ w_k
 *   ability(job)  = 100 × Σ ω_k·(1 − max(0, req_k − S_k)/100)^2 / Σ ω_k
 *   anchor(job)   = 100 × Σ A(用户锚) / Σ A_max,  A(主锚命中)=1.0, A(副锚命中)=0.5
 *
 *   Fit(job) = w_i·interest + w_a·ability + w_n·anchor
 *   权重随年级切换：大一 = (0.65, 0.22, 0.13)，其他 = (0.40, 0.45, 0.15)
 *   理由见 数据/schema.js 的 CP.fitWeightsFor 注释。
 */
(function (root) {
  'use strict';
  var CP = (root.CP = root.CP || {});

  /* ---------------- 学历与门槛 ---------------- */

  CP.eduRank = function (label) {
    var i = CP.EDU_LEVELS.indexOf(label);
    return i < 0 ? null : i;
  };

  /** 年级 → 学历等级 */
  CP.gradeEduRank = function (grade) {
    if (!grade) return null;
    if (grade.indexOf('研') === 0) return 2;
    if (grade.indexOf('博') === 0) return 3;
    if (grade.indexOf('大') === 0) return 1;
    if (grade.indexOf('专') === 0) return 0;
    return null;
  };

  /**
   * 推断"我最终可达的学历上限"。
   * 明确不接受读研 → 停在当前学历；接受或未定 → 至少硕士。
   */
  CP.maxReachableEdu = function (profile) {
    var cur = CP.gradeEduRank(profile.grade);
    if (cur === null) return null;
    if (profile.acceptPostgrad === '不接受') return cur;
    return Math.max(cur, 2);
  };

  /* ---------------- 第 2 层：兴趣匹配 ---------------- */

  CP.interestScore = function (userInterest, job) {
    var sum = 0, wsum = 0, detail = [];
    Object.keys(job.interest).forEach(function (k) {
      var r = job.interest[k];
      if (!r) return;
      var u = userInterest[k];
      var ratio = u == null ? 0 : Math.min(u / r, 1);
      detail.push({ dim: k, want: r, got: u, ratio: ratio, weight: r, contrib: r * ratio });
      sum += r * ratio;
      wsum += r;
    });
    if (!wsum) return { score: 0, detail: detail };
    return { score: CP.round((sum / wsum) * 100, 1), detail: detail };
  };

  /* ---------------- 第 3 层：能力适配（软最小值） ---------------- */

  CP.abilityScore = function (userAbility, job) {
    var req = job.ability, w = job.abilityWeight || job.ability;
    var sum = 0, wsum = 0, detail = [];
    Object.keys(req).forEach(function (k) {
      var omega = w[k] == null ? 1 : w[k];
      if (!omega) return;
      var need = req[k];
      var got = userAbility[k];
      // 未作答按"完全不足"处理；缺口统一保留 1 位小数，
      // 否则 100 − 96.6 这类减法会把 3.400000000000006 一路带到界面和报告里
      var gap = CP.round(got == null ? need : Math.max(0, need - got), 1);
      var factor = Math.pow(1 - gap / 100, 2);
      detail.push({ dim: k, req: need, got: got, gap: gap, weight: omega, factor: factor, contrib: omega * factor });
      sum += omega * factor;
      wsum += omega;
    });
    if (!wsum) return { score: 0, detail: detail };
    return { score: CP.round((sum / wsum) * 100, 1), detail: detail };
  };

  /* ---------------- 职业锚对齐 ---------------- */

  /**
   * 主锚命中岗位锚画像第 1 位得 1.0，命中非首位得 0.5；副锚同样规则但计 0.5 权重。
   * 满分基准 = 主锚 1.0 + 副锚 0.5 = 1.5，即只有"主锚命中首位且副锚也命中"才得 100。
   */
  CP.anchorScore = function (anchorTop, job) {
    if (!anchorTop || !anchorTop.primary) return { score: null, detail: [] };
    var list = (job.anchor || []).slice(0, 3);
    var maxSum = 1.0 + 0.5;            // 主锚满分 + 副锚满分
    var sum = 0, detail = [];

    function hit(a, weight) {
      if (!a) return;
      var idx = list.indexOf(a.id);
      if (idx < 0) {
        detail.push({ anchor: a.id, label: a.label, weight: weight, got: 0, reason: '不在该岗位的锚画像中' });
        return;
      }
      var v = idx === 0 ? 1.0 : 0.5;
      detail.push({
        anchor: a.id, label: a.label, weight: weight, got: v,
        reason: idx === 0 ? '是该岗位的首要锚' : '与该岗位的锚画像部分吻合'
      });
      sum += weight * v;
    }
    hit(anchorTop.primary, 1.0);
    hit(anchorTop.secondary, 0.5);

    return { score: CP.round((sum / maxSum) * 100, 1), detail: detail, jobAnchors: list };
  };

  /* ---------------- 门槛过滤 ----------------
   * 只保留两条真正影响可行性的门槛：
   *   1. 学历门槛高于我的可达学历
   *   2. 我明确排除的岗位族
   * 城市不参与筛选：岗位库未逐岗标注城市，而且"愿意去哪个城市"是用户的倾向，
   * 强行过滤只会让用户连结果都看不到。城市信息仅作展示。
   */

  CP.filterJobs = function (archive) {
    var myEdu = CP.maxReachableEdu(archive.profile);
    var pref = archive.decision.jobPref || {};
    var excluded = [], passed = [];

    CP.JOB_FAMILIES.forEach(function (job) {
      var reasons = [];
      if (pref[job.id] === 'exclude') reasons.push('你已明确排除该岗位族');
      if (myEdu !== null && CP.eduRank(job.minEdu) !== null && CP.eduRank(job.minEdu) > myEdu) {
        reasons.push('该岗位门槛为「' + job.minEdu + '」，高于你的可达学历（可接受读研='
          + (archive.profile.acceptPostgrad || '未填写') + '）');
      }
      if (reasons.length) excluded.push({ job: job, reasons: reasons });
      else passed.push(job);
    });

    return { passed: passed, excluded: excluded };
  };

  /* ---------------- 第 4 层：综合适配度 ---------------- */

  /**
   * 年级相关的适配度权重。大一以兴趣为主，其他年级以能力为主。
   * 返回的权重之和为 1（见 测试/契约.test.js 的断言）。
   */
  CP.fitWeights = function (profile) {
    return CP.fitWeightsFor(profile);
  };

  CP.matchJobs = function (archive, score) {
    var interest = {}, ability = {};
    Object.keys(score.riasec.dims).forEach(function (k) { interest[k] = score.riasec.dims[k].score; });
    Object.keys(score.ability.dims).forEach(function (k) { ability[k] = score.ability.dims[k].score; });

    var FIT_W = CP.fitWeights(archive.profile);

    var f = CP.filterJobs(archive);
    var results = f.passed.map(function (job) {
      var i = CP.interestScore(interest, job);
      var a = CP.abilityScore(ability, job);
      var an = CP.anchorScore(score.anchorTop, job);
      var anchorVal = an.score === null ? 0 : an.score;

      var fit = FIT_W.interest * i.score + FIT_W.ability * a.score + FIT_W.anchor * anchorVal;
      // 贡献项 / 拖累项：都归一到 100，便于阅读比较
      var contribs = a.detail.map(function (d) {
        return { dim: d.dim, label: CP.abilityLabel(d.dim), value: d.contrib };
      }).sort(function (x, y) { return y.value - x.value; });
      var cTotal = contribs.reduce(function (s, x) { return s + x.value; }, 0) || 1;
      contribs.forEach(function (x) { x.pct = CP.round(x.value / cTotal * 100, 1); });

      var drags = a.detail.filter(function (d) { return d.gap > 0; })
        .map(function (d) {
          return {
            dim: d.dim, label: CP.abilityLabel(d.dim),
            req: d.req, got: d.got,
            gap: CP.round(d.gap, 1),        // 避免 6.700000000000003 这类浮点误差流到界面与报告
            severity: d.weight * Math.pow(d.gap / 100, 2)
          };
        }).sort(function (x, y) { return y.severity - x.severity; });
      var dTotal = drags.reduce(function (s, x) { return s + x.severity; }, 0) || 1;
      drags.forEach(function (x) { x.pct = CP.round(x.severity / dTotal * 100, 1); });
      return {
        jobId: job.id,
        name: job.name,
        family: job.family,
        summary: job.summary,
        // fit 保留 2 位小数仅用于排序，展示时再取整
        fit: fit,
        shown: Math.round(fit),
        parts: {
          interest: i.score,
          ability: a.score,
          anchor: an.score,
          interestWeight: FIT_W.interest,
          abilityWeight: FIT_W.ability,
          anchorWeight: FIT_W.anchor
        },
        detail: { interest: i.detail, ability: a.detail, anchor: an.detail },
        contributions: contribs.slice(0, 3),
        drags: drags.slice(0, 3),
        pref: archive.decision.jobPref[job.id] || 'unmarked',
        salaryBand: job.salaryBand,
        risks: job.risks,        minEdu: job.minEdu,
        employers: job.employers
      };
    });

    results.sort(function (x, y) {
      if (y.fit !== x.fit) return y.fit - x.fit;
      return x.jobId < y.jobId ? -1 : 1;
    });

    // 置信度：前两名分差
    var margin = results.length >= 2 ? CP.round(results[0].fit - results[1].fit, 1) : null;
    var ambiguous = margin !== null && margin < 5;

    return {
      ranked: results,
      top: results.slice(0, 3),
      backup: results.slice(3, 6),
      excluded: f.excluded,
      margin: margin,
      ambiguous: ambiguous,
      abilityMode: score.abilityMode || 'checklist',
      // 大一的特殊处理（差距排序、探索任务）按年级判断，不看量表类型
      isFreshman: !!(archive.profile && archive.profile.grade === '大一')
    };
  };

  CP.abilityLabel = function (dimId) {
    var b = CP.BANKS.ability;
    for (var i = 0; i < b.dimensions.length; i++) {
      if (b.dimensions[i].id === dimId) return b.dimensions[i].label;
    }
    return dimId;
  };

  CP.anchorLabel = function (anchorId) {
    var b = CP.BANKS.anchor;
    for (var i = 0; i < b.dimensions.length; i++) {
      if (b.dimensions[i].id === anchorId) return b.dimensions[i].label;
    }
    return anchorId;
  };

  /* ---------------- 路径决策 ---------------- */

  /**
   * 决策标准排序 → 权重（Σ=1）。
   * 已完整排序时按名次线性递减（第 1 位权重最大）；
   * 未排序时**退化为等权**——不能在用户尚未表达偏好时替他排出优先级。
   */
  CP.criteriaWeights = function (order) {
    var n = CP.CRITERIA.length;
    var w = {};
    var ranked = !!(order && order.length === n);
    var effective = ranked ? order : CP.CRITERIA.map(function (c) { return c.id; });
    effective.forEach(function (id, idx) {
      w[id] = ranked ? (n - idx) : 1;
    });
    var sum = 0;
    Object.keys(w).forEach(function (k) { sum += w[k]; });
    Object.keys(w).forEach(function (k) { w[k] = w[k] / sum; });
    return { weights: w, normalized: ranked };
  };

  CP.decidePaths = function (archive) {
    var cw = CP.criteriaWeights(archive.decision.criteriaOrder);
    var rows = CP.PATHS.map(function (p) {
      var detail = CP.CRITERIA.map(function (c) {
        var s = CP.pathScore(archive, p.id, c.id);        // 1-5
        var w = cw.weights[c.id];
        return { criterion: c.id, label: c.label, score: s, weight: CP.round(w * 100, 1), contrib: (s / 5) * 100 * w };
      });
      var total = detail.reduce(function (s, x) { return s + x.contrib; }, 0);
      var overrides = Object.keys(archive.decision.pathScores[p.id] || {}).length;
      return {
        pathId: p.id,
        name: p.name,
        summary: p.summary,
        risks: p.risks,
        relatedJobs: p.relatedJobs,
        milestones: p.milestones,
        total: CP.round(total, 1),
        shown: Math.round(total),
        editedByUser: overrides > 0,
        detail: detail
      };
    });

    rows.sort(function (a, b) {
      if (b.total !== a.total) return b.total - a.total;
      return a.pathId < b.pathId ? -1 : 1;
    });

    // 一致性提示：用户在最重要的标准上打分最高的路径，是否就是总分第一
    var topCriterion = CP.CRITERIA[0].id;
    if (cw.normalized && archive.decision.criteriaOrder.length) {
      topCriterion = archive.decision.criteriaOrder[0];
    }
    var bestOnTopCriterion = rows.slice().sort(function (a, b) {
      var av = a.detail.filter(function (d) { return d.criterion === topCriterion; })[0].score;
      var bv = b.detail.filter(function (d) { return d.criterion === topCriterion; })[0].score;
      return bv - av;
    })[0];

    return {
      weights: cw,
      ranked: rows,
      primary: rows[0] || null,
      planB: rows[1] || null,
      topCriterion: topCriterion,
      topCriterionLabel: (CP.CRITERIA.filter(function (c) { return c.id === topCriterion; })[0] || {}).label,
      consistent: !rows.length ? null : (rows[0].pathId === bestOnTopCriterion.pathId),
      bestOnTopCriterion: bestOnTopCriterion
    };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
