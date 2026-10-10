/*!
 * 数据契约（Data Contract）— 全工作台唯一真相来源
 *
 * 所有模块（测评、计分、匹配、导出）都以本文件定义的档案结构为公约数。
 * 修改本文件必须先改 文档/数据字典.md，并同步 测试/契约.test.js。
 *
 * 运行环境：浏览器(file://直接打开) 与 Node 双兼容，不依赖 ES Module。
 */
(function (root) {
  'use strict';

  var CP = (root.CP = root.CP || {});

  /**
   * 契约版本。结构不兼容变更时必须递增，导出的存档会带此字段。
   *
   * 1.1.0：能力部分从 1–4 档 Likert 自评改为「行为清单」勾选式，
   *        并新增 abilityEvidence 字段。旧档案由 CP.migrate 换算，见 界面/存储.js。
   * 1.2.0：新增 longTermPlan（一段叙述式的长远打算，不是条目）。
   *        兼容性变更：旧档案缺这个字段时补空字符串。
   * 1.3.0：长远打算改为**系统生成的逐年规划建议**（CP.yearPlan），
   *        不再存进档案，也不再由用户填写，故移除 longTermPlan 字段。
   */
  CP.SCHEMA_VERSION = '1.3.0';

  /** 存档类型标识，用于导入时校验文件身份。 */
  CP.ARCHIVE_KIND = 'ai-career-workbench/archive';

  /**
   * 创建空档案。
   * @returns {Object} 一份完整的空档案
   */
  CP.createBlankArchive = function () {
    return {
      kind: CP.ARCHIVE_KIND,
      schemaVersion: CP.SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),

      // 输入块 1：基本信息（不参与打分，仅用于门槛判断与作答口径）
      profile: {
        grade: '',              // 年级：'大一'|'大二'|'大三'|'大四'|'研一'|'研二'|'研三'
        track: '',              // 专业方向：'人工智能'|'智能科学与技术'|'计算机'|'自动化'|'其他'
        gpaBand: '',            // GPA 档位：'前10%'|'10-30%'|'30-60%'|'后40%'|'暂无（大一未评定）'
        acceptPostgrad: ''      // 是否接受读研：'接受'|'不接受'|'未定'（唯一参与计算的信息）
      },

      // 各测评块的作答记录：{ blockId: { itemId: {v: 原始分, t: 毫秒时间戳} } }
      // v 的含义由题库的 scale 决定：
      //   兴趣 / 职业锚 —— Likert 原始分（1-5），反向题在计分层处理
      //   能力清单     —— 勾选式，v = 1 表示勾上；未勾则不写入该题
      // 能力清单的题目与权重随年级切换：大一一套、大二及以上一套，见 数据/题库.js。
      answers: {
        riasec: {},
        anchor: {},
        ability: {},
        prefer: {}
      },

      // 能力证据（可选）：每个能力维度可挂一条最代表性的证据。
      // 用途：报告里标记「已印证 / 仅自评」，并作为作品集台账的素材。
      // 不填也能出结果——硬性要求证据会让执行率崩掉（同访谈被移除的理由）。
      abilityEvidence: {
        // math: '线性代数 92 分；用 NumPy 手写过反向传播',
        // code: 'https://github.com/xxx/course-project'
      },

      // 决策输入（主观判断集中在这里，全部为可选项或可量化项）
      decision: {
        jobPref: {},            // { jobId: 'like'|'neutral'|'exclude' }
        // 6 项决策标准的排序结果，索引 0 为最重要。值为 criterion id。
        criteriaOrder: [],
        // 候选路径评分 { pathId: { criterionId: 0-5 } }；未填写的项用路径库默认值。
        pathScores: {},
        // 期望工作城市。仅作展示与自我提示，不参与任何筛选或计算。
        targetCities: [],
        // 每周可投入学习时长（小时，数字）。用于把能力缺口换算成排期周数。
        hoursPerWeek: null
      },

      // 生涯人物访谈已于 v0.2 移除：访谈的时间成本高、且学生不一定能找到合适的人，
      // 不适合作为一项必做作业。它原本承担的两个作用改由岗位库承担：
      //   ① "这份工作实际在做什么" → 岗位库的 duties + workMix（工作内容时间分配）
      //   ② "实际代价" → 岗位库的 risks + workMix
      // 如果确实做了访谈，请写进报告正文，不要再往工作台里填。

      // 逐年规划建议**不进档案**：它是系统按"年级 + 主路径"算出来的建议，
      // 不是用户填的内容，所以由 CP.yearPlan 每次实时生成，见 逻辑/建议.js。

      // 行动计划看板
      actions: [        // { id, title, due: 'YYYY-MM-DD', status: 'todo'|'doing'|'done',
        //   evidence: '', fromGap: 'ability.math'|null }
      ],

      // 复盘记录（只记可核对的事实与下一步，不做感想式描述）
      reviews: [
        // { date: 'YYYY-MM-DD', type: '周'|'月'|'里程碑',
        //   planned: 5, done: 3,        // 计划完成任务数 / 实际完成数
        //   overdue: 1,                 // 逾期未完成数
        //   evidence: '',               // 本期新增的证据链接或作品名
        //   next: '' }                  // 下周最高优先级的一件事
      ],

      // 由计算层写入的结果快照（可随时重算覆盖，不作为真相来源）
      computed: null
    };
  };

  /** 六个决策标准。与 数据/路径库.js 的默认评分键一一对应。 */
  CP.CRITERIA = [
    { id: 'interest', label: '兴趣匹配', hint: '这份工作做的事，我是否真的喜欢' },
    { id: 'ability', label: '能力匹配', hint: '我现有的能力能否够得着' },
    { id: 'growth', label: '成长空间', hint: '3 年后我的能力和身价是否显著提升' },
    { id: 'salary', label: '薪酬回报', hint: '起薪与长期收入水平' },
    { id: 'location', label: '地域适配', hint: '城市是否可接受、离家远近' },
    { id: 'balance', label: '工作生活平衡', hint: '强度、加班、可支配时间' }
  ];

  /**
   * 适配度权重随年级切换。
   *
   * 大一：以兴趣为主（兴趣 0.65）。理由是距离求职还有约 3 年，
   *       能力项此时自评普遍是"没接触"，拿它主导排序会得出"你什么都不适合"，
   *       既不准也没用；而兴趣相对稳定，且大一最该做的事是**顺着兴趣把方向定下来**。
   *       能力权重降到 0.22 只作参考，锚对齐 0.13 作方向微调。
   * 其他年级：能力 0.45 为主，因为它可改变、且招聘实际卡的就是它。
   */
  CP.fitWeightsFor = function (profile) {
    if (profile && profile.grade === '大一') {
      return { interest: 0.65, ability: 0.22, anchor: 0.13 };
    }
    return { interest: 0.40, ability: 0.45, anchor: 0.15 };
  };

  /* ---------------- 通用工具 ----------------
   * 放在数据层而不是界面层：导出层要用到它们，
   * 而"导出报告"不应该依赖"界面渲染"（否则离线生成报告就得先加载整套 UI）。
   */

  /** HTML 转义 */
  CP.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  /** 数值格式化；null/undefined/NaN 统一显示为 — */
  CP.fmt = function (n, digits) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toFixed(digits == null ? 1 : digits);
  };

  /** 工作内容分类（四项）。与 数据/岗位库.js 的 job.workMix 键一一对应。
   *  报告用它把岗位的"一周时间花在哪"讲清楚，替代了原先的从业者访谈。 */
  CP.DUTY_KEYS = [
    { k: 'code', label: '写代码 / 做技术' },
    { k: 'meeting', label: '开会 / 对齐' },
    { k: 'doc', label: '写文档 / 报告' },
    { k: 'comm', label: '沟通协调' }
  ];

  /**
   * 各测评块的"完成门槛"。
   *
   * 为什么需要它：能力清单是**勾选式**——它问的是"你现在能做到哪些"，
   * 不是"把 48 项答完"。所以对能力块来说，"全勾"既不是目标也不是常见情况，
   * 只是最积极的一种结果。要求和兴趣/职业锚一样"答满才算完成"是错的：
   * 那会让一个诚实地只勾了十几项的学生，侧边栏永远显示未完成。
   *
   *   兴趣 / 职业锚：Likert 题，每道都要表态 → 门槛 = 题目总数。
   *   能力清单：门槛 = 每个维度至少勾 1 项（相当于"8 个维度都看过了"）。
   *             只勾 1 项就够，因为清单本身的设计意图就是能勾多少勾多少。
   *
   * 门槛达成即视为"这一块完成"；实际勾选数仍会显示出来，不做隐藏。
   *
   * @returns {{done:number, threshold:number, total:number, reached:boolean}}
   */
  CP.blockProgress = function (blockId, archive) {
    var bank = CP.BANKS[blockId];
    var profile = archive && archive.profile;
    var items = CP.activeItems(bank, profile);
    var answered = (archive && archive.answers && archive.answers[blockId]) || {};
    var checked = Object.keys(answered).length;

    if (blockId === 'ability') {
      // 门槛：每个维度至少勾 1 项
      var byDim = {};
      items.forEach(function (it) { byDim[it.dim] = 1; });
      var dimsTotal = Object.keys(byDim).length;
      var dimsTouched = 0;
      Object.keys(byDim).forEach(function (d) {
        var hit = items.some(function (it) { return it.dim === d && answered[it.id] !== undefined; });
        if (hit) dimsTouched += 1;
      });
      return {
        done: checked, threshold: dimsTotal, total: items.length,
        reached: dimsTouched >= dimsTotal
      };
    }

    return { done: checked, threshold: items.length, total: items.length, reached: checked >= items.length };
  };

  /**
   * 取"本地日期"的 YYYY-MM-DD。
   *
   * 为什么不用 `new Date().toISOString().slice(0, 10)`：
   *   toISOString 转的是 **UTC**。在东八区，本地 00:00–08:00 之间 UTC 还停在前一天，
   *   于是"今天"会被算成昨天——当天到期的任务会被误判为逾期。
   *   这里按**本地时区**取年月日，与页面上用的 toLocaleString 口径一致。
   *
   * @param {Date} [d] 缺省为当前时间
   * @returns {string} 形如 2026-10-10
   */
  CP.dateOnly = function (d) {
    var x = d || new Date();
    var m = x.getMonth() + 1, day = x.getDate();
    return x.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  };

  /**
   * 把 YYYY-MM-DD 按**本地时区**解析成 Date。
   * `new Date('2026-03-20')` 会按 UTC 零点解析，东八区下等于前一天早上 8 点，
   * 再加 N 周得到的截止日会整体偏一天。这里显式按本地时间构造。
   */
  CP.parseDateOnly = function (s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return new Date();
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };

  /**
   * 把档案里的 ISO 时刻（UTC）格式化成本地时间字符串。
   *
   * 为什么必须走这一步：档案按惯例用 `toISOString()` 存 UTC，而界面要显示的是
   * 用户看到的墙上时间。直接切 ISO 串（`.slice(0,16).replace('T',' ')`）会把 UTC
   * 当本地时间显示——东八区下少 8 小时。曾经首页的"结果快照"就是这么写的。
   *
   * @param {string|number} iso ISO 串或毫秒时间戳
   * @param {string} [fallback] 取不到时的占位，默认 '—'
   */
  CP.localTime = function (iso, fallback) {
    var d = (typeof iso === 'number') ? new Date(iso) : new Date(String(iso || ''));
    if (isNaN(d.getTime())) return fallback === undefined ? '—' : fallback;
    return d.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  };

  /**
   * 该岗位当前口径下的完整题目总数（三块相加），用于进度与完整性判断。 */
  CP.totalItems = function (profile) {
    return Object.keys(CP.BANKS).reduce(function (s, k) {
      return s + CP.activeItems(CP.BANKS[k], profile).length;
    }, 0);
  };

  /**
   * 档案完整性检查：返回缺失项清单，供界面显示"还差什么"。
   *
   * 每一块都用 **CP.blockProgress 的门槛**判定，与侧边栏进度共用同一个定义。
   * 曾经这两处各写一套（校验看数量、进度看门槛），导致"校验通过但侧边栏
   * 永远显示未完成"这种自相矛盾的状态，所以现在只留一个判据。
   */
  CP.validateArchive = function (a) {
    var missing = [];
    if (!a) return ['档案为空'];

    [
      ['riasec', '兴趣测评'],
      ['anchor', '职业锚测评']
    ].forEach(function (s) {
      var bp = CP.blockProgress(s[0], a);
      if (bp.done < bp.threshold) missing.push(s[1] + '（已完成 ' + bp.done + '/' + bp.total + ' 题）');
    });

    // 能力清单：勾选式，门槛是"每个维度至少勾 1 项"，不是"48 项全勾"。
    // 另外单独检查结构——勾选项若与当前年级的清单对不上，说明年级换过而没重做。
    var bp2 = CP.blockProgress('ability', a);
    var abIds = {};
    CP.activeItems(CP.BANKS.ability, a.profile).forEach(function (it) { abIds[it.id] = 1; });
    var abAns = Object.keys(a.answers.ability || {});
    var matched = abAns.filter(function (id) { return abIds[id]; }).length;
    if (matched < abAns.length) {
      missing.push('能力清单（有 ' + (abAns.length - matched) + ' 项作答不属于当前年级的清单，请重新打开该页）');
    } else if (!bp2.reached) {
      missing.push('能力清单（还有 ' + (bp2.threshold - bp2.done) + ' 个维度一项都没勾）');
    }

    var prefN = Object.keys(a.decision.jobPref || {}).length;
    if (prefN === 0) missing.push('岗位偏好（未标记任何岗位）');

    if ((a.decision.criteriaOrder || []).length !== CP.CRITERIA.length) {
      missing.push('决策标准排序（未完成）');
    }

    if (!a.profile.grade) missing.push('基本信息');
    if (!a.decision.hoursPerWeek) missing.push('每周可投入时长');

    return missing;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
