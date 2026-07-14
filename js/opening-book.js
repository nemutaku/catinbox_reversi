window.quantumOthelloOpeningBook = {
  schemaVersion: 1,
  name: 'Quantum Othello Opening Book',
  notation: {
    board: 'A1-H8',
    initialPosition: 'standard Othello / Reversi start',
    firstMove: 'black'
  },
  policy: {
    normalMaxPly: 5,
    hardMaxPly: 10,
    transforms: ['identity', 'rot180', 'diag', 'antiDiag'],
    invalidLineBehavior: 'truncate',
    goodMoveBand: 18
  },
  sources: [
    {
      title: 'Computer Othello',
      url: 'https://en.wikipedia.org/wiki/Computer_Othello',
      usage: 'Referenced for the opening-book approach used by Othello engines.'
    },
    {
      title: 'Reversi',
      url: 'https://en.wikipedia.org/wiki/Reversi',
      usage: 'Referenced for standard board setup and coordinate validation.'
    }
  ],
  lines: [
    {
      id: 'parallel-seed-a',
      family: 'parallel',
      label: 'Parallel seed A',
      weight: 120,
      moves: ['F5', 'F6', 'E6', 'F4', 'G5', 'D6', 'C5', 'C4', 'E3', 'F3']
    },
    {
      id: 'parallel-seed-a-reply-f4',
      family: 'parallel',
      label: 'Parallel seed A / F4 reply',
      weight: 12,
      moves: ['F5', 'F4', 'E3', 'F6', 'D3', 'C5', 'C4', 'D6', 'E6', 'C3']
    },
    {
      id: 'parallel-seed-a-reply-d6',
      family: 'parallel',
      label: 'Parallel seed A / D6 reply',
      weight: 120,
      moves: ['F5', 'D6', 'C5', 'F4', 'E6', 'F6', 'G5', 'D3', 'C4', 'E3']
    },
    {
      id: 'parallel-seed-b',
      family: 'parallel',
      label: 'Parallel seed B',
      weight: 100,
      moves: ['C4', 'C3', 'D3', 'C5', 'F6', 'F5', 'E6', 'F4', 'G5', 'D6']
    },
    {
      id: 'parallel-seed-b-reply-c5',
      family: 'parallel',
      label: 'Parallel seed B / C5 reply',
      weight: 92,
      moves: ['C4', 'C5', 'D6', 'C3', 'E6', 'F4', 'F5', 'D3', 'E3', 'F6']
    },
    {
      id: 'parallel-seed-b-reply-e3',
      family: 'parallel',
      label: 'Parallel seed B / E3 reply',
      weight: 88,
      moves: ['C4', 'E3', 'F4', 'C5', 'D3', 'C3', 'B4', 'E6', 'F5', 'D6']
    }
  ]
};
