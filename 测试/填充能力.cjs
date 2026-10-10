/*!
 * 测试/填充能力.cjs — 共享测试助手：给能力清单灌入勾选式作答
 *
 * 为什么独立成文件：逻辑测试（load.js）与界面冒烟测试（smoke.cjs）用的是
 * 两套不同的加载方式（前者 eval 到 globalThis.CP，后者跑在 vm 沙箱里），
 * 但都需要"每维勾上前 n 项"这个操作。写两份迟早会不一致。
 */
'use strict';

/**
 * 给能力清单灌入作答（勾选式）。
 *
 * 清单是"由易到难"的阶梯，所以"每维勾上前 n 项"就等价于"做到第 n 档"。
 * 这是测试里描述能力水平的唯一推荐方式——直接写 v:1/2/3/4 是旧 Likert 的写法，
 * 在勾选式下 2/3/4 都不代表"勾了更多项"。
 *
 * @param {Object} CP      目标命名空间（必须先加载好数据层）
 * @param {Object} archive 档案（会被就地修改）
 * @param {Object|number} byDim { dimId: 勾选数 } 或统一勾选数
 * @param {Object} [profile] 默认取 archive.profile
 */
module.exports = function fillAbility(CP, archive, byDim, profile) {
  var prof = profile || archive.profile;
  var map = (typeof byDim === 'number') ? null : byDim;
  var uniform = (typeof byDim === 'number') ? byDim : null;
  var count = {};
  archive.answers.ability = {};
  CP.activeItems(CP.BANKS.ability, prof).forEach(function (it, i) {
    count[it.dim] = (count[it.dim] || 0) + 1;
    var want = map ? (map[it.dim] || 0) : uniform;
    if (want != null && count[it.dim] <= want) {
      archive.answers.ability[it.id] = { v: 1, t: 1700000000000 + i * 6000 };
    }
  });
  return archive;
};
