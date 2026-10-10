/*!
 * 界面/存储.js — localStorage 存档、JSON 导入导出
 * 数据只存在本机浏览器里，不上传任何服务器。
 */
(function (root) {
  'use strict';
  var CP = (root.CP = root.CP || {});

  /**
   * localStorage 键。
   *
   * 为什么要带上站点路径：GitHub Pages 上 `用户名.github.io` 下的**所有项目
   * 共用同一个 origin**，而 localStorage 按 origin 隔离、不按路径隔离。
   * 键名固定的话，两个项目会互相覆盖档案——A 项目的进度跑进 B 项目，还没有任何提示。
   *
   * **只在 HTTP(S) 下分区**，file:// 保持原来的键：
   *   · file:// 下每个本地文件夹本来就是互相独立的，不需要分区；
   *     而且 pathname 里是真实目录名，用户把文件夹改名或搬到别处就会"丢失进度"，
   *     那是纯粹的自伤。
   *   · HTTP 下取 pathname 去掉文件名后的最后一段（子目录部署时即仓库名）：
   *       /career-workbench/工作台.html → career-workbench/…
   *       /工作台.html（用户根部署）    → 不加前缀（本身已是独立站点）
   */
  function storageKey() {
    var BASE = 'ai-career-workbench/archive/v1';
    try {
      var loc = root.location || {};
      var proto = loc.protocol || '';
      if (proto !== 'http:' && proto !== 'https:') return BASE;
      var segs = String(loc.pathname || '').split('/').filter(Boolean);
      segs.pop();                          // 去掉文件名那一段
      var seg = (segs.length && segs[segs.length - 1]) || '';
      if (!seg) return BASE;
      return encodeURIComponent(seg) + '/' + BASE;
    } catch (e) {
      return BASE;                         // 拿不到 location 时退化为原键
    }
  }

  var KEY = storageKey();
  var TIMER = null;

  CP.store = {
    load: function () {
      try {
        var raw = localStorage.getItem(KEY);
        if (!raw) return null;
        return CP.migrate(JSON.parse(raw));
      } catch (e) {
        console.error('读取存档失败', e);
        return null;
      }
    },

    save: function (archive) {
      try {
        archive.updatedAt = new Date().toISOString();
        localStorage.setItem(KEY, JSON.stringify(archive));
        return true;
      } catch (e) {
        console.error('保存失败', e);
        return false;
      }
    },

    /** 防抖保存：测评作答时每题都会触发，避免频繁写盘。 */
    saveSoon: function (archive, delay) {
      if (TIMER) clearTimeout(TIMER);
      TIMER = setTimeout(function () {
        TIMER = null;
        CP.store.save(archive);
        CP.ui.refreshProgress();
      }, delay == null ? 400 : delay);
    },

    clear: function () {
      try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
    }
  };

  /**
   * 版本迁移与补全：保证旧存档缺少的新字段被填上默认值。
   * 旧版把城市/时长放在 profile、访谈用 points、复盘用 progress/gap/adjust，
   * 这里统一搬到新结构上，旧档案不会因为改版而失效。
   */
  /**
   * 示例档案作答时间戳的基准（毫秒）。
   *
   * 为什么不能用固定常数：写死 1700000000000（= 2023-11-15）会让示例档案里
   * 存着一个两三年前的"作答时间"。档案导出给老师看时，这不是"示例数据"，
   * 而是一条假的时间记录。
   *
   * 为什么必须缓存：某次作答的时间戳是 `基准 + i * 6000`（每题间隔 6 秒，模拟正常速度）。
   * 如果每次都取 `Date.now()`，同一份档案内不同块会落在不同的当前时刻上，
   * 与 i*6000 叠加后可能产生负的间隔或荒谬的时长。
   * 缓存成惰性值，保证**同一次生成**内所有时间戳共用一个基准。
   */
  var demoBase = null;
  CP.demoBaseTime = function () {
    if (demoBase === null) demoBase = Date.now();
    return demoBase;
  };

  /**
   * 旧版能力自评（1-4 档 Likert）→ 新版「行为清单」勾选。
   *
   * 映射思路：先把旧档位换算成 0-100 分，再据此决定"勾上前几项"——
   * 因为清单是按由易到难排的阶梯，"勾前 n 项"就等价于"做到第 n 档"。
   * 这样旧档案的能力分不会突变，也不会因为改版而全部归零。
   *
   * @returns {Object} 新版 answers.ability
   */
  function migrateAbility(obj, a) {
    var src = (obj.answers && obj.answers.ability) || {};
    var ids = Object.keys(src);
    if (!ids.length) return {};

    // 已经是新版（勾选式，值恒为 1 且与当前清单题号对得上）就不转
    var allOne = ids.every(function (k) { return src[k] && src[k].v === 1; });
    if (allOne) return src;

    var isFreshOld = a.profile.grade === '大一';
    var items = CP.activeItems(CP.BANKS.ability, a.profile);
    var out = {};

    /**
     * 旧档位 → 目标分。
     * 旧量表的第 1 档是"没有相关经历 / 完全没接触过"，但新清单的第 1 项门槛
     * 刻意很低（"我知道这个说法"）。所以这里给一个 base：旧第 1 档对应新清单
     * 的"只勾第 1 项"，而不是"一项都不勾"——否则旧档案迁移后能力分会被凭空
     * 压到 0，等于改版顺手把学生的分数改低了。
     */
    var base = isFreshOld ? 14 : 12;   // 恰好等于两套清单第 1 项的权重
    function oldNorm(raw) {
      var r = Math.max(1, Math.min(4, raw));
      return base + (r - 1) / 3 * (100 - base);
    }

    // 每个维度取该维对应题目的旧档位均值
    var byDim = {};
    items.forEach(function (it) {
      var rec = src[it.id];
      if (!rec || rec.v == null) return;
      (byDim[it.dim] = byDim[it.dim] || []).push(rec.v);
    });

    CP.BANKS.ability.dimensions.forEach(function (d) {
      var vals = byDim[d.id];
      if (!vals || !vals.length) return;
      var target = oldNorm(vals.reduce(function (s, v) { return s + v; }, 0) / vals.length);
      var rows = items.filter(function (x) { return x.dim === d.id; });
      var total = rows.reduce(function (s, x) { return s + x.weight; }, 0);
      var acc = 0;
      rows.forEach(function (x, i) {
        // 第 1 项无条件勾上；之后只要"加上这一项"不会超过目标分就继续勾
        var after = total > 0 ? (acc + x.weight) / total * 100 : 100;
        if (i > 0 && after > target) return;
        out[x.id] = { v: 1, t: CP.demoBaseTime() };
        acc += x.weight;
      });
    });
    return out;
  }

  CP.migrate = function (obj) {
    var blank = CP.createBlankArchive();
    if (!obj || typeof obj !== 'object') return blank;

    var a = blank;
    ['createdAt', 'updatedAt', 'schemaVersion'].forEach(function (k) {
      if (obj[k]) a[k] = obj[k];
    });

    // profile：只保留四个字段，并做取值校验
    Object.keys(blank.profile).forEach(function (k) {
      if (obj.profile && obj.profile[k] !== undefined) a.profile[k] = obj.profile[k];
    });
    if (a.profile.grade === '大一') a.profile.gpaBand = '';   // 大一没有 GPA 档位

    // answers
    Object.keys(blank.answers).forEach(function (k) {
      a.answers[k] = (obj.answers && obj.answers[k]) || {};
    });

    // 能力证据（v0.3 新增）
    a.abilityEvidence = (obj.abilityEvidence && typeof obj.abilityEvidence === 'object')
      ? obj.abilityEvidence : {};

    // 能力部分：v0.2 及以前是 1-4 档自评（大一 4 档 + 15 分底，高年级 4 档），
    // v0.3 起改为「行为清单」勾选式。旧作答按"档位 → 分数 → 勾前几项"映射过来，
    // 保证旧档案仍能打开并给出合理的能力分，而不是全部归零。
    a.answers.ability = migrateAbility(obj, a);

    // decision
    var d = obj.decision || {};
    a.decision.jobPref = d.jobPref || {};
    a.decision.criteriaOrder = d.criteriaOrder || [];
    a.decision.pathScores = d.pathScores || {};
    a.decision.targetCities = d.targetCities || [];
    // 兼容旧结构：cities / hoursPerWeek 曾在 profile 下
    if (!a.decision.targetCities.length && obj.profile && Array.isArray(obj.profile.cities)) {
      a.decision.targetCities = obj.profile.cities.filter(function (c) { return c !== '不限'; });
    }
    a.decision.hoursPerWeek = (d.hoursPerWeek != null) ? d.hoursPerWeek
      : (obj.profile && obj.profile.hoursPerWeek != null ? obj.profile.hoursPerWeek : null);

    // interviews 字段已于 v0.2 移除；旧档案里的访谈记录直接丢弃（如需保留请写进报告正文）
    delete a.interviews;

    a.actions = Array.isArray(obj.actions) ? obj.actions : [];

    // 长远打算已于 v1.3.0 改为系统生成的逐年建议，不再存进档案
    delete a.longTermPlan;

    // reviews：旧结构 progress/gap/adjust → 新结构计数 + 事实
    a.reviews = (Array.isArray(obj.reviews) ? obj.reviews : []).map(function (r) {
      return {
        date: r.date || '',
        type: r.type || '周',
        planned: r.planned == null ? null : r.planned,
        done: r.done == null ? null : r.done,
        overdue: r.overdue == null ? null : r.overdue,
        evidence: r.evidence || '',
        next: r.next || r.adjust || ''
      };
    });

    a.computed = null;
    a.schemaVersion = CP.SCHEMA_VERSION;
    return a;
  };

  /* ---------------- 文件导入导出 ---------------- */

  CP.file = {
    download: function (filename, text, mime) {
      var blob = new Blob([text], { type: (mime || 'application/json') + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    },

    readText: function (file) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () { resolve(String(r.result)); };
        r.onerror = function () { reject(new Error('文件读取失败')); };
        r.readAsText(file, 'utf-8');
      });
    },

    stamp: function () {
      var d = new Date();
      function p(n) { return n < 10 ? '0' + n : String(n); }
      return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
    }
  };

  /* ---------------- 示例档案 ---------------- */

  /**
   * 示例档案：一位"偏产品与沟通、想读研但纠结"的大三学生。
   * 目的是让用户先看清"填完之后是什么样"。
   */
  /**
   * 示例档案用的"真实作答起伏"。
   *
   * 为什么不能每维给同一个值：那样标准差为 0，会被一致性检验判为"直线作答"，
   * 示例档案一打开就顶着一屏数据质量告警——既不像真实填答，也掩盖了真正的问题。
   * 这里按索引在基准值上下摆动，**均值保持不变**，所以维度分不变。
   * @param {number} base 基准档位
   * @param {number} i    题目在块内的序号
   */
  var JITTER = [0, -1, 1, 0, 0, -1, 1, 0];
  function jitter(base, i) {
    var v = base + JITTER[i % JITTER.length];
    return Math.max(1, Math.min(5, v));
  }

  /**
   * 勾选式题库的填法：某维度勾上"前 n 项"。
   * 清单是按由易到难排的阶梯，所以"勾前 n 项"等价于"做到第 n 档"。
   * @param {Object} a 档案
   * @param {string} blockId 'ability'
   * @param {Object} byDim { dimId: 勾选数 }
   */
  function putChecklist(a, blockId, byDim) {
    var count = {};
    CP.activeItems(CP.BANKS[blockId], a.profile).forEach(function (it, i) {
      count[it.dim] = (count[it.dim] || 0) + 1;
      if (count[it.dim] <= (byDim[it.dim] || 0)) {
        a.answers[blockId][it.id] = { v: 1, t: CP.demoBaseTime() + i * 6000 };
      }
    });
  }

  CP.demoArchive = function () {
    var a = CP.createBlankArchive();
    a.profile.grade = '大三';
    a.profile.track = '人工智能';
    a.profile.gpaBand = '10-30%';
    a.profile.acceptPostgrad = '接受';

    function put(blockId, fn) {
      CP.activeItems(CP.BANKS[blockId], a.profile).forEach(function (it, i) {
        a.answers[blockId][it.id] = { v: fn(it, i), t: CP.demoBaseTime() + i * 6000 };
      });
    }
    // 兴趣：I 高，E/S 中高，C 中，R/A 低（叠加小幅起伏，避免被一致性检验判为直线作答）
    var ri = { I: 5, E: 4, S: 4, C: 3, R: 2, A: 2 };
    put('riasec', function (it, i) { var v = jitter(ri[it.dim], i); return it.reverse ? 6 - v : v; });
    // 职业锚：GM 主，EC 副，TF 中
    var an = { GM: 5, EC: 4, TF: 3, CH: 3, LS: 3, SV: 2, AU: 2, SE: 2 };
    put('anchor', function (it, i) { var v = jitter(an[it.dim], i); return it.reverse ? 6 - v : v; });
    // 能力：产品/沟通/数据较强，部署最弱。数值 = 该维勾上前几项
    var ab = { product: 4, comm: 4, self: 3, data: 3, model: 2, math: 2, code: 2, deploy: 1 };
    putChecklist(a, 'ability', ab);

    a.decision.jobPref = {
      'ai-pm': 'like', 'llm-app-engineer': 'like', 'ai-solution': 'like',
      'data-scientist': 'neutral', 'algo-research': 'neutral', 'ai-governance': 'exclude'
    };
    a.decision.criteriaOrder = ['interest', 'growth', 'ability', 'salary', 'location', 'balance'];
    a.decision.pathScores = {
      'p-考研转行业': { interest: 5, growth: 4, ability: 3, salary: 3, location: 3, balance: 3 }
    };
    a.decision.targetCities = ['杭州', '上海'];
    a.decision.hoursPerWeek = 10;

    // 示例的日期都按"相对今天"生成，不写死。
    // 写死会让示例的逾期状态随真实时间漂移：今天是 2026 年时它看着正常，
    // 换成 2027 年打开，全表任务都成了严重逾期，示例反而误导人。
    // 起点取 8 天前：最短的任务（4 周）还没到期，示例看起来是"正在推进"而不是"全面逾期"。
    var startISO = CP.dateOnly(new Date(Date.now() - 8 * 24 * 3600 * 1000));
    var lastWeek = CP.dateOnly(new Date(Date.now() - 7 * 24 * 3600 * 1000));

    a.reviews = [
      {
        date: lastWeek, type: '周', planned: 5, done: 3, overdue: 1,
        evidence: '完成了 2 个岗位的信息收集；RAG 入门教程跟做了一半',
        next: '把 RAG 的检索部分跑通，并把项目代码推到 GitHub'
      }
    ];
    a.computed = CP.buildResult(a);
    a.actions = CP.draftActions(a, a.computed.score, a.computed.match, a.computed.decision, startISO);
    return a;
  };

  /**
   * 大一示例档案：用来演示"以兴趣定方向"的那套口径。
   * 两个示例档案并存，是因为大一的正确输出形态与其他年级差别很大。
   */
  CP.demoArchiveFresh = function () {
    var a = CP.createBlankArchive();
    a.profile.grade = '大一';
    a.profile.track = '人工智能';
    a.profile.gpaBand = '';
    a.profile.acceptPostgrad = '未定';

    function put(blockId, fn) {
      CP.activeItems(CP.BANKS[blockId], a.profile).forEach(function (it, i) {
        a.answers[blockId][it.id] = { v: fn(it, i), t: CP.demoBaseTime() + i * 6000 };
      });
    }
    // 兴趣：I 很高，C 次之，E 中，R/A/S 低（同样叠加起伏）
    var ri = { I: 5, C: 4, E: 3, R: 2, A: 2, S: 2 };
    put('riasec', function (it, i) { var v = jitter(ri[it.dim], i); return it.reverse ? 6 - v : v; });
    // 职业锚：CH 主，TF 副
    var an = { CH: 5, TF: 4, LS: 3, AU: 3, EC: 2, SV: 2, GM: 2, SE: 2 };
    put('anchor', function (it, i) { var v = jitter(an[it.dim], i); return it.reverse ? 6 - v : v; });
    // 能力：大一版清单 —— 每维勾上前若干项，表示"接触到哪一档"
    // 勾选数由目标程度决定：3 = 勾前 3 项（跟做过），2 = 勾前 2 项（听过）
    var abFresh = { math: 3, code: 3, data: 2, model: 2, deploy: 1, product: 2, comm: 3, self: 4 };
    putChecklist(a, 'ability', abFresh);

    a.decision.jobPref = {
      'algo-research': 'like', 'nlp-engineer': 'like', 'cv-engineer': 'neutral',
      'data-scientist': 'neutral', 'ai-pm': 'exclude'
    };
    a.decision.criteriaOrder = ['interest', 'growth', 'ability', 'salary', 'balance', 'location'];
    a.decision.targetCities = [];
    a.decision.hoursPerWeek = 12;
    a.computed = CP.buildResult(a);
    // 同样用相对日期：大一示例定在"两周前开始"，任务都还在进行中
    var freshStart = CP.dateOnly(new Date(Date.now() - 14 * 24 * 3600 * 1000));
    a.actions = CP.draftActions(a, a.computed.score, a.computed.match, a.computed.decision, freshStart);
    return a;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
