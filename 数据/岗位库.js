/*!
 * 岗位库 — 10 个 AI 岗位族画像
 *
 * 字段说明：
 *   interest   : 该岗位对 6 类兴趣的期望水平（0-100）。f = min(用户/期望, 1)
 *   ability    : 该岗位对 8 项能力的期望水平（0-100）。gap = max(0, 期望-用户)
 *                另可给 abilityWeight 覆盖默认权重（默认 = ability 值，即要求越高权重越大）
 *   anchor     : 该岗位最契合的职业锚（1 主 + 1-2 副）
 *   minEdu     : 门槛学历。用于硬约束过滤（用户可达学历低于此值则排除）
 *   eduRank    : 学历等级映射表见 逻辑/匹配.js
 *   workMix    : 一周工作内容的时间分配（四项合计 100）。键与 CP.DUTY_KEYS 一致。
 *                这一栏原本由"生涯人物访谈"采集，现直接写进岗位库：
 *                访谈的时间成本高、且学生不一定能找到合适的人，不适合作为必做作业。
 *                它承担的作用是回答"这份工作实际在做什么"——很多人对某个岗位的
 *                想象与实际工作内容差距极大（例如以为技术岗整天写代码）。
 *
 * ⚠ 数据性质声明：下列 requirement / workMix 数值是对公开行业报告与招聘信息描述的
 *   结构化转写，属课程示例数据，不代表实时招聘行情。来源清单见 情报库/岗位来源.md。
 */
(function (root) {
  'use strict';
  var CP = (root.CP = root.CP || {});

  CP.EDU_LEVELS = ['大专', '本科', '硕士', '博士'];

  CP.JOB_FAMILIES = [
    {
      id: 'algo-research',
      name: '算法研究员',
      family: '算法研究族',
      summary: '在实验室或企业研究院做前沿算法探索，产出论文、专利或可迁移到产品的新方法。',
      duties: ['跟踪并复现前沿论文', '设计新方法并做严谨的对比实验', '撰写论文/专利/技术报告', '与工程团队协作把方法落地'],
      interest: { R: 35, I: 95, A: 45, S: 25, E: 25, C: 60 },
      ability: { math: 90, code: 70, data: 75, model: 85, deploy: 30, product: 25, comm: 65, self: 80 },
      anchor: ['CH', 'TF'],
      minEdu: '硕士',
      eduRank: 2,
      employers: ['大厂研究院（达摩院/腾讯AI Lab 等）', '高校与科研院所', 'AI 独角兽的 research 团队'],
      salaryBand: '示例区间：校招硕博 35–70 万/年（一线城市，2025 参考）',
      workMix: { code: 35, meeting: 15, doc: 40, comm: 10 },
      risks: '岗位数量少、入行门槛最高；论文产出压力大；偏研究，工程落地经验增长慢。'
    },
    {
      id: 'cv-engineer',
      name: '计算机视觉算法工程师',
      family: '算法族',
      summary: '做检测、分割、OCR、3D 视觉、视频理解等方向的算法研发与优化。',
      duties: ['视觉模型的训练、调优与压缩', '数据标注体系与数据闭环搭建', '模型精度/速度的权衡优化', '与业务方对齐指标'],
      interest: { R: 55, I: 80, A: 50, S: 25, E: 30, C: 65 },
      ability: { math: 65, code: 75, data: 70, model: 80, deploy: 55, product: 40, comm: 55, self: 70 },
      anchor: ['TF', 'CH'],
      minEdu: '本科',
      eduRank: 1,
      employers: ['安防与智能硬件公司', '自动驾驶公司', '互联网大厂视觉团队', '工业质检厂商'],
      salaryBand: '示例区间：校招本科 20–35 万/年，硕士 30–50 万/年',
      workMix: { code: 60, meeting: 15, doc: 15, comm: 10 },
      risks: '传统 CV 岗位竞争激烈且部分饱和；需持续跟进多模态方向迁移。'
    },
    {
      id: 'nlp-engineer',
      name: 'NLP / 大模型算法工程师',
      family: '算法族',
      summary: '围绕语言模型做预训练、微调、对齐、检索增强与推理优化。',
      duties: ['大模型微调与对齐（SFT/RLHF 等）', 'RAG 与 Agent 系统设计', '评测体系搭建与效果归因', '推理加速与成本控制'],
      interest: { R: 45, I: 85, A: 55, S: 35, E: 30, C: 60 },
      ability: { math: 75, code: 80, data: 75, model: 85, deploy: 55, product: 45, comm: 60, self: 75 },
      anchor: ['TF', 'CH'],
      minEdu: '硕士',
      eduRank: 2,
      employers: ['大模型公司', '互联网大厂 NLP 团队', 'AI 应用创业公司', '金融/医疗行业的 AI 部门'],
      salaryBand: '示例区间：校招硕士 30–60 万/年（头部公司更高）',
      workMix: { code: 60, meeting: 15, doc: 15, comm: 10 },
      risks: '技术迭代极快，知识半衰期短；岗位对工程能力要求也在快速抬升。'
    },
    {
      id: 'llm-app-engineer',
      name: '大模型应用工程师',
      family: '应用工程族',
      summary: '用现成模型能力搭出可用的 AI 应用，重点在工程与效果调优，不必训练模型。',
      duties: ['提示词与工作流工程', 'RAG / Agent 链路搭建与调优', '调用与编排多种模型 API', '效果评测与线上迭代'],
      interest: { R: 60, I: 65, A: 60, S: 45, E: 55, C: 55 },
      ability: { math: 40, code: 80, data: 60, model: 60, deploy: 75, product: 65, comm: 65, self: 70 },
      anchor: ['TF', 'AU'],
      minEdu: '本科',
      eduRank: 1,
      employers: ['AI 应用创业公司', '各行业的数字化/智能化部门', '互联网大厂业务线', 'AI 工具类公司'],
      salaryBand: '示例区间：校招本科 18–32 万/年',
      workMix: { code: 65, meeting: 15, doc: 12, comm: 8 },
      risks: '技术壁垒相对低、易被工具化替代；需靠业务理解与交付能力形成差异。'
    },
    {
      id: 'data-scientist',
      name: '数据科学家 / 数据分析师',
      family: '数据族',
      summary: '用统计与机器学习方法回答业务问题，产出分析结论与决策建议。',
      duties: ['业务指标拆解与归因分析', '统计建模与因果推断', 'AB 实验设计与解读', '向决策层汇报结论'],
      interest: { R: 30, I: 70, A: 35, S: 55, E: 55, C: 80 },
      ability: { math: 55, code: 60, data: 85, model: 60, deploy: 30, product: 70, comm: 75, self: 60 },
      anchor: ['TF', 'GM'],
      minEdu: '本科',
      eduRank: 1,
      employers: ['互联网大厂数据/增长团队', '金融与咨询机构', '零售与消费品牌', '各行业数据部门'],
      salaryBand: '示例区间：校招本科 18–30 万/年',
      workMix: { code: 45, meeting: 20, doc: 20, comm: 15 },
      risks: '部分岗位偏报表与取数，成长性取决于是否进入核心决策链路。'
    },
    {
      id: 'mle',
      name: '机器学习工程师（MLE）',
      family: '工程族',
      summary: '推荐、搜索、广告、风控等大规模机器学习系统的训练与线上serving。',
      duties: ['特征工程与样本 pipeline', '模型训练与离线/在线一致性', '模型服务化与性能优化', '线上效果监控与迭代'],
      interest: { R: 55, I: 65, A: 30, S: 35, E: 40, C: 75 },
      ability: { math: 60, code: 85, data: 70, model: 70, deploy: 80, product: 50, comm: 55, self: 70 },
      anchor: ['TF', 'SE'],
      minEdu: '本科',
      eduRank: 1,
      employers: ['互联网大厂推荐/广告团队', '电商与本地生活平台', '金融风控科技公司'],
      salaryBand: '示例区间：校招本科 22–38 万/年，硕士 30–50 万/年',
      workMix: { code: 65, meeting: 15, doc: 12, comm: 8 },
      risks: '偏工程，需要同时懂算法与大规模系统，学习曲线陡；值班与线上事故压力。'
    },
    {
      id: 'ai-engineer-infra',
      name: 'AI 工程 / 推理平台工程师',
      family: '工程族',
      summary: '做训练与推理基础设施：分布式训练、推理加速、模型服务与算力调度。',
      duties: ['分布式训练框架与集群调优', '推理引擎优化（量化/算子/调度）', '模型服务平台建设', '成本与吞吐优化'],
      interest: { R: 80, I: 60, A: 25, S: 25, E: 35, C: 80 },
      ability: { math: 50, code: 90, data: 55, model: 50, deploy: 90, product: 30, comm: 50, self: 75 },
      anchor: ['TF', 'SE'],
      minEdu: '本科',
      eduRank: 1,
      employers: ['云厂商', '大模型公司的工程团队', '芯片与算力公司', '大厂基础架构部门'],
      salaryBand: '示例区间：校招本科 22–40 万/年',
      workMix: { code: 70, meeting: 15, doc: 10, comm: 5 },
      risks: '偏底层与运维属性，需要长期积累系统能力；算法新意较少。'
    },
    {
      id: 'embedded-ai',
      name: '嵌入式 AI / 边缘智能工程师',
      family: '工程族',
      summary: '把模型放到手机、机器人、摄像头、车机等资源受限设备上跑起来。',
      duties: ['模型量化、剪枝与端侧部署', '芯片/加速器适配与算子优化', '端云协同方案设计', '功耗与实时性调优'],
      interest: { R: 90, I: 55, A: 35, S: 25, E: 35, C: 70 },
      ability: { math: 50, code: 80, data: 50, model: 55, deploy: 85, product: 45, comm: 50, self: 70 },
      anchor: ['TF', 'AU'],
      minEdu: '本科',
      eduRank: 1,
      employers: ['手机与消费电子厂商', '机器人公司', '汽车与自动驾驶供应链', '安防与 IoT 厂商'],
      salaryBand: '示例区间：校招本科 18–32 万/年',
      workMix: { code: 65, meeting: 12, doc: 15, comm: 8 },
      risks: '软硬结合，入门周期长；行业周期与硬件厂商景气度强相关。'
    },
    {
      id: 'ai-pm',
      name: 'AI 产品经理',
      family: '产品族',
      summary: '定义 AI 产品要解决什么问题、做到什么程度、怎么衡量效果。',
      duties: ['需求洞察与场景选择', '定义产品指标与验收标准', '协调算法/工程/设计推进落地', '效果评估与版本迭代决策'],
      interest: { R: 30, I: 55, A: 60, S: 75, E: 85, C: 55 },
      ability: { math: 30, code: 40, data: 55, model: 40, deploy: 25, product: 85, comm: 85, self: 70 },
      anchor: ['GM', 'EC'],
      minEdu: '本科',
      eduRank: 1,
      employers: ['互联网大厂 AI 产品线', 'AI 应用公司', 'SaaS 与工具类公司', '传统行业智能化部门'],
      salaryBand: '示例区间：校招本科 18–30 万/年',
      workMix: { code: 10, meeting: 35, doc: 35, comm: 20 },
      risks: '校招 AI 产品岗数量少于技术岗；需要"懂技术 + 懂业务"的复合背景，容易两头不靠。'
    },
    {
      id: 'ai-solution',
      name: 'AI 解决方案 / 交付工程师',
      family: '应用工程族',
      summary: '面向企业客户，把通用 AI 能力改造成能落地的行业方案并完成交付。',
      duties: ['客户需求调研与方案设计', 'PoC 验证与效果对齐', '定制化开发与现场交付', '客户培训与售后支持'],
      interest: { R: 55, I: 50, A: 40, S: 70, E: 80, C: 60 },
      ability: { math: 35, code: 65, data: 50, model: 45, deploy: 60, product: 70, comm: 85, self: 75 },
      anchor: ['GM', 'SV'],
      minEdu: '本科',
      eduRank: 1,
      employers: ['AI 平台与云厂商', '行业软件与集成商', 'AI 创业公司'],
      salaryBand: '示例区间：校招本科 16–28 万/年 + 项目奖金',
      workMix: { code: 35, meeting: 25, doc: 25, comm: 15 },
      risks: '出差多、需要直面客户压力；技术深度增长有限，需主动维护技术手感。'
    },
    {
      id: 'ai-governance',
      name: 'AI 治理 / 算法合规',
      family: '交叉族',
      summary: '负责算法安全评估、数据合规、内容风控策略与 AI 伦理审查。',
      duties: ['算法备案与安全评估', '数据合规与隐私保护方案', '内容安全策略与风控规则', 'AI 伦理与责任机制建设'],
      interest: { R: 25, I: 70, A: 30, S: 70, E: 60, C: 90 },
      ability: { math: 35, code: 50, data: 65, model: 40, deploy: 30, product: 55, comm: 80, self: 65 },
      anchor: ['SE', 'SV'],
      minEdu: '本科',
      eduRank: 1,
      employers: ['大厂合规/安全部门', '监管与事业单位技术岗', '律所与咨询机构的技术合规团队'],
      salaryBand: '示例区间：校招本科 15–25 万/年',
      workMix: { code: 10, meeting: 25, doc: 50, comm: 15 },
      risks: '岗位新、边界模糊，职业路径仍在形成；偏支撑职能，晋升速度可能较慢。'
    }
  ];

  CP.getJob = function (id) {
    for (var i = 0; i < CP.JOB_FAMILIES.length; i++) {
      if (CP.JOB_FAMILIES[i].id === id) return CP.JOB_FAMILIES[i];
    }
    return null;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
