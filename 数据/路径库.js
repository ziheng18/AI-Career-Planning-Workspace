/*!
 * 路径库 — 候选生涯路径模板
 *
 * 设计原则：路径的默认评分只是"起点"，用户可以逐项修改。
 * 最终得分 = Σ(用户评分/5 × 100 × 权重)，权重来自 决策标准排序。
 * 这样用户的排序与打分真正决定结果，而不是被预置值支配。
 *
 * relatedJobs : 该路径通向的岗位族（用于把岗位匹配与路径决策串起来）
 * milestones  : 三阶段时间轴骨架，用户可编辑后写入行动计划
 */
(function (root) {
  'use strict';
  var CP = (root.CP = root.CP || {});

  CP.PATHS = [
    {
      id: 'p-baoyan',
      name: '保研 / 考研后进大厂算法岗',
      summary: '本科阶段以绩点和科研产出为核心，读研期间做算法研究，毕业后进入大厂算法或研究团队。',
      relatedJobs: ['algo-research', 'nlp-engineer', 'cv-engineer'],
      defaults: { interest: 4, ability: 4, growth: 5, salary: 4, location: 3, balance: 2 },
      risks: '周期长（本科+硕士 3 年）；科研产出有不确定性；读研方向若与就业市场错位会浪费两年。',
      milestones: {
        term: ['把核心课绩点提到保研线以上', '进入一个实验室做长期课题', '完成一次完整的论文复现'],
        oneYear: ['有一篇在投/已发表的论文或一项专利', '确定细分方向（NLP/CV/多模态）', '完成一次实习投递并拿到面试机会'],
        threeYear: ['硕士毕业并拿到算法岗 offer', '形成个人技术标签与作品集'],
        fiveYear: ['成为某细分方向的资深算法工程师', '开始带小规模课题或实习生的能力']
      }
    },
    {
      id: 'p-直接就业',
      name: '本科直接就业做 AI 应用开发',
      summary: '不读研，用工程能力和项目作品集直接进入大模型应用、AI 工程或后端+AI 的岗位。',
      relatedJobs: ['llm-app-engineer', 'mle', 'ai-engineer-infra'],
      defaults: { interest: 4, ability: 3, growth: 4, salary: 3, location: 4, balance: 3 },
      risks: '部分算法岗有学历门槛，直接就业可能被挡在门外；需要作品集足够硬来弥补学历劣势。',
      milestones: {
        term: ['完成 2 个可展示的完整项目（含部署与文档）', '把 GitHub 主页整理成作品集', '刷完一轮技术面试高频题'],
        oneYear: ['拿到一段有含金量的实习', '确定工程方向（应用/基础设施/MLE）', '投递并进入面试流程'],
        threeYear: ['成为能独立负责模块的工程师', '在某类系统上有深度经验'],
        fiveYear: ['高级工程师或小团队技术负责人', '具备跨端到端交付能力']
      }
    },
    {
      id: 'p-考研转行业',
      name: '跨考 / 考研转向 AI+行业方向',
      summary: '读研时选择 AI 与医疗、能源、制造、金融等具体行业结合的课题，走"技术+行业"复合路线。',
      relatedJobs: ['data-scientist', 'ai-solution', 'ai-governance'],
      defaults: { interest: 4, ability: 3, growth: 4, salary: 3, location: 3, balance: 3 },
      risks: '行业知识需要额外补课；跨方向课题的导师资源不一定好找；行业内 AI 岗位密度低于互联网。',
      milestones: {
        term: ['选定 1-2 个目标行业并读行业报告', '找到对应方向的导师或课题', '学习该行业的基础业务知识'],
        oneYear: ['完成一个行业数据的真实分析或建模项目', '访谈 3 位行业内的从业者'],
        threeYear: ['硕士毕业进入该行业的 AI 部门', '形成"技术+行业"的双重标签'],
        fiveYear: ['成为该行业里懂 AI 的稀缺角色', '可参与业务决策而非只做实现']
      }
    },
    {
      id: 'p-考公',
      name: '考公 / 事业单位信息化技术岗',
      summary: '进入体制内做数字化、数据分析、网信或技术支撑类岗位，追求稳定与生活确定性。',
      relatedJobs: ['ai-governance', 'data-scientist'],
      defaults: { interest: 2, ability: 2, growth: 2, salary: 2, location: 2, balance: 5 },
      risks: '技术成长速度明显放缓；竞争极其激烈，备考周期长且结果不确定；岗位专业匹配度不一。',
      milestones: {
        term: ['确认目标地区与岗位专业目录要求', '开始行测与申论的长期积累', '保留一项技术能力不掉队'],
        oneYear: ['完成一次真实报考（积累经验）', '技术侧保持一个副业或开源项目'],
        threeYear: ['上岸并适应体制内工作节奏', '在单位内找到技术+业务的结合点'],
        fiveYear: ['成为单位内不可替代的技术骨干', '生活节奏与个人规划基本稳定']
      }
    },
    {
      id: 'p-出国',
      name: '出国读研走研究路线',
      summary: '申请海外硕士或博士，以研究能力为核心积累，长期目标为科研或海外工业界研究岗。',
      relatedJobs: ['algo-research', 'nlp-engineer'],
      defaults: { interest: 4, ability: 4, growth: 5, salary: 4, location: 2, balance: 3 },
      risks: '经济成本高、周期长；签证与地缘政治不确定性；回国就业时需重新建立人脉网络。',
      milestones: {
        term: ['确定目标国家与项目层次', '准备语言成绩与科研经历', '联系推荐人并维护科研关系'],
        oneYear: ['完成申请并拿到录取', '确定研究方向的初步兴趣点'],
        threeYear: ['完成核心研究工作并发表成果', '建立国际学术网络'],
        fiveYear: ['进入科研机构或海外工业界研究岗', '形成独立的研究判断力']
      }
    },
    {
      id: 'p-创业',
      name: 'AI 应用创业 / 加入早期团队',
      summary: '以快速试错的方式做自己的 AI 产品或加入早期创业团队，追求杠杆与自主性。',
      relatedJobs: ['llm-app-engineer', 'ai-pm', 'ai-solution'],
      defaults: { interest: 4, ability: 3, growth: 5, salary: 2, location: 4, balance: 2 },
      risks: '失败概率高、收入不稳定；应届生缺乏行业资源与判断力，容易踩坑；需要家庭风险承受力。',
      milestones: {
        term: ['做出 1 个能真实使用的小产品并获取用户反馈', '学习基础的产品与增长方法', '找到 1-2 位可长期协作的伙伴'],
        oneYear: ['产品有稳定留存或付费用户', '加入一个早期团队积累实战', '建立行业人脉'],
        threeYear: ['要么项目跑通并拿到融资，要么带着经验转入成熟公司'],
        fiveYear: ['具备独立定义并带领一件事做成 0→1 的能力']
      }
    }
  ];

  CP.getPath = function (id) {
    for (var i = 0; i < CP.PATHS.length; i++) {
      if (CP.PATHS[i].id === id) return CP.PATHS[i];
    }
    return null;
  };

  /** 取某路径在某标准上的评分：用户覆盖值优先，否则用默认值。 */
  CP.pathScore = function (archive, pathId, criterionId) {
    var override = (archive.decision.pathScores[pathId] || {})[criterionId];
    if (typeof override === 'number') return override;
    var p = CP.getPath(pathId);
    return p && p.defaults[criterionId] != null ? p.defaults[criterionId] : 3;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
