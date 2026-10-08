// 新手引导脚本（spec §10.1）：纯数据 + 注释坐标。三章，硬引导。
// board: 章开场预设格；tray: 该步固定托盘快照（槽 0 起，连续放置）。
// spotlight.anchor = 块的放置锚点（piece 局部 (0,0) 对应的棋盘格）；
// spotlight.cells  = 块在锚点投影出的发光格，供遮罩挖洞与自检。
export const TUTORIAL_SCRIPT = {
  meta: {
    id: "candyblast-tutorial-v1",
    rows: 9,
    cols: 9,
    supply: "off",
    storageKey: "tutorialStep",
  },
  chapters: [
    {
      // 章 1：空盘，学拖放。L3 朝向 0 = [(0,0),(1,0),(1,1)]
      id: "ch1-drag",
      board: [],
      steps: [
        {
          id: "ch1-place",
          tray: [{ family: "L3", orient: 0, color: 2 }],
          prompt: {
            text: "按住下方亮起来的方块，拖到棋盘发光的位置，松开手指放下去～",
            anchor: "slot-0",
          },
          spotlight: {
            type: "dropZone",
            anchor: { r: 3, c: 3 },
            cells: [
              [3, 3],
              [4, 3],
              [4, 4],
            ],
          },
          mask: true,
          wait: { event: "place", slot: 0 },
          wrong: { text: "先拖到发光的地方试试看～" },
        },
      ],
    },
    {
      // 章 2：第 0 行只差两格，横 domino 一放即消（同色 4）。
      id: "ch2-clear",
      board: [0, 1, 2, 3, 4, 5, 6].map((c) => ({ r: 0, c, color: 4 })),
      steps: [
        {
          id: "ch2-place",
          tray: [{ family: "domino", orient: 0, color: 4 }],
          prompt: {
            text: "看到右上角只差两格的这一整行了吗？把横条放到发光处，整行就会消除！",
            anchor: { r: 0, c: 6 },
          },
          spotlight: {
            type: "dropZone",
            anchor: { r: 0, c: 7 },
            cells: [
              [0, 7],
              [0, 8],
            ],
          },
          mask: true,
          wait: { event: "place", slot: 0, clearedLines: 1 },
          wrong: { text: "对准发光的两个格子，横着放下去哦～" },
        },
      ],
    },
    {
      // 章 3：再来一次消除，随后指读飘分与连击尾巴。第 1 行同构（色 5）。
      id: "ch3-score",
      board: [0, 1, 2, 3, 4, 5, 6].map((c) => ({ r: 1, c, color: 5 })),
      steps: [
        {
          id: "ch3-place",
          tray: [{ family: "domino", orient: 0, color: 5 }],
          prompt: {
            text: "再试一次！把横条补到发光的缺口，注意看消除后跳出的分数～",
            anchor: "slot-0",
          },
          spotlight: {
            type: "dropZone",
            anchor: { r: 1, c: 7 },
            cells: [
              [1, 7],
              [1, 8],
            ],
          },
          mask: true,
          wait: { event: "place", slot: 0, clearedLines: 1 },
          wrong: { text: "放到发光的缺口才能消除，再试一次～" },
        },
        {
          // 指读步：保留消除后的棋盘不重载，气泡指向分数区，点击「知道了」结束引导。
          id: "ch3-read",
          tray: [],
          prompt: {
            text: "消除会立刻飘出得分；连续两步都消除，飘分会带上「连击×N」，分数越拿越多！",
            anchor: "hud-score",
          },
          spotlight: { type: "none", cells: [] },
          mask: true,
          wait: { event: "tap" },
        },
      ],
    },
  ],
};
