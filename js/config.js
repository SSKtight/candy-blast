// 全局可调参数：数值锁定自设计 spec（docs/superpowers/specs/2026-10-05-candy-block-puzzle-design.md）
export const CONFIG = {
  app: { version: "1.0.0" },
  board: { rows: 9, cols: 9 },
  colors: 7,
  batchSize: 3,

  scoring: {
    perPlacedCell: 1,
    perClearedCell: 10,
    multilineBonus: [0, 0, 20, 50, 100, 200, 300], // 下标 = 同消线数，超出取末档
    comboMultipliers: [1, 1.5, 2, 3, 5], // 下标 = combo-1，超出取末档
  },

  energy: {
    max: 100,
    // 消除充能（下标=同消线数，超出取末档），与连击充能叠加：单消 +3 保底，2/3/4+线各 +20/40/60（最厚来源）
    multilineGain: [0, 3, 20, 40, 60],
    // 高压保底充能：无消除且填充度 ≥ 此阈值时每手 +pressureGain
    pressureThreshold: 0.6,
    pressureGain: 8,
    // 重抽能量保留比例：0=全清，0.5=保留一半（向下取整，现行）
    rerollKeepRatio: 0.5,
    // 死局保险丝：全槽不可放且能量 ≥ 此值时，自动扣费换 dot 续命；0=关闭（现行）
    rescueCost: 0,
    // 优质批通胀：本局第 N 次触发优质批后，所有充能增益 ÷ rate^N（充满所需总充能 ×rate^N）
    premiumInflationRate: 1.2,
  },

  // 每局重抽次数上限：Infinity=不限（现行），有限值=超限后 reroll 拒绝且按钮禁用
  reroll: { maxPerGame: Infinity },

  supply: {
    dedupMaxRetries: 3,
    // 正常池（第 1、2 位 + 受控槽 normal 候选；永不出 dot）
    // 囤满才消友好化：square3 4.2→1（保留但不归零）、SZ 14→4（压缩最难族）
    normalWeights: { domino: 26, line3: 24, L3: 22, square2: 14, SZ: 4, square3: 1 },
    // 困难满档(p=1)正常池权重：凹凸/扭转块加重，压缩 domino/长条
    hardNormalWeights: { domino: 10, line3: 14, L3: 22, square2: 8, SZ: 26, square3: 4.2 },
    // 优质池基础权重
    premiumBaseWeights: {
      line4: 16, square2: 14, L4: 14, T: 14, rect2x3: 12,
      line5: 10, L5: 10, plus: 6, square3: 4,
    },
    // 困难满档(p=1)优质权重
    premiumHardWeights: {
      line4: 22, square2: 20, L4: 20, T: 20, rect2x3: 16,
      line5: 1, L5: 1, plus: 0, square3: 0,
    },
    // 新手期规整块包（三槽同池；仅矩形与长条，空盘期每块都能整齐贴边，不放凹凸/扭块）
    openingWeights: {
      rect2x3: 31, square3: 4, line4: 17, line5: 17, square2: 11,
    },
    // 缺口选形：70% 取全局最优放置，30% 族均匀后取族内最优
    gapBestRatio: 0.7,
    // 缺口评分（选项A比例制）：消除分=消除行列数之和×lineComplete + 贴合率 + 靠墙率；无打散惩罚
    gapScore: {
      lineComplete: 50,
      fitWeight: 100,
      wallWeight: 25,
    },
  },

  difficulty: {
    noviceScore: 1000,
    hardScore: 2000,
    hardDurationPlaces: 45,
  },

  save: {
    key: "candyblast_save_v1",
    version: 1,
    authSessionKey: "candyblast_auth",
  },

  haptics: {
    multiline2: [30],
    multiline3Plus: [40, 30, 40],
    comboLow: [20],
    comboHigh: [25, 25, 25],
    premium: [30, 40, 30],
  },

  anim: {
    lockFallbackMs: 400,
    placeMs: 120,
    clearMs: 220,
    floatMs: 800,
    barMs: 200,
    scoreRollMs: 300,
  },
};
