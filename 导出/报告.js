/*!
 * 导出/报告.js — 档案 JSON、Markdown 报告、可打印视图
 */
(function (root) {
  'use strict';
  var CP = (root.CP = root.CP || {});
  CP.report = {};

  function fmt(n, d) { return CP.fmt(n, d); }
  function esc(s) { return CP.esc(s); }
  function pad(s, w) { s = String(s); while (s.length < w) s += ' '; return s; }

  /* ============================================================
   * 文案库：把"拼数值"换成"拼句子"
   *
   * 报告的价值不在于把测评分数再念一遍，而在于把分数翻译成一句人能读进去的判断。
   * 所以这里预先写好带条件分支的句子模板，导出时按档案数据选择并填空。
   * ============================================================ */

  /** 每个维度的中文解释，用于把"分数"翻译成"意思" */
  var DIM_MEANING = {
    R: '动手把东西做出来',
    I: '分析问题、弄清原理',
    A: '创造与表达',
    S: '与人协作、帮到别人',
    E: '推动事情、影响他人',
    C: '把细节和规范做扎实'
  };
  var ANCHOR_MEANING = {
    TF: '在专业上做到精深，不一定要管人',
    GM: '承担更大责任，管人管事',
    AU: '自己说了算，不被规则绑住',
    SE: '要清晰可预期的路径与保障',
    EC: '想做属于自己的东西',
    SV: '工作要对人、对社会有用',
    CH: '享受攻克别人搞不定的难题',
    LS: '工作要能配合生活，而不是相反'
  };
  var ABILITY_MEANING = {
    math: '数学与理论', code: '编程工程', data: '数据与实验', model: '算法建模',
    deploy: '系统与部署', product: '产品与业务', comm: '沟通表达协作', self: '自主学习与抗压'
  };

  /** 按分数段取一句判断语 */
  function band(score, bands) {
    if (score == null) return bands.na || '';
    for (var i = 0; i < bands.length; i++) {
      if (score >= bands[i][0]) return bands[i][1];
    }
    return bands[bands.length - 1][1];
  }

  /**
   * 取一段预先写好的总结性文字。
   * @param {string} key 模板名
   * @param {Object} ctx { a: 档案, res: 结果, s: score }
   */
  CP.report.textFor = function (key, ctx) {
    var a = ctx.a || CP.ui.archive;
    var res = ctx.res;
    var s = ctx.s || (res ? res.score : null);
    var T = {

      profileNote: function () {
        var fresh = a.profile.grade === '大一';
        return '本人现为' + (a.profile.grade || '（未填写年级）') + '学生，专业方向为' + (a.profile.track || '（未填写）') + '。'
          + '关于升学，本人的态度是' + (a.profile.acceptPostgrad || '尚未确定') + '。'
          + (fresh
            ? '作为一名大一学生，距离求职还有约三年时间，因此本报告的重点不是"现在能匹配什么岗位"，而是"顺着兴趣把方向定下来"。'
            : '本科阶段剩余时间相对有限，因此本报告的重点是"在现有基础上把最关键的短板补上"。')
          + '以上信息不参与适配度打分，仅用于筛选门槛与作答口径。';
      },

      interest: function () {
        if (!s || !s.holland || !s.holland.code) return '兴趣测评尚未完成。';
        var top = s.holland.top.slice(0, 3);
        var hi = top[0], lo = s.holland.all[s.holland.all.length - 1];
        var txt = '兴趣测评的结果是 ' + s.holland.code + '。'
          + '其中最强的是「' + hi.label + '」——' + (DIM_MEANING[hi.id] || '') + '这类事最容易让我投入；'
          + '其次是「' + top[1].label + '」与「' + top[2].label + '」。'
          + '相对最弱的是「' + lo.label + '」，' + (DIM_MEANING[lo.id] || '') + '对我来说吸引力有限。';
        var gap = top[0].score - top[2].score;
        if (gap < 6) {
          txt += '三项得分非常接近，说明我的兴趣面比较宽、暂时没有明显偏向，这在大一、大二阶段是正常的，'
            + '但也意味着我需要通过实际动手（而不是继续做测评）来把方向收窄。';
        } else if (gap > 25) {
          txt += '兴趣相当集中，这有利于尽早聚焦，但也要注意不要因此排除掉其他可能性——'
            + '兴趣的稳定性会随经历变化。';
        } else {
          txt += '兴趣有一定倾向但不极端，属于可以"先按首选方向走、同时保留备选"的状态。';
        }
        return txt;
      },

      freshInterest: function () {
        return '本次能力部分用的是大一版行为清单，勾得少通常只代表我还没学到。'
          + '在这次匹配里兴趣的权重为 65%。';
      },

      anchor: function () {
        if (!s || !s.anchorTop || !s.anchorTop.primary) return '职业锚测评尚未完成。';
        var p = s.anchorTop.primary, sec = s.anchorTop.secondary;
        var txt = '职业锚测评显示，我最不能放弃的是「' + p.label + '」，即' + (ANCHOR_MEANING[p.id] || '') + '。'
          + '这一点解释了我为什么会对某些工作机会感到抗拒——即使待遇更好。';
        if (s.anchorTop.isDual && sec) {
          txt += '同时，「' + sec.label + '」的分数与它非常接近，属于双锚型：'
            + '我有两类诉求需要同时被满足（' + (ANCHOR_MEANING[p.id] || '') + '；' + (ANCHOR_MEANING[sec.id] || '') + '）。'
            + '选工作时如果只能满足其中一个，我大概率会在一两年内感到不痛快，这一点必须提前纳入判断。';
        } else if (sec) {
          txt += '次要诉求是「' + sec.label + '」，可以作为选工作时的加分项，但不是决定项。';
        }
        return txt;
      },

      ability: function () {
        if (!s || !s.ability) return '能力清单尚未完成。';
        var rows = Object.keys(s.ability.dims).map(function (k) {
          return { id: k, label: s.ability.dims[k].label, score: s.ability.dims[k].score };
        }).filter(function (x) { return x.score !== null; }).sort(function (x, y) { return y.score - x.score; });
        if (!rows.length) return '能力清单尚未完成。';
        var top2 = rows.slice(0, 2), bottom2 = rows.slice(-2);
        if (s.abilityGrade === 'fresh') {
          return '大一版清单的勾选结果是：勾得最多的是「' + top2[0].label + '」（' + fmt(top2[0].score, 0) + ' 分）'
            + '与「' + top2[1].label + '」（' + fmt(top2[1].score, 0) + ' 分）；'
            + '几乎没勾上的是「' + bottom2[1].label + '」与「' + bottom2[0].label + '」。'
            + '这份数据反映的是我上过什么课、跟做过什么。';
        }
        return '行为清单的勾选结果是：勾得最多的是「' + top2[0].label + '」（' + fmt(top2[0].score, 0) + ' 分）'
          + '与「' + top2[1].label + '」（' + fmt(top2[1].score, 0) + ' 分）；'
          + '还有较多项没勾上的是「' + bottom2[1].label + '」（' + fmt(bottom2[1].score, 0) + ' 分）'
          + '与「' + bottom2[0].label + '」（' + fmt(bottom2[0].score, 0) + ' 分）。'
          + '这些没勾上的项可以直接当作待办清单用。';
      },

      quality: function () {
        var n = s.flags.length;
        var hasDim = s.flags.some(function (f) { return f.dim; });
        var hasTime = s.flags.some(function (f) { return !f.dim; });
        var txt = '系统在本次数据中发现了 ' + n + ' 处需要说明的地方。';
        if (hasDim) txt += '其中一部分是"某个维度的题目作答过于一致"，这通常意味着我在快速勾选，或对该维度的问题没有真正区分。';
        if (hasTime) txt += '另一部分是"作答速度偏快"，可能说明我在赶时间。';
        txt += '这不代表结果无效，但说明某些结论的可信度较低。下面的解读请结合自身情况判断；'
          + '如果确实存在敷衍作答，建议重做相应部分。';
        return txt;
      },

      matchText: function () {
        var m = res.match;
        if (!m.ranked.length) return '所有岗位都被筛选条件排除了，请回到"决策输入"放宽条件。';
        var t1 = m.ranked[0], t2 = m.ranked[1];
        var txt = '按兴趣、能力与职业锚加权计算，与我最契合的岗位是「' + t1.name + '」。'
          + '从分项看，兴趣匹配 ' + fmt(t1.parts.interest, 0) + ' 分、能力适配 ' + fmt(t1.parts.ability, 0) + ' 分'
          + (t1.parts.anchor === null ? '' : '、职业锚对齐 ' + fmt(t1.parts.anchor, 0) + ' 分') + '。';
        var contrib = t1.contributions.slice(0, 2).map(function (c) { return c.label; }).join('与');
        if (contrib) txt += '其中贡献最大的是' + contrib + '。';
        if (t1.drags.length) {
          txt += '主要拖累项是' + t1.drags.slice(0, 2).map(function (d) {
            return d.label + '（差 ' + fmt(d.gap, 1) + ' 分）';
          }).join('、') + '。';
        }
        if (m.ambiguous && t2) {
          txt += '需要强调：第二名「' + t2.name + '」与我仅相差 ' + m.margin + ' 分。'
            + '这说明我的优势还不够聚焦，第 1 名和第 2 名之间并没有本质差别——'
            + '请结合自己的偏好来决定，不要因为排序就认定必须选第一个。';
        } else if (t2) {
          txt += '第二名是「' + t2.name + '」（' + t2.shown + ' 分），与第一名有一定差距，说明我的倾向相对清晰。';
        }
        return txt;
      },

      gapText: function () {
        var t = res.match.ranked[0];
        if (!t) return '';
        var d = t.drags[0];
        if (!d) return '我在这份岗位要求的所有能力维度上都已经达到或超过要求，接下来的重点是把已有能力做成作品。';
        if (s.abilityGrade === 'fresh') {
          return '差距最大的是「' + d.label + '」（差 ' + fmt(d.gap, 1) + ' 分）。但请把它理解为"进度差"而不是"能力差"——'
            + '大一阶段几乎所有维度都会显示差距，这本身不构成问题。真正需要我回答的是：'
            + '在我的兴趣方向上，哪些基础是必须尽早开始的，哪些可以等到开课后再说。';
        }
        return '差距最大的是「' + d.label + '」（差 ' + fmt(d.gap, 1) + ' 分）。'
          + '测评对能力的处理方式是只惩罚不足、不奖励过剩：某项能力远超岗位要求并不会提高适配度。'
          + '这也是为什么"什么都会一点"不如"有一项过硬"。';
      },

      excludeText: function () {
        var ex = res.match.excluded;
        if (!ex.length) return '本次没有被排除的岗位。';
        var byEdu = ex.filter(function (e) { return e.reasons.join('').indexOf('门槛') >= 0; });
        var byMe = ex.filter(function (e) { return e.reasons.join('').indexOf('排除') >= 0; });
        var txt = '';
        if (byEdu.length) {
          txt += '因学历门槛被排除的有：' + byEdu.map(function (e) { return e.job.name; }).join('、') + '。'
            + '排除依据是我填写的"是否接受读研"。需要说明的是，这是门槛判断而不是能力判断——'
            + '如果我的升学计划改变，这些岗位会重新进入候选范围。';
        }
        if (byMe.length) {
          txt += (txt ? '' : '') + '由我本人明确排除的有：' + byMe.map(function (e) { return e.job.name; }).join('、') + '。';
        }
        return txt;
      },

      /** 针对某个岗位的工作内容分配，给一句"最容易误解的地方" */
      digestHint: function () {
        var j = ctx.job;
        var mix = j.workMix || {};
        var code = mix.code || 0;
        var nonCode = CP.report.nonCodePct(j);
        if (code < 25) {
          return '这说明它并不是一个"以写代码为主"的岗位——如果你的预期是整天做技术，需要重新评估。';
        }
        if (nonCode >= 40) {
          return '也就是说，有约 ' + nonCode + '% 的时间不在写代码上。很多人入职后最大的落差就来自这一点。';
        }
        if (code >= 60) {
          return '这是一个技术占比很高的岗位，适合愿意长期沉浸在代码与系统里的人；'
            + '相应地，表达与业务理解占比低，如果我很在意"跟人打交道"，可能会觉得闷。';
        }
        return '技术与其他事务大致各占一半，需要既能动手、也能沟通。';
      },

      decisionText: function () {
        var order = a.decision.criteriaOrder || [];
        if (order.length !== CP.CRITERIA.length) return '尚未完成决策标准排序，因此路径得分使用等权计算，仅供参考。';
        var label = function (id) { return (CP.CRITERIA.filter(function (c) { return c.id === id; })[0] || {}).label || id; };
        var w = res.decision.weights.weights;
        var txt = '我最看重的三项依次是「' + label(order[0]) + '」「' + label(order[1]) + '」「' + label(order[2]) + '」，'
          + '对应的权重分别是 ' + fmt(w[order[0]] * 100, 0) + '%、' + fmt(w[order[1]] * 100, 0) + '%、' + fmt(w[order[2]] * 100, 0) + '%。'
          + '最不看重的是「' + label(order[5]) + '」（' + fmt(w[order[5]] * 100, 0) + '%）。';
        if (res.decision.consistent === true) {
          txt += '一致性检查通过：我在最重要标准上打分最高的路径，正是加权总分第一的路径，说明我的权重设置与真实偏好是一致的。';
        } else if (res.decision.consistent === false) {
          txt += '但一致性检查给出了提醒：我在最重要的标准「' + res.decision.topCriterionLabel + '」上打分最高的路径是「'
            + res.decision.bestOnTopCriterion.name + '」，它却不是总分第一。'
            + '这通常意味着其他标准把我的选择拉向了别处，我需要在两条路之间想清楚到底是哪一项在起作用。';
        }
        return txt;
      },

      pathText: function () {
        var d = res.decision;
        if (!d.primary) return '尚未生成路径结果。';
        var txt = '主路径是「' + d.primary.name + '」（加权得分 ' + d.primary.shown + ' 分）。' + d.primary.summary
          + '这条路的风险是：' + d.primary.risks;
        if (d.planB) {
          txt += '备选方案（Plan B）是「' + d.planB.name + '」（' + d.planB.shown + ' 分）：' + d.planB.summary
            + 'Plan B 的作用不是"退而求其次"，而是当主路径出现明确受阻信号（例如关键绩点未达线、目标岗位缩招）时，'
            + '我能立刻切换而不是重新开始。';
        }
        var edited = d.ranked.filter(function (r) { return r.editedByUser; }).length;
        txt += edited > 0
          ? '本次我修改过 ' + edited + ' 条路径的评分，结果较多地体现了自己的判断。'
          : '本次路径评分全部使用系统预填的参考值。这意味着最终排序主要反映的是参考设定，而不是我自己的偏好——'
            + '建议至少认真修改其中几项，再回来看结论是否变化。';
        return txt;
      },

      skillIntro: function () {
        if (s.abilityGrade === 'fresh') {
          return '作为大一，我距离求职还有约三年。这次先做一次小的方向验证，'
            + '再按与兴趣方向的贴合度排列后续任务。';
        }
        return '下面按缺口的严重程度排列学习任务。每一条都配有可检查的验收作品——'
          + '没有作品的任务等于没有任务。';
      },

      // 访谈已于 v0.2 移除，此模板保留为空壳以防旧代码引用
      interviewText: function () {
        return '';
      },

      actionText: function () {
        var acts = a.actions || [];
        if (!acts.length) return '尚未生成行动计划。没有行动计划的规划只是一份阅读材料。';
        var done = acts.filter(function (x) { return x.status === 'done'; }).length;
        var doing = acts.filter(function (x) { return x.status === 'doing'; }).length;
        var todo = acts.length - done - doing;
        var today = CP.dateOnly();
        var overdue = acts.filter(function (x) { return x.status !== 'done' && x.due && x.due < today; }).length;
        var txt = '计划共 ' + acts.length + ' 条任务，其中已完成 ' + done + ' 条、进行中 ' + doing + ' 条、待开始 ' + todo + ' 条，'
          + '完成率约 ' + Math.round(done / acts.length * 100) + '%。';
        if (overdue > 0) {
          txt += '有 ' + overdue + ' 条已逾期未完成。逾期本身不是问题，问题在于是否被发现并及时重排——'
            + '如果逾期项持续累积而不调整，整个计划会在一两个月内失去约束力。';
        } else {
          txt += '目前没有逾期项。';
        }
        if (done === 0) {
          txt += '需要提醒的是：所有任务都还停留在"待做"，说明这份计划尚未经过现实检验，'
            + '它的可行性仍然是未经证实的假设。';
        }
        return txt;
      },

      reviewText: function () {
        var rs = a.reviews || [];
        if (!rs.length) return '';
        var last = rs[rs.length - 1];
        var rate = (last.planned && last.done != null) ? Math.round(last.done / last.planned * 100) : null;
        if (rate === null) return '';
        var txt = '最近一次复盘的计划完成率为 ' + rate + '%，逾期 ' + (last.overdue == null ? '未记录' : last.overdue + ' 条') + '。';
        if (rate >= 90) txt += '这说明我的计划定得比较保守但可执行，下一步可以适当提高任务量。';
        else if (rate >= 60) txt += '这个比例属于正常区间，说明计划基本可行，个别任务需要拆小。';
        else txt += '完成率偏低，通常不是执行力问题，而是任务定得太大或没有拆到"当天能开始做"的粒度——建议下一轮把任务拆小。';
        return txt;
      }
    };

    var fn = T[key];
    if (typeof fn !== 'function') return '';
    try {
      return fn();
    } catch (e) {
      return '';
    }
  };

  /** 摘要段落：报告开头那几句话，由上面的模板拼装 */
  CP.report.summaryParagraphs = function (a, res) {
    var s = res.score;
    var out = [];
    out.push(CP.report.textFor('interest', { a: a, res: res, s: s }));
    out.push(CP.report.textFor('anchor', { a: a, res: res, s: s }));
    if (res.match.ranked[0]) {
      var t1 = res.match.ranked[0];
      out.push('综合适配度最高的是「' + t1.name + '」，'
        + (res.match.ambiguous
          ? '但与第二名差距很小（仅 ' + res.match.margin + ' 分），因此这个排名只能作为参考，最终还是要靠我自己判断。'
          : '比第二名高 ' + res.match.margin + ' 分，倾向相对清晰。'));
    }
    if (res.decision.primary) {
      out.push('在生涯路径上，加权得分最高的是「' + res.decision.primary.name + '」，'
        + '备选方案是「' + (res.decision.planB ? res.decision.planB.name : '—') + '」。'
        + (res.decision.consistent === false
          ? '这里有一处需要我自己回答的矛盾：我在最重要的标准上最认可的并不是总分第一的那条路。'
          : ''));
    }
    var gapTxt = res.gaps.filter(function (g) { return g.dim !== '_explore'; }).slice(0, 3)
      .map(function (g) { return g.label; }).join('、');
    if (gapTxt) {
      out.push(s.abilityGrade === 'fresh'
        ? '需要尽早开始接触的是' + gapTxt + '。对大一来说，这不是"补短板"，而是"提前拿到入场券"。'
        : '最需要投入的三项能力是' + gapTxt + '。');
    }
    return out;
  };

  /* ---------------- 档案 JSON ---------------- */

  CP.report.saveArchive = function () {
    var a = CP.ui.archive;
    if (!a.computed) a.computed = CP.buildResult(a);
    CP.store.save(a);
    CP.file.download('职业生涯规划档案-' + CP.file.stamp() + '.json', JSON.stringify(a, null, 2), 'application/json');
    CP.ui.toast('档案已导出，可用于备份或交给老师核查');
  };

  /* ---------------- Markdown 报告 ---------------- */

  CP.report.toMarkdown = function () {
    var a = CP.ui.archive;
    var res = CP.ui.result();
    var s = res.score;
    var L = [];
    function h(n, t) { L.push(''); L.push(new Array(n + 1).join('#') + ' ' + t); L.push(''); }
    function p(t) { L.push(t); L.push(''); }
    function table(head, rows) {
      L.push('| ' + head.join(' | ') + ' |');
      L.push('|' + head.map(function () { return ' --- '; }).join('|') + '|');
      rows.forEach(function (r) { L.push('| ' + r.join(' | ') + ' |'); });
      L.push('');
    }

    // 封面
    L.push('# 人工智能专业职业生涯规划报告');
    L.push('');
    p('**专业方向：**' + (a.profile.track || '—') + '　　**年级：**' + (a.profile.grade || '—')
      + '　　**生成时间：**' + new Date().toLocaleString('zh-CN'));
    p('本报告由「AI 职业生涯规划学习实践工作台」依据本人填写的测评数据生成，'
      + '正文只写结论与依据，逐题原始数据见另行导出的数据文件。');

    /* ---------- 摘要 ---------- */
    h(1, '摘要');
    CP.report.summaryParagraphs(a, res).forEach(function (t) { p(t); });

    /* ---------- 第一章 ---------- */
    h(1, '第一章　自我认知');
    h(2, '1.1 基本情况');
    table(['项目', '内容'], [
      ['年级', a.profile.grade || '—'],
      ['专业方向', a.profile.track || '—'],
      ['GPA 档位', a.profile.gpaBand || '（大一通常尚未评定）'],
      ['是否接受读研', a.profile.acceptPostgrad || '—'],
      ['每周可投入学习时长', (a.decision.hoursPerWeek == null ? '—' : a.decision.hoursPerWeek) + ' 小时'],
      ['期望工作城市', (a.decision.targetCities || []).join('、') || '未指定']
    ]);

    h(2, '1.2 职业兴趣');
    p(CP.report.textFor('interest', { s: s }));
    if (s.abilityGrade === 'fresh') p(CP.report.textFor('freshInterest', { s: s }));

    h(2, '1.3 职业锚（价值取向）');
    p(CP.report.textFor('anchor', { s: s }));

    h(2, '1.4 能力现状');
    p(CP.report.textFor('ability', { s: s }));
    var evTxt = CP.report.evidenceText(a, s);
    if (evTxt) p(evTxt);

    if (s.flags.length) {
      h(2, '1.5 数据质量提示');
      p(CP.report.textFor('quality', { s: s }));
      s.flags.forEach(function (f) { p('- ' + f.message); });
    }

    /* ---------- 第二章 ---------- */
    h(1, '第二章　职业与行业认知');
    p(CP.report.textFor('matchText', { a: a, res: res, s: s }));

    // 职业简表：简要介绍排名较高的几个职业
    if (res.match.top.length) {
      h(2, '2.1 排名较高的职业简表');
      p('下表按适配度排序，列出排在前面几个职业的日常职责、工作内容时间分配、典型雇主、'
        + '参考薪资与主要风险。其中"一周工作内容占比"一栏值得特别留意——'
        + '很多人对某个岗位的想象与实际工作内容差距极大。');
      table(CP.report.jobDigestHead(), CP.report.jobDigestRows(res.match.top));

      // 逐岗位点出"最容易误解的地方"
      res.match.top.forEach(function (r) {
        var j = CP.getJob(r.jobId);
        if (!j.workMix) return;
        p('**' + r.name + '**：时间主要花在 ' + CP.report.workMixTopText(j) + ' 上，'
          + '完整分配为 ' + CP.report.workMixText(j) + '。'
          + CP.report.textFor('digestHint', { job: j }));
      });
    }

    var topJob = res.match.ranked[0];
    if (topJob) {
      var jd = CP.getJob(topJob.jobId);
      h(2, '2.2 首位岗位展开：' + topJob.name);
      p(topJob.summary);
      p('**主要职责**');
      jd.duties.forEach(function (d) { p('- ' + d); });
      p('**一周工作内容占比**：' + CP.report.workMixText(jd) + '。');
      p('**典型雇主**：' + jd.employers.join('；'));
      p('**参考薪资**：' + jd.salaryBand + '（示例数据，非实时行情）');
      p('**这个岗位的风险**：' + jd.risks);
      p(CP.report.textFor('gapText', { res: res, s: s }));
    }

    h(2, '2.3 被排除的岗位');
    p(CP.report.textFor('excludeText', { res: res }));

    /* ---------- 第三章 ---------- */
    h(1, '第三章　目标决策与路径设计');
    h(2, '3.1 我最看重什么');
    p(CP.report.textFor('decisionText', { a: a, res: res }));

    h(2, '3.2 主路径与备选');
    p(CP.report.textFor('pathText', { a: a, res: res }));

    if (res.decision.primary && res.decision.primary.milestones) {
      h(2, '3.3 阶段性目标');
      p('沿主路径「' + res.decision.primary.name + '」推进，分阶段目标是：');
      table(['时间阶段', '目标'],
        [['本学期', (res.decision.primary.milestones.term || []).join('；')],
         ['1 年内', (res.decision.primary.milestones.oneYear || []).join('；')],
         ['3 年内', (res.decision.primary.milestones.threeYear || []).join('；')],
         ['5 年内', (res.decision.primary.milestones.fiveYear || []).join('；')]]);
    }

    if (res.decision.consistent === false) {
      p('> **需要我自己回答的一个问题：**我在最重要的标准「' + res.decision.topCriterionLabel + '」上打分最高的路径是「'
        + res.decision.bestOnTopCriterion.name + '」，但它并不是加权总分第一。'
        + '这说明其他标准把我的选择拉向了别处——两条路都值得认真对待，我需要想清楚到底是哪一项在起作用。');
    }

    /* ---------- 第四章 ---------- */
    h(1, '第四章　能力锻造');
    h(2, '4.1 从哪里开始补');
    p(CP.report.textFor('skillIntro', { a: a, res: res }));
    if (res.gaps.length) {
      res.gaps.forEach(function (g, i) {
        var isExplore = g.dim === '_explore';
        h(3, (isExplore ? '第一步：' : '第 ' + i + ' 项：') + g.label);
        p(isExplore
          ? '先按兴趣方向做一次能演示的小项目。'
          : '排序依据：' + g.basis + '。');
        p('**要做的事**');
        g.tasks.forEach(function (t) { p('- ' + t); });
        p('**做完要交出什么（没有作品就不算完成）**');
        g.deliverables.forEach(function (t) { p('- ' + t); });
        p('参考资源：' + (g.resources || []).join('、') + '。');
      });
    } else {
      p('当前目标岗位没有明显的能力缺口，可以把精力放在把已有能力做成作品上。');
    }

    h(2, '4.2 岗位认知核对');
    if (res.match.ranked[0]) {
      var tj = CP.getJob(res.match.ranked[0].jobId);
      p('上面的学习任务都指向「' + res.match.ranked[0].name + '」。在投入之前，值得先核对一次这份工作的日常：'
        + '时间主要花在 ' + CP.report.workMixTopText(tj) + ' 上，完整分配为 '
        + CP.report.workMixText(tj) + '。');
      p('如果这些事我一件都不想长期做，那么即使适配度分数高，也应该回到第三章重新考虑路径——'
        + '**测评算的是匹配度，不能代替"我愿不愿意做"这个判断。**');
      p('（若有机会向从事该岗位的人求证，会比任何数据都准确。）');
    }

    /* ---------- 第五章 ---------- */
    h(1, '第五章　行动计划');
    h(2, '5.1 执行情况');
    p(CP.report.textFor('actionText', { a: a }));

    h(2, '5.2 任务清单');
    if ((a.actions || []).length) {
      table(['任务', '截止日期', '状态', '来源'],
        a.actions.map(function (x) {
          return [x.title, x.due || '—',
            x.status === 'done' ? '已完成' : (x.status === 'doing' ? '进行中' : '待做'),
            x.fromGap ? CP.abilityLabel(x.fromGap) : (x.note || '').indexOf('主路径') >= 0 ? '路径里程碑' : '—'];
        }));
    } else {
      p('尚未生成行动计划。请在「行动计划」页点击"按测评结果生成行动计划草案"。');
    }

    // 逐年规划建议：锚到具体学年，放在任务清单之后、复盘之前
    var planRows = CP.yearPlan(a, res.decision, res.match);
    if (planRows.length) {
      h(2, '5.3 逐年规划建议');
      p('按主路径「' + (res.decision.primary ? res.decision.primary.name : '—')
        + '」，从当前年级「' + (a.profile.grade || '—') + '」起算的阶段安排：');
      planRows.forEach(function (r) {
        p('- **' + r.year + '**：' + r.action + '　（' + r.note + '）');
      });
    }

    h(2, '5.4 复盘记录');
    if ((a.reviews || []).length) {
      table(['日期', '类型', '计划', '完成', '完成率', '逾期', '本期新增证据', '下周最高优先级'],
        a.reviews.map(function (r) {
          var rate = (r.planned && r.done != null) ? Math.round(r.done / r.planned * 100) + '%' : '—';
          return [r.date, r.type, r.planned == null ? '—' : r.planned, r.done == null ? '—' : r.done,
            rate, r.overdue == null ? '—' : r.overdue, r.evidence || '—', r.next || '—'];
        }));
      p(CP.report.textFor('reviewText', { a: a }));
    } else {
      p('尚无复盘记录。计划类任务最容易在"没有记录"的情况下悄悄停摆。');
    }
    h(2, '5.5 SWOT 分析（初稿，需本人修订）');
    table(['S 优势', 'W 待补', 'O 机会', 'T 威胁'], [
      [res.swot.strengths.join('<br>'), res.swot.weaknesses.join('<br>'),
       res.swot.opportunities.join('<br>'), res.swot.threats.join('<br>')]
    ]);
    p('> SWOT 中的内容由测评数据半自动生成，属于"素材"。请用自己的语言重新组织并补充课堂讨论、'
      + '师友反馈与个人感受后再提交——那个版本才是你自己的规划。');

    /* ---------- 附录 ----------
     * 只留"方法与来源"。
     * 刻意不放的东西（都属于过程性数据，读者不需要看）：
     *   · 逐题作答与得分 —— 已在 原始作答明细.csv 里
     *   · 各岗位适配度的分项拆解 —— 已在 维度与适配度.csv 里
     *   · 门槛筛选规则、置信度阈值、一致性检验 —— 那是工具的说明书，不是本人的规划
     *   · 任务工时与周数的推算过程 —— 内部排期参数
     */
    h(1, '附录　方法与来源');
    p('本报告的全部结论均由「AI 职业生涯规划学习实践工作台」依据本人填写的作答计算得出。计算口径如下，供必要时核对：');
    p('```');
    p('归一化：1-5 量表 norm = (raw − 1) / 4 × 100');
    p('        反向题先取 raw\' = 6 − raw；维度得分取均值');
    p('能力清单（勾选式）：维度得分 = 100 × Σ(已勾项权重) / Σ(全维权重)');
    p('        每维 6 项，按由易到难排列，权重递增（大二及以上 12/15/17/18/19/19；大一 14/15/16/17/19/19，合计 100）');
    p('        未勾的项计 0 分；不单独计算维度内标准差——勾选式没有"题内方差"这个概念');
    if (s.abilityGrade === 'fresh') {
      p('        本次使用大一版清单：项都是"知道 / 跟做过 / 独立做过一次"这一档，'
        + '没勾上通常只代表还没学到');
    }
    p('');
    p('岗位适配度  Fit = ' + fmt(res.match.ranked[0] ? res.match.ranked[0].parts.interestWeight : 0.4, 2)
      + ' × 兴趣匹配 + ' + fmt(res.match.ranked[0] ? res.match.ranked[0].parts.abilityWeight : 0.45, 2)
      + ' × 能力适配 + ' + fmt(res.match.ranked[0] ? res.match.ranked[0].parts.anchorWeight : 0.15, 2) + ' × 锚对齐');
    p('            兴趣 = 100 × Σ w·min(我的 / 岗位期望, 1) / Σ w   （达到期望即满分）');
    p('            能力 = 100 × Σ ω·(1 − 缺口 / 100)² / Σ ω      （只罚不足，缺口平方加重）');
    p('            锚   = 100 × 命中得分 / 1.5                  （主锚首位 1.0、次位 0.5，副锚减半）');
    if (s.abilityGrade === 'fresh') {
      p('            大一采用以兴趣为主的权重：能力项此时普遍是"没接触"，不适合主导排序');
    }
    p('');
    p('路径得分 = Σ 权重_i × (我的评分_i / 5) × 100');
    p('           权重由决策标准排序线性递减归一；未排序时退化为等权');
    p('```');
    p('**筛选规则**：学历门槛高于本人可达学历的岗位、以及本人明确排除的岗位，不参与计算。'
      + '城市不参与筛选——岗位库未逐岗标注城市，且城市是个人倾向而非门槛。');
    p('**逐题原始数据**：全部作答明细、维度得分与适配度分项，见另行导出的 '
      + '`原始作答明细.csv`、`维度与适配度.csv`、`行业岗位库参数表.csv`，本报告不再重复罗列。');
    p('**数据来源**：岗位画像、能力要求与薪资区间为课程实践示例数据，由公开行业报告与招聘信息描述结构化转写而成，'
      + '不代表实时招聘行情，来源清单见工作台目录 `情报库/岗位来源.md`。');
    p('**工具性质**：测评题目为课程自编，改编自霍兰德职业兴趣理论、施恩职业锚理论等公开框架，'
      + '不等同于任何标准化心理量表。本报告仅供生涯规划参考，不构成专业测评结论。');
    p('---');
    p('报告生成时间：' + new Date().toLocaleString('zh-CN'));

    return L.join('\n');
  };

  /**
   * 能力证据段落：列出各维度挂的证据，并明确哪些维度"仅自评"。
   *
   * 证据是可选填项，所以有两种正常形态：
   *   · 一个都没填 → 本次能力部分是纯自评
   *   · 部分填了   → 分别标出「已印证」与「仅自评」
   * 无论哪种都写进报告：哪些结论有依据、哪些没有，本身就是需要交代的信息。
   */
  CP.report.evidenceText = function (a, s) {
    var ev = (a && a.abilityEvidence) || {};
    var dims = (s && s.ability) ? Object.keys(s.ability.dims) : [];
    var withEv = [], withoutEv = [];
    dims.forEach(function (k) {
      var d = s.ability.dims[k];
      if (!d || d.score === null) return;
      if (ev[k]) withEv.push('「' + d.label + '」（' + ev[k] + '）');
      else withoutEv.push(d.label);
    });
    if (!withEv.length && !withoutEv.length) return '';
    if (!withEv.length) {
      return '本次没有为任何能力维度附上证据，因此上面的能力部分**全部属于自评**，'
        + '没有外部材料可以印证。这不妨碍用它来定位学习方向，但在向别人说明时应当留有余地。';
    }
    var txt = '以下维度附有证据，可印证勾选结果：' + withEv.join('；') + '。';
    if (withoutEv.length) {
      txt += '其余 ' + withoutEv.length + ' 个维度（' + withoutEv.join('、') + '）**仅凭自评**，没有附加材料。';
    }
    return txt;
  };

  /** 报告的 HTML 版证据块 */
  CP.report.evidenceBlock = function (a, s) {
    var txt = CP.report.evidenceText(a, s);
    if (!txt) return '';
    var anyEv = Object.keys((a && a.abilityEvidence) || {}).length > 0;
    return '<div class="note' + (anyEv ? '' : ' warn') + '"><b>能力证据</b><p>'
      + esc(txt).replace(/\*\*/g, '') + '</p></div>';
  };

  CP.report.downloadMarkdown = function () {
    var md = CP.report.toMarkdown();
    CP.file.download('职业生涯规划报告-' + CP.file.stamp() + '.md', md, 'text/markdown');
    CP.ui.toast('规划报告已导出');
  };

  /* ---------------- 视觉素材 ---------------- */

  /**
   * 把本地图片读成 data URI。
   *
   * 为什么不用相对路径：打印视图是写到新窗口里的，新窗口没有基准 URL，
   * file:// 下相对路径（素材/cover.png）会解析失败。转成 data URI 也顺带绕开了
   * canvas / 跨源限制。
   * 读不到时静默返回空串，打印视图会退回无图的排版，不影响报告内容。
   */
  CP.report.assetDataUri = function (relPath) {
    if (typeof fetch !== 'function' || typeof FileReader !== 'function') {
      return Promise.resolve('');
    }
    return fetch(relPath).then(function (r) {
      if (!r.ok) throw new Error('读取失败');
      return r.blob();
    }).then(function (blob) {
      return new Promise(function (resolve) {
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result || '')); };
        fr.onerror = function () { resolve(''); };
        fr.readAsDataURL(blob);
      });
    }).catch(function () { return ''; });
  };

  /* ============================================================
   * 职业简表：排名较高的职业的简要介绍
   *
   * 这一节替代了原来的"生涯人物访谈"。
   * 访谈被移除的原因是时间成本高、且学生不一定能找到合适的从业者——
   * 而它原本要回答的两个问题（这份工作实际在做什么、实际代价是什么）
   * 可以直接由岗位库回答，且对所有人一致、可核对。
   * ============================================================ */

  /**
   * 工作内容时间分配的完整描述，例如：
   *   "写代码/做技术 35%、写文档/报告 40%、开会/对齐 15%、沟通协调 10%"
   * 按占比从高到低排列，便于直接读出"时间主要花在哪"。
   */
  CP.report.workMixText = function (job) {
    var mix = job && job.workMix;
    if (!mix) return '（未标注）';
    return CP.DUTY_KEYS.slice()
      .map(function (d) { return { label: d.label, pct: mix[d.k] == null ? 0 : mix[d.k], k: d.k }; })
      .sort(function (a, b) { return b.pct - a.pct; })
      .map(function (d) { return d.label + ' ' + d.pct + '%'; })
      .join('、');
  };

  /**
   * 占比最高的项；若并列则一并返回。
   * @returns {Object|null} { top: [{label,pct}], max, tied:boolean }
   */
  CP.report.workMixTop = function (job) {
    var mix = job && job.workMix;
    if (!mix) return null;
    var rows = CP.DUTY_KEYS.map(function (d) {
      return { k: d.k, label: d.label, pct: mix[d.k] == null ? 0 : mix[d.k] };
    });
    var max = rows.reduce(function (m, r) { return Math.max(m, r.pct); }, 0);
    var top = rows.filter(function (r) { return r.pct === max; });
    return { top: top, max: max, tied: top.length > 1 };
  };

  /** 占比最高的项的中文描述（处理并列） */
  CP.report.workMixTopText = function (job) {
    var t = CP.report.workMixTop(job);
    if (!t) return '（未标注）';
    if (t.tied) return t.top.map(function (x) { return x.label; }).join('与') + '并列最高（各 ' + t.max + '%）';
    return '「' + t.top[0].label + '」（' + t.max + '%）';
  };

  /**
   * 非技术事务合计占比（用于"有多少时间不在写代码上"）
   */
  CP.report.nonCodePct = function (job) {
    var mix = (job && job.workMix) || {};
    return (mix.meeting || 0) + (mix.doc || 0) + (mix.comm || 0);
  };

  /**
   * 职业简表（Markdown 表格行）
   * @param {Array} jobs res.match.top（最多 3 个）
   */
  CP.report.jobDigestRows = function (jobs) {
    return jobs.map(function (r, i) {
      var j = CP.getJob(r.jobId);
      return [
        (i + 1),
        r.name,
        j.duties.slice(0, 3).join('；'),
        CP.report.workMixText(j),
        j.employers.slice(0, 2).join('；'),
        j.salaryBand.replace(/^示例区间：/, ''),
        j.risks
      ];
    });
  };

  /** 职业简表的表头 */
  CP.report.jobDigestHead = function () {
    return ['排名', '岗位', '主要职责', '一周工作内容占比（示例）', '典型雇主', '参考薪资', '这个岗位的风险'];
  };

  /* ---------------- 原始数据导出（CSV + JSON） ---------------- */

  function csvCell(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) {
    // 加 BOM，Excel 打开中文才不乱码
    return '\uFEFF' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  /**
   * 导出原始作答明细 + 岗位库参数表。
   * 用途：报告里出现的每一个数值都能在这里找到来源，便于教师手工复核。
   */
  CP.report.rawData = function () {
    var a = CP.ui.archive;
    var res = CP.ui.result();
    var s = res.score;

    var answerRows = [['板块', '题号', '题目', '是否反向计分', '原始作答', '归一化得分', '所属维度', '作答时间']];
    [
      ['兴趣测评', s.riasec],
      ['职业锚测评', s.anchor],
      ['能力清单', s.ability]
    ].forEach(function (blk) {
      blk[1].items.forEach(function (it) {
        answerRows.push([
          blk[0], it.id, it.text, it.reverse ? '是' : '否',
          it.raw == null ? '未勾选' : it.raw,
          it.norm == null ? '' : CP.round(it.norm, 2),
          it.dim,
          it.t ? new Date(it.t).toLocaleString('zh-CN') : ''
        ]);
      });
    });

    var dimRows = [['板块', '维度', '维度名称', '得分', '题内标准差', '已答题数', '证据']];
    [
      ['兴趣测评', s.riasec], ['职业锚测评', s.anchor], ['能力清单', s.ability]
    ].forEach(function (blk) {
      Object.keys(blk[1].dims).forEach(function (k) {
        var d = blk[1].dims[k];
        // 能力清单是勾选式：没有"题内标准差"，计数在 checked/expected 上；
        // 兴趣与职业锚仍是 Likert，计数在 n/expected 上。
        var n = (d.checked != null) ? d.checked : d.n;
        dimRows.push([blk[0], k, d.label, d.score == null ? '' : d.score,
          d.std == null ? '' : d.std, n + '/' + d.expected,
          (a.abilityEvidence && a.abilityEvidence[k]) || '']);
      });
    });

    var fitRows = [['排名', '岗位', '岗位族', '综合适配度', '兴趣匹配', '能力适配', '锚对齐', '学历门槛', '参考薪资']];
    res.match.ranked.forEach(function (r, i) {
      fitRows.push([i + 1, r.name, r.family, r.shown, r.parts.interest, r.parts.ability,
        r.parts.anchor == null ? '' : r.parts.anchor, r.minEdu, r.salaryBand]);
    });

    var gapRows = [['岗位', '能力维度', '岗位要求', '我的水平', '缺口', '加权贡献']];
    res.match.ranked.forEach(function (r) {
      r.detail.ability.forEach(function (d) {
        gapRows.push([r.name, CP.abilityLabel(d.dim), d.req, d.got, d.gap, CP.round(d.contrib, 4)]);
      });
    });

    var pathHead = ['排名', '路径', '加权得分'].concat(CP.CRITERIA.map(function (c) { return c.label + '(1-5)'; }));
    var pathBody = res.decision.ranked.map(function (r, i) {
      return [i + 1, r.name, r.shown].concat(r.detail.map(function (d) { return d.score; }));
    });

    var jobRows = [['岗位', '岗位族', '学历门槛', '参考薪资']
      .concat(CP.BANK_RIASEC.dimensions.map(function (d) { return '兴趣·' + d.id; }))
      .concat(CP.BANK_ABILITY.dimensions.map(function (d) { return '能力·' + d.label; }))
      .concat(['锚画像', '主要风险'])];
    CP.JOB_FAMILIES.forEach(function (j) {
      jobRows.push([j.name, j.family, j.minEdu, j.salaryBand]
        .concat(CP.BANK_RIASEC.dimensions.map(function (d) { return j.interest[d.id]; }))
        .concat(CP.BANK_ABILITY.dimensions.map(function (d) { return j.ability[d.id]; }))
        .concat([j.anchor.join('/'), j.risks]));
    });

    return {
      answers: answerRows,
      dims: dimRows,
      fit: fitRows,
      gaps: gapRows,
      path: [pathHead].concat(pathBody),
      jobs: jobRows,
      meta: {
        exportedAt: new Date().toISOString(),
        schemaVersion: CP.SCHEMA_VERSION,
        grade: a.profile.grade,
        abilityMode: s.abilityMode,
        fitWeights: res.match.ranked[0] ? {
          interest: res.match.ranked[0].parts.interestWeight,
          ability: res.match.ranked[0].parts.abilityWeight,
          anchor: res.match.ranked[0].parts.anchorWeight
        } : null
      }
    };
  };

  CP.report.downloadRawData = function () {
    var raw = CP.report.rawData();
    var stamp = CP.file.stamp();

    CP.file.download('原始作答明细-' + stamp + '.csv', toCsv(raw.answers), 'text/csv');
    setTimeout(function () {
      CP.file.download('维度与适配度-' + stamp + '.csv',
        toCsv(raw.dims).replace(/\r\n$/, '') + '\r\n\r\n' +
        toCsv(raw.fit).replace(/\r\n$/, '') + '\r\n\r\n' +
        toCsv(raw.gaps).replace(/\r\n$/, '') + '\r\n\r\n' +
        toCsv(raw.path), 'text/csv');
    }, 300);
    setTimeout(function () {
      CP.file.download('行业岗位库参数表-' + stamp + '.csv', toCsv(raw.jobs), 'text/csv');
    }, 600);
    setTimeout(function () {
      CP.file.download('原始数据-' + stamp + '.json', JSON.stringify(raw, null, 2), 'application/json');
    }, 900);

    CP.ui.toast('已导出 3 个 CSV + 1 个 JSON（浏览器可能提示"是否允许下载多个文件"）');
  };

  /* ---------------- 可打印视图 ---------------- */

  /**
   * 在新窗口生成纯净排版，用浏览器"打印 → 另存为 PDF"。
   * 为什么不用后端生成 PDF：这能让整个工作台保持零依赖、离线可用。
   */
  CP.report.openPrintView = function () {
    var a = CP.ui.archive;
    var res = CP.ui.result();
    var s = res.score;
    var w = window.open('', '_blank');
    if (!w) { CP.ui.toast('浏览器拦截了新窗口，请允许弹出窗口后重试'); return; }
    w.document.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">'
      + '<title>职业生涯规划报告</title></head><body style="font-family:sans-serif;padding:24px">正在排版…</body></html>');
    w.document.close();

    // 先取封面图，再构建整份文档（图读不到也无妨）
    CP.report.assetDataUri('素材/cover.png').then(function (coverUri) {
      CP.report.renderPrintView(w, a, res, coverUri);
    });
  };

  /**
   * 真正生成打印视图。与 Markdown 报告共用同一套结论文案（CP.report.textFor），
   * 保证两份产物的说法完全一致。
   */
  CP.report.renderPrintView = function (w, a, res, coverUri) {
    var s = res.score;
    var topJob = res.match.ranked[0];

    function sec(title, inner) {
      return '<section><h2>' + esc(title) + '</h2>' + inner + '</section>';
    }
    // 这些列是数值，右对齐 + 等宽数字读起来更整齐
    var NUM_HEADS = { '排名': 1, '计划': 1, '完成': 1, '完成率': 1, '逾期': 1, '缺口分值': 1, '得分': 1, '权重': 1, '岗位要求': 1, '我的水平': 1, '缺口': 1, '加权贡献': 1 };
    function tbl(head, rows) {
      var isNum = head.map(function (h) { return NUM_HEADS[h] ? 1 : 0; });
      return '<table><thead><tr>' + head.map(function (h, i) {
        return '<th' + (isNum[i] ? ' class="num"' : '') + '>' + esc(h) + '</th>';
      }).join('')
        + '</tr></thead><tbody>' + rows.map(function (r) {
          return '<tr>' + r.map(function (c, i) {
            return '<td' + (isNum[i] ? ' class="num"' : '') + '>' + c + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table>';
    }

    var html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">'
      + '<title>职业生涯规划报告</title><style>'
      // ★ 必须重新声明设计令牌。
      //   图表是用 fill="var(--brand)" 这种写法取色的，而打印视图是**独立文档**，
      //   不会继承 样式/工作台.css 里的 :root。缺了这些变量，所有图表颜色都会
      //   解析失败并回退成黑色——网页面里正常，导出 PDF 才发现整份报告是灰阶。
      + ':root{'
      + '--ink:#14202b;--ink-2:#4c5a68;--ink-3:#8894a2;'
      + '--line:#e3e8ec;--line-2:#eff2f5;'
      + '--brand:#0f766e;--brand-2:#14b8a6;--brand-ink:#0b5b55;--brand-soft:#e4f3f1;'
      + '--accent:#4f46e5;--gold:#b7791f;--warn:#b45309;--danger:#b42318;--ok:#067647'
      + '}'
      + 'body{font-family:"Microsoft YaHei","PingFang SC","Hiragino Sans GB",sans-serif;'
      + 'color:#16222c;max-width:820px;margin:0 auto;padding:26px 30px 34px;font-size:12pt;line-height:1.75}'
      // 打印时必须显式要求保留背景与图案，否则条形图的色带、表头底色、
      // 提示框左边条、封面渐变会被浏览器一并丢掉。
      + ':root,body{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;color-adjust:exact !important}'
      + '*,*::before,*::after{-webkit-print-color-adjust:exact;print-color-adjust:exact}'

      /* ---------- 标题层级 ---------- */
      + 'h1{font-size:19pt;text-align:center;margin:0 0 6px;letter-spacing:-.01em}'
      // 章节从新页开始：一份报告里最影响观感的就是章节被从中间截断。
      // 用「浅底 + 左侧色条 + 细分隔线」做章节头，比单纯的粗下划线更像正式文档。
      + 'h2{font-size:15pt;letter-spacing:-.01em;margin:0 0 16px;padding:9px 14px 9px 16px;'
      + 'border-left:5px solid var(--brand);background:var(--brand-soft);border-radius:0 6px 6px 0;'
      + 'break-after:avoid;page-break-after:avoid;break-before:page;page-break-before:always}'
      + 'h2:first-of-type{break-before:auto;page-break-before:auto}'
      // 小节标题带短前置色条，层级一眼可辨
      + 'h3{font-size:12.5pt;margin:20px 0 7px;padding-left:10px;border-left:3px solid var(--brand-2);'
      + 'break-after:avoid;page-break-after:avoid}'
      + 'h4{font-size:12pt;margin:14px 0 6px}'
      + 'p{orphans:3;widows:3;margin:7px 0}'

      /* ---------- 表格：浅底表头 + 斑马纹 + 数值右对齐 ---------- */
      + 'table{width:100%;border-collapse:collapse;margin:12px 0 14px;font-size:10.5pt;'
      + 'break-inside:auto;page-break-inside:auto}'
      + 'th,td{border:1px solid #dfe6e9;padding:6px 9px;text-align:left;vertical-align:top;line-height:1.6}'
      + 'th{background:var(--brand);color:#fff;font-weight:600;border-color:var(--brand)}'
      + 'tbody tr:nth-child(even){background:#f7fafb}'
      + 'tbody tr{break-inside:avoid;page-break-inside:avoid}'
      + 'thead{display:table-header-group}'
      + 'td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}'

      /* ---------- 提示框：左侧色条 + 语义配色 ---------- */
      + '.note{background:#f7fafb;border-left:4px solid var(--brand);border-radius:0 5px 5px 0;'
      + 'padding:9px 13px;font-size:10.5pt;margin:10px 0;break-inside:avoid;page-break-inside:avoid}'
      + '.note p{margin:4px 0}'
      + '.note b{color:var(--brand-ink)}'
      + '.note.warn{background:#fefaf1;border-left-color:var(--warn)}'
      + '.note.warn b{color:var(--warn)}'
      + '.meta{text-align:center;color:#5b6b78;font-size:10.5pt;margin-bottom:18px}'

      /* ---------- 列表与图表 ---------- */
      + 'section{break-inside:auto;page-break-inside:auto}'
      + 'ul,ol{margin:6px 0;padding-left:22px}'
      + 'li{break-inside:avoid;page-break-inside:avoid;margin:3px 0}'
      + 'svg{max-width:100%;height:auto}'
      + '.swot{display:grid;grid-template-columns:1fr 1fr;gap:11px;break-inside:avoid;page-break-inside:avoid}'
      + '.swot div{border:1px solid #dfe6e9;border-top:3px solid var(--brand);border-radius:5px;'
      + 'padding:10px 13px;font-size:10.5pt;background:#fcfdfd}'
      + '.swot div:nth-child(2){border-top-color:var(--warn)}'
      + '.swot div:nth-child(3){border-top-color:var(--brand-2)}'
      + '.swot div:nth-child(4){border-top-color:var(--danger)}'
      + '.swot b{display:block;margin-bottom:5px}'

      /* ---------- 封面 ---------- */
      // 顶部细色带 + 底部信息条，中间留白放标题；右侧阶梯图淡出到左侧
      + '.cover{position:relative;overflow:hidden;border-radius:12px;'
      + 'margin:0 0 22px;padding:46px 34px 30px;'
      + 'background:linear-gradient(112deg,#f4faf9 0%,#f8fcfc 46%,rgba(20,184,166,.16) 100%);'
      + 'border:1px solid #d3e6e3;border-top:5px solid var(--brand);'
      + 'break-inside:avoid;page-break-inside:avoid}'
      + '.cover::after{content:"";position:absolute;inset:0 0 0 auto;width:50%;'
      + (coverUri ? ('background-image:url(' + coverUri + ');') : 'background:none;')
      + 'background-size:cover;background-position:center;opacity:.5;'
      + '-webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 52%);mask-image:linear-gradient(90deg,transparent 0%,#000 52%)}'
      + '.cover h1{text-align:left;position:relative;font-size:23pt;line-height:1.3;margin:0 0 12px}'
      + '.cover .kicker{position:relative;font-size:10pt;letter-spacing:.18em;color:var(--brand-ink);'
      + 'text-transform:uppercase;margin-bottom:10px}'
      + '.cover .meta{text-align:left;position:relative;margin:0}'
      // 封面底部信息条：把基本信息挪到这里，正式文档的常见做法。
      // 必须允许换行且限制在容器内——胶囊不换行会溢出封面右侧被裁掉。
      + '.cover-facts{position:relative;display:flex;flex-wrap:wrap;gap:8px;margin-top:20px;'
      + 'padding-top:14px;border-top:1px solid rgba(15,118,110,.2);max-width:100%}'
      + '.cover-facts span{font-size:9.5pt;color:#33454f;background:rgba(255,255,255,.78);'
      + 'border:1px solid rgba(15,118,110,.18);border-radius:999px;padding:3px 10px;'
      + 'white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}'
      + '.cover-facts b{color:var(--brand-ink);font-weight:600}'

      + '@page{size:A4;margin:16mm 15mm}'
      + '</style></head><body>'
      + '<div class="cover">'
      + '<div class="kicker">AI Career Planning</div>'
      + '<h1>人工智能专业<br>职业生涯规划报告</h1>'
      + '<div class="meta">生成于 ' + esc(new Date().toLocaleString('zh-CN')) + '</div>'
      // 基本信息挪到封面：正式文档的常见做法，也让正文的表格不必再重复一遍
      + '<div class="cover-facts">'
      + '<span>年级 <b>' + esc(a.profile.grade || '—') + '</b></span>'
      + '<span>专业方向 <b>' + esc(a.profile.track || '—') + '</b></span>'
      + '<span>读研意向 <b>' + esc(a.profile.acceptPostgrad || '—') + '</b></span>'
      + '</div>'
      + '</div>';

    html += sec('摘要',
      CP.report.summaryParagraphs(a, res).map(function (t) { return '<p>' + esc(t) + '</p>'; }).join(''));

    html += sec('第一章　自我认知',
      '<h3>1.1 基本情况</h3>'
      + tbl(['项目', '内容'], [
        ['年级', esc(a.profile.grade || '—')],
        ['专业方向', esc(a.profile.track || '—')],
        ['GPA 档位', esc(a.profile.gpaBand || '（大一通常尚未评定）')],
        ['是否接受读研', esc(a.profile.acceptPostgrad || '—')],
        ['每周可投入学习时长', esc((a.decision.hoursPerWeek == null ? '—' : a.decision.hoursPerWeek) + ' 小时')],
        ['期望工作城市', esc((a.decision.targetCities || []).join('、') || '未指定')]
      ])
      + '<p>' + esc(CP.report.textFor('profileNote', { a: a, res: res, s: s })) + '</p>'
      + '<h3>1.2 职业兴趣</h3>'
      + '<p>' + esc(CP.report.textFor('interest', { a: a, res: res, s: s })) + '</p>'
      + '<div style="text-align:center">' + CP.chartRadar(CP.BANK_RIASEC.dimensions.map(function (d) {
        return { label: d.label.replace(/\s*[A-Z]$/, ''), score: s.riasec.dims[d.id].score };
      }), { size: 250 }) + '</div>'
      + (s.abilityGrade === 'fresh' ? '<p>' + esc(CP.report.textFor('freshInterest', { a: a, res: res, s: s })) + '</p>' : '')
      + '<h3>1.3 职业锚</h3>'
      + '<p>' + esc(CP.report.textFor('anchor', { a: a, res: res, s: s })) + '</p>'
      + '<h3>1.4 能力现状</h3>'
      + '<p>' + esc(CP.report.textFor('ability', { a: a, res: res, s: s })) + '</p>'
      + '<div style="text-align:center">' + CP.chartBars(
        Object.keys(s.ability.dims).map(function (k) {
          return { label: s.ability.dims[k].label, value: s.ability.dims[k].score };
        }).sort(function (x, y) { return (y.value || 0) - (x.value || 0); }),
        { width: 420, labelW: 96, digits: 0, pending: true }) + '</div>'
      + CP.report.evidenceBlock(a, s)
      + (s.flags.length
        ? '<div class="note warn"><b>数据质量提示</b><p>' + esc(CP.report.textFor('quality', { a: a, res: res, s: s })) + '</p><ul>'
          + s.flags.map(function (f) { return '<li>' + esc(f.message) + '</li>'; }).join('') + '</ul></div>'
        : ''));

    html += sec('第二章　职业与行业认知',
      '<h3>2.1 匹配结论</h3>'
      + '<p>' + esc(CP.report.textFor('matchText', { a: a, res: res, s: s })) + '</p>'
      + (res.match.top.length ? '<h3>2.2 排名较高的职业简表</h3>'
        + '<p>下表按适配度排序，列出排在前面几个职业的日常职责、工作内容时间分配、典型雇主、参考薪资与主要风险。'
        + '其中"一周工作内容占比"一栏值得特别留意——很多人对某个岗位的想象与实际工作内容差距极大。</p>'
        + tbl(CP.report.jobDigestHead(), CP.report.jobDigestRows(res.match.top))
        + res.match.top.map(function (r) {
          var j = CP.getJob(r.jobId);
          if (!j.workMix) return '';
          return '<p><b>' + esc(r.name) + '：</b>时间主要花在 ' + esc(CP.report.workMixTopText(j)) + ' 上，'
            + '完整分配为 ' + esc(CP.report.workMixText(j)) + '。'
            + esc(CP.report.textFor('digestHint', { job: j })) + '</p>';
        }).join('') : '')
      + (topJob ? '<h3>2.4 首位岗位展开：' + esc(topJob.name) + '</h3>'
        + '<p>' + esc(topJob.summary) + '</p>'
        + '<ul>' + CP.getJob(topJob.jobId).duties.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>'
        + '<p><b>一周工作内容占比：</b>' + esc(CP.report.workMixText(CP.getJob(topJob.jobId))) + '</p>'
        + '<p><b>典型雇主：</b>' + esc(CP.getJob(topJob.jobId).employers.join('；')) + '</p>'
        + '<p><b>参考薪资：</b>' + esc(topJob.salaryBand) + '（示例数据，非实时行情）</p>'
        + '<p><b>这个岗位的风险：</b>' + esc(topJob.risks) + '</p>'
        + '<p>' + esc(CP.report.textFor('gapText', { a: a, res: res, s: s })) + '</p>'
        + '<h3>2.5 我与该岗位的能力对照</h3>'
        + CP.chartGaps(topJob.detail.ability.map(function (d) {
          return { label: CP.abilityLabel(d.dim), got: d.got, req: d.req };
        }), { width: 540 }) : '')
      + '<h3>2.6 被排除的岗位</h3>'
      + '<p>' + esc(CP.report.textFor('excludeText', { a: a, res: res, s: s })) + '</p>');

    html += sec('第三章　目标决策与路径设计',
      '<h3>3.1 我最看重什么</h3>'
      + '<p>' + esc(CP.report.textFor('decisionText', { a: a, res: res, s: s })) + '</p>'
      + '<h3>3.2 主路径与备选</h3>'
      + '<p>' + esc(CP.report.textFor('pathText', { a: a, res: res, s: s })) + '</p>'
      + (res.decision.primary && res.decision.primary.milestones
        ? '<h3>3.3 阶段性目标</h3>'
        + tbl(['阶段', '目标'], [['本学期', (res.decision.primary.milestones.term || []).map(esc).join('；')],
          ['1 年内', (res.decision.primary.milestones.oneYear || []).map(esc).join('；')],
          ['3 年内', (res.decision.primary.milestones.threeYear || []).map(esc).join('；')],
          ['5 年内', (res.decision.primary.milestones.fiveYear || []).map(esc).join('；')]])
        : ''));

    html += sec('第四章　能力锻造',
      '<p>' + esc(CP.report.textFor('skillIntro', { a: a, res: res, s: s })) + '</p>'
      + (res.gaps.map(function (g, i) {
        var isExplore = g.dim === '_explore';
        return '<h3>' + (isExplore ? '第一步：' : '第 ' + i + ' 项：') + esc(g.label) + '</h3>'
          + '<p>' + (isExplore
            ? '先按兴趣方向做一次能演示的小项目。'
            : '排序依据：' + esc(g.basis) + '。')
          + '</p>'
          + '<b>要做的事</b><ul>' + g.tasks.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>'
          + '<b>做完要交出什么</b><ul>' + g.deliverables.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>'
          + '<p>参考资源：' + esc((g.resources || []).join('、')) + '。</p>';
      }).join('') || '<p>当前目标岗位没有明显的能力缺口。</p>')
      + (res.match.ranked[0] ? '<h3>4.2 岗位认知核对</h3>'
        + (function () {
          var tj = CP.getJob(res.match.ranked[0].jobId);
          return '<p>上面的学习任务都指向「' + esc(res.match.ranked[0].name) + '」。在投入之前，值得先核对一次这份工作的日常：'
            + '时间主要花在 ' + esc(CP.report.workMixTopText(tj)) + ' 上，完整分配为 '
            + esc(CP.report.workMixText(tj)) + '。</p>'
            + '<p>如果这些事我一件都不想长期做，那么即使适配度分数高，也应该回到第三章重新考虑路径——'
            + '<b>测评算的是匹配度，不能代替"我愿不愿意做"这个判断。</b></p>';
        })() : ''));

    html += sec('第五章　行动计划',
      '<h3>5.1 执行情况</h3>'
      + '<p>' + esc(CP.report.textFor('actionText', { a: a, res: res, s: s })) + '</p>'
      + '<h3>5.2 任务清单</h3>'
      + ((a.actions || []).length
        ? tbl(['任务', '截止', '状态', '来源'], a.actions.map(function (x) {
          return [esc(x.title), esc(x.due || '—'),
            x.status === 'done' ? '已完成' : (x.status === 'doing' ? '进行中' : '待做'),
            x.fromGap ? esc(CP.abilityLabel(x.fromGap))
              : ((x.note || '').indexOf('主路径') >= 0 ? '路径里程碑' : '—')];
        }))
        : '<p>尚未生成行动计划。</p>')
      + (CP.yearPlan(a, res.decision, res.match).length
        ? '<h3>5.3 逐年规划建议</h3>'
        + '<ul>' + CP.yearPlan(a, res.decision, res.match).map(function (r) {
          return '<li><b>' + esc(r.year) + '</b>：' + esc(r.action)
            + '　　　<span style="color:#555">' + esc(r.note) + '</span></li>';
        }).join('') + '</ul>'
        : '')
      + ((a.reviews || []).length
        ? '<h3>5.4 复盘记录</h3>'
        + tbl(['日期', '类型', '计划', '完成', '完成率', '逾期', '新增证据', '下周最高优先级'],
          a.reviews.map(function (r) {
            var rate = (r.planned && r.done != null) ? Math.round(r.done / r.planned * 100) + '%' : '—';
            return [esc(r.date), esc(r.type), r.planned == null ? '—' : r.planned, r.done == null ? '—' : r.done,
              rate, r.overdue == null ? '—' : r.overdue, esc(r.evidence || '—'), esc(r.next || '—')];
          }))
        + '<p>' + esc(CP.report.textFor('reviewText', { a: a, res: res, s: s })) + '</p>'
        : '')
      + '<h3>5.5 SWOT 分析</h3>'
      + '<div class="swot"><div><b>S 优势</b><ul>' + res.swot.strengths.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>'
      + '<div><b>W 待补</b><ul>' + res.swot.weaknesses.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>'
      + '<div><b>O 机会</b><ul>' + res.swot.opportunities.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>'
      + '<div><b>T 威胁</b><ul>' + res.swot.threats.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div></div>');

    html += sec('附录　方法与来源',
      '<p>本报告的全部结论由「AI 职业生涯规划学习实践工作台」依据本人填写的作答计算得出。'
      + '逐题作答明细、维度得分与适配度分项见另行导出的《原始作答明细》《维度与适配度》《行业岗位库参数表》三份 CSV，本报告不再罗列。</p>'
      + '<p><b>归一化：</b>1-5 量表 norm=(raw−1)/4×100（反向题先取 6−raw），维度得分取均值。'
      + '<b>能力清单（勾选式）：</b>维度得分=100×Σ(已勾项权重)/Σ(全维权重)，每维 6 项按由易到难排列、权重递增，'
      + '未勾的项计 0 分。'
      + (s.abilityGrade === 'fresh' ? '本次使用大一版清单（项为"知道 / 跟做过 / 独立做过一次"这一档）。' : '')
      + '</p>'
      + '<p><b>岗位适配度：</b>Fit = '
      + fmt(res.match.ranked[0] ? res.match.ranked[0].parts.interestWeight : 0.4, 2) + '×兴趣 + '
      + fmt(res.match.ranked[0] ? res.match.ranked[0].parts.abilityWeight : 0.45, 2) + '×能力 + '
      + fmt(res.match.ranked[0] ? res.match.ranked[0].parts.anchorWeight : 0.15, 2) + '×锚对齐。'
      + '兴趣 = 100×Σw·min(我的/期望,1)/Σw；能力 = 100×Σω·(1−缺口/100)²/Σω；锚 = 100×命中得分/1.5。</p>'
      + '<p><b>路径决策：</b>权重由标准排序线性递减归一，得分 = Σ 权重 ×(评分/5)×100。</p>'
      + '<p><b>筛选规则：</b>学历门槛高于可达学历、或被本人明确排除的岗位不参与计算。城市不参与筛选。</p>'
      + '<p><b>数据声明：</b>岗位画像、能力要求与薪资区间为课程实践示例数据，由公开行业报告与招聘信息描述结构化转写，'
      + '不代表实时招聘行情，来源清单见工作台目录 情报库/岗位来源.md。测评题目为课程自编，改编自公开理论框架，'
      + '不等同标准化心理量表，结果仅供生涯规划参考。</p>'
      + '<p style="text-align:right;color:#555">报告生成时间：' + esc(new Date().toLocaleString('zh-CN')) + '</p>');

    html += '</body></html>';

    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(function () { try { w.focus(); } catch (e) { /* 忽略 */ } }, 200);
    CP.ui.toast('已生成可打印页面：在新页面按 Ctrl+P，打印机选「另存为 PDF」');
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
