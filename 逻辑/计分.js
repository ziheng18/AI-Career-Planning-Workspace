/*!
 * 逻辑/计分.js — 第 0~1 层：归一化、维度得分、一致性检验
 *
 * 全部为纯函数，不接触 DOM、不读写 localStorage，可被 Node 直接测试。
 */
(function (root) {
  'use strict';
  var CP = (root.CP = root.CP || {});

  /**
   * 单题归一化 → 0-100
   *
   *   base = 量程的下限得分（默认 0）
   *   反向题：raw' = (max + min) - raw
   *   正向：  norm = base + (raw - min) / (max - min) × (100 - base)
   *
   * 为什么需要 base：大一的能力自评用「接触度」口径，最低档是
   * "完全没接触过"。把它记成 0 分等于说"没学过 = 没有潜力"，
   * 所以大一量程的 base = 15。高年级用经历深度口径，base = 0。
   *
   * @param {Object} item 题库条目（可含 reverse）
   * @param {number} raw 用户原始作答
   * @param {Object} scale { min, max, base? }
   */
  CP.normItem = function (item, raw, scale) {
    if (typeof raw !== 'number' || isNaN(raw)) return null;
    var base = scale.base == null ? 0 : scale.base;
    var v = raw;
    if (item && item.reverse) v = scale.max + scale.min - raw;
    var span = scale.max - scale.min;
    if (span <= 0) return null;
    return base + ((v - scale.min) / span) * (100 - base);
  };

  /** 均值；空数组返回 null。 */
  CP.mean = function (arr) {
    if (!arr || !arr.length) return null;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  };

  /** 总体标准差；少于 2 个样本返回 null。 */
  CP.std = function (arr) {
    if (!arr || arr.length < 2) return null;
    var m = CP.mean(arr), s = 0;
    for (var i = 0; i < arr.length; i++) s += (arr[i] - m) * (arr[i] - m);
    return Math.sqrt(s / arr.length);
  };

  /** 四舍五入到 n 位小数。 */
  CP.round = function (x, n) {
    if (x === null || x === undefined || isNaN(x)) return null;
    var f = Math.pow(10, n == null ? 1 : n);
    return Math.round(x * f) / f;
  };

  /**
   * 对一套题库计分。
   * @param {Object} bank  题库对象
   * @param {Object} answers { itemId: {v, t} }
   * @param {Object} profile 档案的 profile（决定能力自评用哪套年级口径）
   * @returns {Object} 维度得分、原始题目明细、整体完成度
   */
  CP.scoreBank = function (bank, answers, profile) {
    answers = answers || {};
    var items = CP.activeItems(bank, profile);
    var scale = CP.scaleOf(bank, profile);
    var out = {
      blockId: bank.id, dims: {}, items: [],
      answered: 0, total: items.length, completeness: 0,
      scaleType: scale.type, scaleLabels: scale.labels, base: scale.base == null ? 0 : scale.base
    };

    bank.dimensions.forEach(function (d) {
      out.dims[d.id] = { id: d.id, label: d.label, hint: d.hint, score: null, std: null, n: 0, expected: 0, items: [] };
    });

    items.forEach(function (it) {
      var rec = answers[it.id];
      var raw = rec && typeof rec.v === 'number' ? rec.v : null;
      var norm = CP.normItem(it, raw, scale);
      var d = out.dims[it.dim];
      if (!d) return;
      d.expected += 1;
      var detail = { id: it.id, dim: it.dim, text: it.text, reverse: !!it.reverse, raw: raw, norm: norm, t: rec ? rec.t : null };
      out.items.push(detail);
      d.items.push(detail);
      if (norm !== null) {
        d.n += 1;
        out.answered += 1;
      }
    });

    Object.keys(out.dims).forEach(function (k) {
      var d = out.dims[k];
      var vals = d.items.filter(function (x) { return x.norm !== null; }).map(function (x) { return x.norm; });
      d.score = CP.round(CP.mean(vals), 1);
      d.std = CP.round(CP.std(vals), 1);
      d.itemScores = vals;
    });

    out.completeness = out.total ? out.answered / out.total : 0;
    return out;
  };

  /* ============================================================
   * 能力清单：勾选式加权计分
   *
   * 与 Likert 的区别：
   *   · 每题只有"勾了 / 没勾"两种状态，权重写在题目上（难度递增）
   *   · 维度得分 = 已勾项的权重和 ÷ 全部项权重和 × 100
   *   · 没勾的项一律计 0——但两套清单的第 1 项门槛都刻意很低，
   *     所以正常填答的人不会真的落到 0 分
   * ============================================================ */

  /**
   * 对一个勾选式题库计分。
   * @param {Object} bank 题库
   * @param {Object} answers { itemId: {v: 1|undefined, t} }
   * @param {Object} profile
   */
  CP.scoreChecklist = function (bank, answers, profile) {
    answers = answers || {};
    var items = CP.activeItems(bank, profile);
    var out = {
      blockId: bank.id, dims: {}, items: [],
      answered: 0, total: items.length, completeness: 0,
      scaleType: 'checklist', mode: 'checklist'
    };

    bank.dimensions.forEach(function (d) {
      out.dims[d.id] = {
        id: d.id, label: d.label, hint: d.hint,
        score: null, checked: 0, expected: 0,
        weightChecked: 0, weightTotal: 0, items: []
      };
    });

    items.forEach(function (it) {
      var rec = answers[it.id];
      var checked = !!(rec && rec.v);
      var d = out.dims[it.dim];
      if (!d) return;
      var w = typeof it.weight === 'number' ? it.weight : 1;
      d.expected += 1;
      d.weightTotal += w;
      if (checked) { d.checked += 1; d.weightChecked += w; out.answered += 1; }
      var detail = { id: it.id, dim: it.dim, text: it.text, weight: w, checked: checked, raw: checked ? 1 : null, norm: checked ? 100 : 0, t: rec ? rec.t : null };
      out.items.push(detail);
      d.items.push(detail);
    });

    Object.keys(out.dims).forEach(function (k) {
      var d = out.dims[k];
      // 得分 = 已勾权重 / 全维权重；一题未答时为 null 而不是 0，避免"没答"被当成"零能力"
      d.score = d.weightTotal > 0 ? CP.round(d.weightChecked / d.weightTotal * 100, 1) : null;
      d.itemScores = d.items.filter(function (x) { return x.checked; }).map(function (x) { return x.weight; });
      d.std = null;   // 勾选式没有"题内方差"这个概念
    });

    out.completeness = out.total ? out.answered / out.total : 0;
    return out;
  };

  /**
   * 勾选式的作答质量检验（替代 Likert 的一致性检验）。
   *
   * 两类可疑模式：
   *   ① 全勾：8 维全勾满 —— 清单里包含"能带新人""能设计流程"这种明显的高阶项，
   *      正常学生不可能全部具备
   *   ② 只勾首项：每维都只勾第 1 项 —— 没有做任何区分，等于没认真看
   *
   * 另外检查阶梯逻辑：勾了第 N 项却没勾第 1 项，通常意味着没看清题目。
   */
  CP.checklistCheck = function (bank, scored, answers, profile) {
    var flags = [];
    var dims = bank.dimensions;
    var full = 0, onlyFirst = 0, totalChecked = 0, totalItems = 0;
    var gaps = [];

    dims.forEach(function (dim) {
      var d = scored.dims[dim.id];
      // 手写的测试 fixture 可能只有 score、没有 items/checked，这里要能容错
      if (!d || !d.expected || !d.items || !d.items.length) return;
      totalChecked += d.checked;
      totalItems += d.expected;
      if (d.checked === d.expected) full += 1;
      if (d.checked === 1 && d.items[0] && d.items[0].checked) onlyFirst += 1;
      // 阶梯检查：勾了后面的项但第 1 项没勾
      if (!d.items[0].checked && d.items.some(function (x, i) { return i > 0 && x.checked; })) {
        gaps.push(dim.label);
      }
    });

    if (full >= dims.length) {
      flags.push({
        dim: null, level: 'warn', message: '你把全部 ' + totalItems + ' 项都勾上了。'
          + '清单里包含"能带新人上手""能设计出比基线更好的方法"这类项——'
          + '如果确实都做到了，很好；如果只是顺手全勾，能力分会被显著高估，后面的差距任务也会落空。'
      });
    }
    if (onlyFirst >= dims.length) {
      flags.push({
        dim: null, level: 'warn', message: '你在每一维都只勾了第 1 项。'
          + '这说明清单没有起到区分作用，能力分全部落在最低档附近，结果会很粗糙。'
      });
    }
    if (gaps.length) {
      flags.push({
        dim: null, level: 'info', message: '这些维度里你勾了靠后的项、却没勾第 1 项：' + gaps.join('、')
          + '。清单是按由易到难排的，建议回头确认一下是不是漏看了第 1 项。'
      });
    }

    return flags;
  };

  /**
   * 一致性检验：识别"直线作答"（同维度内几乎不做区分）。
   * 规则：该维度题数 >= 5 且标准差 < 8 且已答满 → 标记低区分度。
   */
  CP.consistencyCheck = function (bank, scored, threshold) {
    var th = threshold == null ? 8 : threshold;
    var flags = [];
    bank.dimensions.forEach(function (dim) {
      var d = scored.dims[dim.id];
      if (!d || d.n < 5) return;
      if (d.n < d.expected) return;
      if (d.std !== null && d.std < th) {
        flags.push({
          dim: dim.id,
          label: dim.label,
          std: d.std,
          level: 'warn',
          message: '「' + dim.label + '」的 ' + d.n + ' 道题作答几乎完全一致（标准差 ' + d.std + '），区分度低，该维度结论需谨慎对待。'
        });
      }
    });
    return flags;
  };

  /**
   * 作答时长检验：识别疑似快速作答。
   * @param {Object} bank
   * @param {Object} answers
   * @param {number} minSecondsPerItem 每题最少合理秒数，默认 3 秒
   * @param {Object} profile 用于取年级口径
   */
  CP.timingCheck = function (bank, answers, minSecondsPerItem, profile) {
    var minS = (minSecondsPerItem == null ? 3 : minSecondsPerItem);
    var times = [];
    CP.activeItems(bank, profile).forEach(function (it) {
      var rec = answers[it.id];
      if (rec && typeof rec.t === 'number') times.push(rec.t);
    });
    if (times.length < 5) return { ok: true, secondsPerItem: null, message: null };
    times.sort(function (a, b) { return a - b; });
    var spanMs = times[times.length - 1] - times[0];
    var perItem = spanMs / 1000 / times.length;
    if (perItem < minS) {
      return {
        ok: false,
        secondsPerItem: CP.round(perItem, 1),
        message: '本块平均每题仅 ' + CP.round(perItem, 1) + ' 秒，明显偏快，结果可能不能反映真实情况，建议复核。'
      };
    }
    return { ok: true, secondsPerItem: CP.round(perItem, 1), message: null };
  };

  /**
   * 霍兰德三字母代码：取兴趣得分最高的三个维度。
   */
  CP.hollandCode = function (scored) {
    var arr = Object.keys(scored.dims).map(function (k) {
      return { id: k, label: scored.dims[k].label, score: scored.dims[k].score };
    }).filter(function (x) { return x.score !== null; });
    arr.sort(function (a, b) { return b.score - a.score; });
    return {
      code: arr.slice(0, 3).map(function (x) { return x.id; }).join(''),
      top: arr.slice(0, 3),
      all: arr
    };
  };

  /**
   * 职业锚：主锚 + 副锚。主副分差 < 0.3（归一化后 < 6 分）时标记为双锚。
   */
  CP.dominantAnchor = function (scored, dualGap) {
    var gap = dualGap == null ? 6 : dualGap;
    var arr = Object.keys(scored.dims).map(function (k) {
      return { id: k, label: scored.dims[k].label, score: scored.dims[k].score };
    }).filter(function (x) { return x.score !== null; });
    arr.sort(function (a, b) { return b.score - a.score; });
    if (!arr.length) return { primary: null, secondary: null, isDual: false, all: [] };
    var isDual = arr.length > 1 && (arr[0].score - arr[1].score) < gap;
    return { primary: arr[0], secondary: arr.length > 1 ? arr[1] : null, isDual: isDual, all: arr };
  };

  /**
   * 生成"一句话画像"。
   */
  CP.oneLiner = function (score) {
    var parts = [];
    if (score.holland && score.holland.code) parts.push(score.holland.code);
    if (score.anchor && score.anchor.primary) parts.push(score.anchor.primary.label);
    var a = score.ability;
    if (a) {
      var sorted = Object.keys(a.dims).map(function (k) {
        return { id: k, label: a.dims[k].label, score: a.dims[k].score };
      }).filter(function (x) { return x.score !== null; });
      sorted.sort(function (x, y) { return y.score - x.score; });
      if (sorted.length >= 2) {
        parts.push('强项：' + sorted[0].label + ' / ' + sorted[1].label);
        parts.push('弱项：' + sorted[sorted.length - 1].label);
      }
    }
    return parts.join(' · ');
  };

  /**
   * 汇总所有测评的得分。这是结果页与匹配层的唯一输入。
   * @param {Object} archive
   */
  CP.scoreAll = function (archive) {
    var banks = CP.BANKS;
    var profile = archive.profile;
    var riasec = CP.scoreBank(banks.riasec, archive.answers.riasec, profile);
    var anchor = CP.scoreBank(banks.anchor, archive.answers.anchor, profile);
    var ability = CP.scoreChecklist(banks.ability, archive.answers.ability, profile);

    var score = {
      riasec: riasec,
      anchor: anchor,
      ability: ability,
      holland: CP.hollandCode(riasec),
      anchorTop: CP.dominantAnchor(anchor),
      profile: profile,
      // 能力用勾选式清单；年级只决定出哪一套清单，口径本身是统一的
      abilityMode: 'checklist',
      abilityGrade: (profile && profile.grade === '大一') ? 'fresh' : 'senior',
      flags: [],
      timing: {}
    };

    // 兴趣与职业锚仍用 Likert 的一致性检验
    ['riasec', 'anchor'].forEach(function (k) {
      CP.consistencyCheck(banks[k], score[k]).forEach(function (f) {
        score.flags.push({ block: k, dim: f.dim, label: f.label, std: f.std, message: f.message });
      });
    });
    // 能力清单用勾选模式检验
    CP.checklistCheck(banks.ability, score.ability, archive.answers.ability, profile).forEach(function (f) {
      score.flags.push({ block: 'ability', dim: f.dim, label: '能力清单', level: f.level, message: f.message });
    });

    ['riasec', 'anchor', 'ability'].forEach(function (k) {
      var t = CP.timingCheck(banks[k], archive.answers[k], null, profile);
      score.timing[k] = t;
      if (!t.ok) score.flags.push({ block: k, dim: null, label: banks[k].title, message: t.message });
    });

    score.oneLiner = CP.oneLiner(score);
    return score;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
