/*!
 * 逻辑/建议.js — 差距 → 学习任务映射、行动计划生成、SWOT 抽取
 */
(function (root) {
  'use strict';
  var CP = (root.CP = root.CP || {});

  /**
   * 8 项能力维度的"缺口 → 任务"映射表。
   * 每条任务都带可验收的作品，避免出现"多读书"这类无法检查的建议。
   */
  CP.TASK_MAP = {
    math: {
      label: '数学与理论',
      tasks: ['系统重学线性代数中与 AI 直接相关的部分（矩阵分解、特征值、SVD）',
              '用 Python 手推并实现一遍反向传播与梯度下降'],
      deliverables: ['一份手写推导笔记（可拍照存档）', '不调用框架、纯 NumPy 实现的两层神经网络'],
      hours: 40,
      resources: ['《深度学习》花书 第 2-4 章', '3Blue1Brown 线性代数系列']
    },
    code: {
      label: '编程工程',
      tasks: ['把一个课程作业重写成有模块划分、有单元测试的项目', '掌握 Git 分支协作与 Code Review 流程'],
      deliverables: ['一个带 README、测试、CI 的 GitHub 仓库', '对该仓库的代码规范自查清单'],
      hours: 60,
      resources: ['《Python 编程从入门到实践》', 'Google Python Style Guide']
    },
    data: {
      label: '数据与实验',
      tasks: ['完整做一次数据清洗与探索性分析，并记录每一步决策', '按"假设—实验—结论"格式设计并执行一组对比实验'],
      deliverables: ['一份 EDA 报告（含图表与结论）', '一份实验记录表（含消融结果）'],
      hours: 50,
      resources: ['Kaggle Learn: Data Cleaning / Feature Engineering']
    },
    model: {
      label: '算法建模',
      tasks: ['选一篇经典论文做完整复现（含数据、训练、评测）', '在一个真实数据集上跑通端到端建模并写出结论'],
      deliverables: ['复现报告（含与原论文指标的差异分析）', '可运行的训练脚本'],
      hours: 80,
      resources: ['Papers with Code 对应任务榜单', '《机器学习》周志华']
    },
    deploy: {
      label: '系统与部署',
      tasks: ['把训练好的模型封装成 API 服务并容器化', '为服务加上基本的并发压测与日志监控'],
      deliverables: ['一个能跑起来的 Docker 镜像与部署文档', '一份压测报告（QPS / 延迟）'],
      hours: 50,
      resources: ['FastAPI 官方文档', 'Docker 官方入门教程']
    },
    product: {
      label: '产品与业务',
      tasks: ['选一款你常用的 AI 产品，写出它的功能拆解与指标猜测', '为一个真实痛点写一份 AI 方案需求文档'],
      deliverables: ['一份产品拆解报告', '一份含指标定义的需求文档（PRD 精简版）'],
      hours: 40,
      resources: ['《启示录：打造用户喜爱的产品》', '公司公开的产品复盘文章']
    },
    comm: {
      label: '沟通表达协作',
      tasks: ['把一个技术方案讲给非技术同学听，并收集反馈', '在校内做一次技术分享或项目汇报'],
      deliverables: ['一份 10 页技术分享 PPT', '一份听众反馈记录与改进清单'],
      hours: 30,
      resources: ['《金字塔原理》', '技术演讲类公开课']
    },
    self: {
      label: '自主学习与抗压',
      tasks: ['建立可执行的周计划机制并连续执行 4 周', '记录并复盘 3 次"卡住很久"的真实经历'],
      deliverables: ['4 周周计划与完成度记录', '一份卡点复盘清单（含下次的应对策略）'],
      hours: 20,
      resources: ['《深度工作》', 'GTD / 番茄工作法实践指南']
    }
  };

  /**
   * 能力维度 ↔ 兴趣方向（RIASEC）的对应关系。
   *
   * 【这是本工作台的教学假设，不是心理学结论】
   * 用途只有一个：大一的"这项能力与我的兴趣方向贴不贴合"排序。
   * 每个能力维度列出它主要服务的兴趣方向及强度（0-1）。
   * 例如："算法建模"主要服务研究型 I（0.7）与常规型 C（0.3）的工作内容。
   */
  CP.ABILITY_DIM_INTEREST = {
    math:    { I: 0.8, C: 0.2 },
    code:    { R: 0.6, I: 0.3, C: 0.1 },
    data:    { I: 0.6, C: 0.4 },
    model:   { I: 0.7, C: 0.3 },
    deploy:  { R: 0.7, C: 0.3 },
    product: { E: 0.6, S: 0.4 },
    comm:    { S: 0.6, E: 0.3, A: 0.1 },
    self:    { E: 0.4, S: 0.3, A: 0.3 }
  };

  /**
   * 差距任务的优先级分数。
   *
   * 高年级：按缺口严重度排 —— 时间紧、目标明确，先补最缺的。
   *
   * 大一：按**与兴趣方向的贴合度**排，而不是按缺口大小，也不是按好补程度。
   *   理由：大一距离求职还有约 3 年，此时"哪项能力缺得最多"几乎等于"哪门课还没上"，
   *   按它排序只会让大一学生先去啃最难、最没有正反馈的部分。
   *   更合理的做法是顺着已经明确的兴趣方向先把一件事做起来：
   *   兴趣相关的能力补起来动力最足、坚持得最久，而且方向本身会在这个过程中被验证或修正。
   *
   * @param {Object} gap     拖累项 { dim, severity, ... }
   * @param {Object} opts    { mode: 'freshman'|'senior', fit: {dimId: 0-1 贴合度} }
   */
  CP.gapPriority = function (gap, opts) {
    opts = opts || {};
    if (opts.mode !== 'freshman') return gap.severity;
    var fit = (opts.fit && opts.fit[gap.dim] != null) ? opts.fit[gap.dim] : 0.3;
    return 0.25 + 0.75 * fit;
  };

  /**
   * 大一专属：第一条任务永远是"顺着兴趣做一个小项目"，而不是补最缺的能力。
   * 目的是先拿到一次"从零做到能用"的完整体验，再谈补哪块。
   */
  CP.exploreTask = function (score) {
    var rows = (score && score.ability) ? score.ability.dims : {};
    var selfScore = rows.self && rows.self.score !== null ? rows.self.score : null;
    var weeks = selfScore !== null && selfScore < 40 ? 6 : 4;
    return {
      dim: '_explore',
      label: '方向探索（大一优先）',
      gap: null,
      req: null,
      got: null,
      severityPct: null,
      priorityPct: null,
      basis: '按兴趣测评第一名的方向，先做一次能演示的小项目',
      tasks: [
        '按兴趣测评第一名的方向，选一个小到能做完的题目（例如"用现成模型做一个图片分类的小应用"）',
        '把过程写下来：做了什么、卡在哪里、哪一步最让你愿意继续做下去'
      ],
      deliverables: [
        '一个能演示的小作品（代码 + 一句说明运行的命令即可）',
        '一页过程记录：卡点清单 + 你对这个方向"还想不想继续"的判断'
      ],
      hours: weeks * 6,
      resources: ['各平台入门公开课（择一，不要同时开三门）', '动手类教程优先于理论课'],
      forJob: (score && score.holland) ? ('兴趣方向 ' + (score.holland.code || '')) : '兴趣方向',
      dueWeeks: weeks
    };
  };

  /**
   * 把岗位匹配的拖累项转成学习任务包。
   * @param {Object} match CP.matchJobs 的结果
   * @param {number} limit 取前几个缺口
   * @param {Object} score CP.scoreAll 的结果（决定排序口径与大一模式）
   * @param {Object} interests 岗位的兴趣画像（大一排序用），通常是首位岗位的 interest
   */
  CP.gapTasks = function (match, limit, score, interests) {
    var n = limit == null ? 3 : limit;
    var topJob = match.ranked[0];
    if (!topJob) return [];

    // 大一的特殊排序按年级判断，与用哪套清单无关
    var mode = (score && score.abilityGrade === 'fresh') || (match && match.isFreshman) ? 'freshman' : 'senior';
    var fitMap = CP.dimInterestFit(score, interests || topJob.interest || {});

    var items = topJob.drags.map(function (d) {
      return {
        dim: d.dim,
        gap: d.gap,
        req: d.req,
        got: d.got,
        severity: d.severity,
        severityPct: d.pct,
        interestFit: fitMap[d.dim] == null ? null : CP.round(fitMap[d.dim] * 100, 1),
        priority: CP.gapPriority(d, { mode: mode, fit: fitMap })
      };
    });

    var pTotal = items.reduce(function (s, x) { return s + x.priority; }, 0) || 1;
    items.forEach(function (x) { x.priorityPct = CP.round(x.priority / pTotal * 100, 1); });

    // 大一按"与兴趣方向的贴合度"降序；其他年级按缺口严重度降序
    items.sort(function (a, b) {
      if (mode === 'freshman') {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return b.severity - a.severity;
      }
      return b.severity - a.severity;
    });

    var mapped = items.slice(0, n).map(function (d) {
      var m = CP.TASK_MAP[d.dim] || { label: d.label, tasks: [], deliverables: [], hours: null, resources: [] };
      return {
        dim: d.dim,
        label: m.label,
        gap: d.gap,
        req: d.req,
        got: d.got,
        severityPct: d.severityPct,
        priorityPct: d.priorityPct,
        interestFit: d.interestFit,
        basis: mode === 'freshman'
          ? (d.interestFit === null ? '按与兴趣方向的贴合度排序（大一模式）'
            : '与你的兴趣方向贴合度 ' + d.interestFit + '%，因此排在前面（大一模式）')
          : '按缺口严重度排序',
        tasks: m.tasks,
        deliverables: m.deliverables,
        hours: m.hours,
        resources: m.resources,
        forJob: topJob.name,
        dueWeeks: m.hours ? Math.ceil(m.hours / 8) : null
      };
    });

    // 大一：把"顺着兴趣做一个小项目"插到第一位
    if (mode === 'freshman' && score) mapped.unshift(CP.exploreTask(score));
    return mapped;
  };

  /**
   * 计算每项能力与"我的兴趣方向"的贴合度（0-1）。
   *
   * 做法：把兴趣维度按强弱归一为权重，再看每个能力维度在哪些兴趣方向上被岗位看重。
   * 能力维度 → 兴趣方向的映射是本工作台的教学假设（见 文档/数据字典.md）。
   */
  CP.dimInterestFit = function (score, jobInterest) {
    var out = {};
    var w = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 };
    if (score && score.riasec) {
      Object.keys(w).forEach(function (k) {
        var s = score.riasec.dims[k] ? score.riasec.dims[k].score : null;
        w[k] = s === null ? 0 : s;
      });
    }
    var sum = Object.keys(w).reduce(function (s, k) { return s + w[k]; }, 0) || 1;
    Object.keys(w).forEach(function (k) { w[k] = w[k] / sum; });

    var J = jobInterest || {};
    var maxJ = Object.keys(J).reduce(function (s, k) { return Math.max(s, J[k] || 0); }, 1) || 1;

    Object.keys(CP.ABILITY_DIM_INTEREST).forEach(function (dim) {
      var aff = CP.ABILITY_DIM_INTEREST[dim];
      var num = 0, den = 0;
      Object.keys(aff).forEach(function (rik) {
        var a = aff[rik];
        var jv = (J[rik] || 0) / maxJ;      // 该岗位对这一兴趣方向的看重程度 0-1
        num += a * jv * w[rik];
        den += a * jv;
      });
      out[dim] = den > 0 ? Math.max(0, Math.min(1, num / den)) : 0.3;
    });
    return out;
  };

  /* ============================================================
   * 长期规划建议（系统给出，不是让用户填）
   *
   * 为什么是建议而不是填空：职业规划的远期部分，学生最缺的不是"写下来的地方"，
   * 而是"每个阶段到底该做什么"的判断。给一张空白框只会让人写出"我要努力"这类话。
   *
   * 为什么必须带"大几 / 研几"：职业规划里最常见的失败是"知道要努力，但不知道现在该做什么"。
   * 所以每一条都锚到具体学年。起点取本人当前年级——大一看到四年，研一看到两年，
   * 已经过去的年份不再出现。
   * ============================================================ */

  /** 每个学年节点的建议：action 是这一阶段该产出什么，note 是判断标准 */
  var YEAR_PLAN = {
    '大一': [
      { year: '大一', action: '把数学与编程的基础课学扎实，同时按兴趣方向做一个小项目', note: '先确认"我愿意为它持续投入时间"，比早定岗位更重要' },
      { year: '大二', action: '选定一个细分方向，做完第一个能演示的完整项目并积累代码仓库', note: '这一项是简历上唯一无法临时补的东西' },
      { year: '大三', action: '争取一段实习，同时把绩点稳定在保研线以上', note: '大三上结束前必须能回答"我凭什么被选中"' },
      { year: '大四', action: '9—10 月秋招投递，同步做毕设收尾', note: '秋招是主战场，春招只剩补漏的机会' }
    ],
    '大二': [
      { year: '大二', action: '补齐基础课后，选定细分方向并完成第一个完整项目', note: '重点是"做完"而不是"学过"' },
      { year: '大三', action: '把项目做深到能讲清技术取舍，争取一段实习', note: '面试问的是取舍，不是用了什么模型' },
      { year: '大四', action: '9—10 月秋招投递，同步做毕设收尾', note: '秋招是主战场，春招只剩补漏的机会' }
    ],
    '大三': [
      { year: '大三', action: '把已有的项目做深，或补一段实习；确定升学还是就业', note: '这个判断最晚在大三下开学前要定下来' },
      { year: '大四', action: '9—10 月秋招投递；准备毕设与毕业', note: '秋招是主战场，春招只剩补漏的机会' }
    ],
    '大四': [
      { year: '大四', action: '完成秋招投递与面试，拿到 offer 后按时毕业', note: '入职前把最后一段项目经验补成可展示的作品' }
    ],
    '研一': [
      { year: '研一', action: '修完核心课程，定下研究方向，完整复现一篇论文', note: '方向越早定，研二的产出越扎实' },
      { year: '研二', action: '做出核心研究成果（投稿或专利），并做一段算法实习', note: '研二的产出决定你毕业时的议价能力' },
      { year: '研三', action: '秋招投递算法岗，同步完成毕业论文', note: '论文与求职要并行推进，不要串行' }
    ],
    '研二': [
      { year: '研二', action: '完成核心研究产出并投稿，同时做一段算法实习', note: '实习是校招简历上最重的加分项' },
      { year: '研三', action: '秋招投递算法岗，同步完成毕业论文', note: '论文与求职要并行推进，不要串行' }
    ],
    '研三': [
      { year: '研三', action: '秋招投递并完成毕业论文，在 offer 之间做取舍', note: '取舍标准回到你最看重的那一项决策标准' }
    ]
  };

  /**
   * 生成逐年规划建议。
   *
   * @param {Object} archive 档案（取当前年级作为起点）
   * @param {Object} decision decidePaths 的结果
   * @param {Object} match    matchJobs 的结果
   * @returns {Array} [{ year, action, note }]
   */
  CP.yearPlan = function (archive, decision, match) {
    var grade = (archive && archive.profile && archive.profile.grade) || '大三';
    var start = YEAR_PLAN[grade] || YEAR_PLAN['大三'];
    var rows = start.map(function (x) { return { year: x.year, action: x.action, note: x.note }; });
    if (!rows.length) return rows;

    // 三条主线对同一学年的侧重不同，用后缀点出来——六条路径写六份表会失控
    var pathId = (decision && decision.primary) ? decision.primary.pathId : '';
    var isExam = /p-考公/.test(pathId);
    var isResearch = /p-baoyan|p-出国|p-考研转行业/.test(pathId);
    var job = (match && match.ranked && match.ranked[0]) ? match.ranked[0].name : '';

    rows.forEach(function (r) {
      if (isExam) {
        r.action += '（同时按考公节奏推进：行测与申论要提前一年启动）';
      } else if (isResearch && (r.year === '大二' || r.year === '研一' || r.year === '研二')) {
        r.action += '（偏研究路线：优先保证科研产出，而不是刷实习数量）';
      } else if (!isResearch && r.year === '大三') {
        r.action += '（偏就业路线：实习优先级高于课程分数，但不要挂科）';
      }
      if (job && r.year === '大四') r.action += '；目标岗位可锁定「' + job + '」这类方向';
    });
    return rows;
  };

  /**
   * 生成行动计划草案：差距任务 + 路径里程碑。
   * 返回的元素可直接写入 archive.actions。
   */
  CP.draftActions = function (archive, score, match, decision, startDate) {
    // 起点按**本地时区**解析：new Date('2026-03-20') 会被当成 UTC 零点，
    // 东八区下等于前一天早上 8 点，再加 N 周会让所有截止日整体偏一天。
    var start = startDate ? CP.parseDateOnly(startDate) : new Date();
    var out = [];
    var seq = 0;

    function dueIn(weeks) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      d.setDate(d.getDate() + weeks * 7);
      return CP.dateOnly(d);
    }
    function push(o) {
      seq += 1;
      out.push({
        id: 'a' + Date.now().toString(36) + '-' + seq,
        title: o.title,
        due: o.due || null,
        status: 'todo',
        evidence: '',
        fromGap: o.fromGap || null,
        note: o.note || ''
      });
    }

    // 1) 差距驱动任务（按排名口径排序，每项按估算工时给截止周）
    var cursor = 0;
    var topInterest = (match.ranked[0] && match.ranked[0].detail && match.ranked[0].jobId)
      ? (CP.getJob(match.ranked[0].jobId) || {}).interest : {};
    CP.gapTasks(match, 3, score, topInterest).forEach(function (g) {
      var weeks = g.dueWeeks || 6;
      cursor += weeks;
      g.tasks.forEach(function (t, i) {
        push({
          title: t,
          due: dueIn(i === 0 ? Math.max(1, cursor - weeks + Math.ceil(weeks / 2)) : cursor),
          fromGap: g.dim === '_explore' ? null : g.dim,
          note: g.dim === '_explore'
            ? ('大一的第 1 步：先验证方向。验收作品：' + (g.deliverables.join('；') || '待补充'))
            : ('对应验收作品：' + (g.deliverables.join('；') || '待补充') + '（目标岗位：' + g.forJob + '｜排序依据：' + g.basis + '）')
        });
      });
    });

    // 2) 近期里程碑（来自主路径的本学期条目）
    if (decision && decision.primary && decision.primary.milestones) {
      (decision.primary.milestones.term || []).forEach(function (t) {
        push({ title: t, due: dueIn(16), fromGap: null, note: '来自主路径：' + decision.primary.name });
      });
    }

    // 3) 岗位信息核对（生涯人物访谈已于 v0.2 移除，改为自己核对岗位库里的工作内容分配）
    if (match && match.ranked[0]) {
      push({
        title: '核对「' + match.ranked[0].name + '」的日常工作内容，判断自己是否愿意长期做这些事',
        due: dueIn(4),
        fromGap: null,
        note: '该岗位的工作内容时间分配见报告的「职业简表」一节，或结果页岗位画像。如有条件，向真实从业者求证会更好。'
      });
    }

    return out;
  };

  /**
   * SWOT 四象限：由测评数据半自动填充，用户可再编辑。
   */
  CP.draftSWOT = function (score, match, decision) {
    var ability = Object.keys(score.ability.dims).map(function (k) {
      return { id: k, label: score.ability.dims[k].label, score: score.ability.dims[k].score };
    }).filter(function (x) { return x.score !== null; }).sort(function (a, b) { return b.score - a.score; });

    var topJob = match.ranked[0];
    var drags = topJob ? topJob.drags : [];

    var strengths = ability.slice(0, 2).map(function (a) {
      return a.label + '（自评 ' + a.score + ' 分）是你相对扎实的基础。';
    });
    if (score.holland.top.length) {
      strengths.push('兴趣集中在 ' + score.holland.code + '，与 ' + (topJob ? topJob.name : '目标岗位') + ' 的方向一致。');
    }
    if (score.anchorTop.primary) {
      strengths.push('职业锚为「' + score.anchorTop.primary.label + '」，动机来源清晰，不容易被外界带偏。');
    }

    var weaknesses = [];
    var isFresh = score.abilityGrade === 'fresh';
    if (isFresh) {
      // 大一：这一栏叫"待补"，不叫"短板"——用"没学过"当劣势是不准确的
      ability.slice(-2).reverse().forEach(function (a) {
        weaknesses.push(a.label + '（清单得分 ' + a.score + ' 分）：还有多项没勾上，属于尚未开始，不是做不到。');
      });
      ability.slice(0, 2).forEach(function (a) {
        weaknesses.push('即使是相对领先的 ' + a.label + '，也还停在清单靠前的几项，需要一次真实项目的检验。');
      });
    } else {
      ability.slice(-2).reverse().forEach(function (a) {
        weaknesses.push(a.label + '（清单得分 ' + a.score + ' 分）是当前最明显的短板：清单里还有多项没勾上。');
      });
      drags.forEach(function (d) {
        weaknesses.push('距离「' + (topJob ? topJob.name : '目标岗位') + '」的要求，'
          + d.label + ' 还差 ' + CP.round(d.gap, 1) + ' 分。');
      });
    }

    var opportunities = [];
    if (topJob) {
      opportunities.push('「' + topJob.name + '」在 ' + topJob.family + ' 中仍处于需求上升期（' + topJob.salaryBand + '）。');
    }
    if (decision && decision.primary) {
      opportunities.push('主路径「' + decision.primary.name + '」与你当前的最重要标准「' + decision.topCriterionLabel + '」方向一致。');
    }
    opportunities.push('AI 应用层的工程岗位对学历要求相对宽松，本科背景可通过作品集弥补。');
    if (isFresh) {
      opportunities.push('你还有约 3 年时间：现在开始按兴趣方向积累，到求职时足以形成一份能拿得出手的作品集。');
    }

    var threats = [];
    if (topJob && topJob.risks) threats.push(topJob.risks);
    if (match.ambiguous) {
      threats.push('前两名岗位适配度仅相差 ' + match.margin + ' 分，说明你的优势不够聚焦，选择任一都不是决定性优势。');
    }
    threats.push('AI 技术迭代快，若不成体系地跟进，容易陷入"学了很多但都不深"的状态。');
    if (isFresh) {
      threats.push('最大的风险不是现在能力弱，而是三年里一直"只上课不动手"——到毕业时仍然没有一件能演示的作品。');
    }

    return { strengths: strengths, weaknesses: weaknesses, opportunities: opportunities, threats: threats };
  };

  /** 一键生成完整结果快照，写入 archive.computed。 */
  CP.buildResult = function (archive) {
    var score = CP.scoreAll(archive);
    var match = CP.matchJobs(archive, score);
    var decision = CP.decidePaths(archive);
    var topInterest = (match.ranked[0] ? (CP.getJob(match.ranked[0].jobId) || {}).interest : {}) || {};
    var gaps = CP.gapTasks(match, 3, score, topInterest);
    var swot = CP.draftSWOT(score, match, decision);
    return {
      generatedAt: new Date().toISOString(),
      score: score,
      match: match,
      decision: decision,
      gaps: gaps,
      swot: swot,
      missing: CP.validateArchive(archive)
    };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
