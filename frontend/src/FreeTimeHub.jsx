import { useEffect, useMemo, useRef, useState } from "react";
import { UnitedIcon } from "./UnitedLaneIcons";

const blockBoardSize = 8;
const blockShapes = [
  { id: "dot", label: "Dot", cells: [[0, 0]], tone: "sky" },
  { id: "two-row", label: "Line 2", cells: [[0, 0], [0, 1]], tone: "mint" },
  { id: "three-row", label: "Line 3", cells: [[0, 0], [0, 1], [0, 2]], tone: "gold" },
  { id: "four-row", label: "Line 4", cells: [[0, 0], [0, 1], [0, 2], [0, 3]], tone: "coral" },
  { id: "two-col", label: "Stack 2", cells: [[0, 0], [1, 0]], tone: "violet" },
  { id: "three-col", label: "Stack 3", cells: [[0, 0], [1, 0], [2, 0]], tone: "teal" },
  { id: "square", label: "Square", cells: [[0, 0], [0, 1], [1, 0], [1, 1]], tone: "rose" },
  { id: "elbow", label: "Corner", cells: [[0, 0], [1, 0], [1, 1]], tone: "lime" },
  { id: "reverse-elbow", label: "Hook", cells: [[0, 1], [1, 1], [1, 0]], tone: "indigo" },
  { id: "t-piece", label: "T", cells: [[0, 0], [0, 1], [0, 2], [1, 1]], tone: "amber" },
  { id: "zig", label: "Zig", cells: [[0, 0], [0, 1], [1, 1], [1, 2]], tone: "cyan" },
];

const memoryTokens = ["A", "B", "C", "D", "E", "F", "G", "H"];
const relaxModes = [
  { id: "lagoon", label: "Lagoon", hint: "soft blue + mint" },
  { id: "sunset", label: "Sunset", hint: "coral + gold" },
  { id: "aurora", label: "Aurora", hint: "green + violet" },
];

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const nextIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[nextIndex]] = [shuffled[nextIndex], shuffled[index]];
  }
  return shuffled;
}

function createPiece(index = 0) {
  const shape = randomItem(blockShapes);
  return {
    ...shape,
    uid: `${shape.id}-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
  };
}

function createPieces() {
  return [0, 1, 2].map((index) => createPiece(index));
}

function emptyBlockBoard() {
  return Array.from({ length: blockBoardSize * blockBoardSize }, () => null);
}

function pieceBounds(piece) {
  return piece.cells.reduce(
    (bounds, [row, col]) => ({
      rows: Math.max(bounds.rows, row + 1),
      cols: Math.max(bounds.cols, col + 1),
    }),
    { rows: 1, cols: 1 }
  );
}

function canPlacePiece(board, piece, row, col) {
  return piece.cells.every(([pieceRow, pieceCol]) => {
    const targetRow = row + pieceRow;
    const targetCol = col + pieceCol;
    if (targetRow < 0 || targetRow >= blockBoardSize || targetCol < 0 || targetCol >= blockBoardSize) {
      return false;
    }
    return !board[targetRow * blockBoardSize + targetCol];
  });
}

function hasMove(board, pieces) {
  return pieces.some((piece) => {
    for (let row = 0; row < blockBoardSize; row += 1) {
      for (let col = 0; col < blockBoardSize; col += 1) {
        if (canPlacePiece(board, piece, row, col)) {
          return true;
        }
      }
    }
    return false;
  });
}

function clearFilledLines(board) {
  const rowsToClear = [];
  const colsToClear = [];

  for (let row = 0; row < blockBoardSize; row += 1) {
    const full = Array.from({ length: blockBoardSize }, (_, col) => board[row * blockBoardSize + col]).every(Boolean);
    if (full) rowsToClear.push(row);
  }

  for (let col = 0; col < blockBoardSize; col += 1) {
    const full = Array.from({ length: blockBoardSize }, (_, row) => board[row * blockBoardSize + col]).every(Boolean);
    if (full) colsToClear.push(col);
  }

  if (!rowsToClear.length && !colsToClear.length) {
    return { board, lines: 0 };
  }

  const nextBoard = [...board];
  rowsToClear.forEach((row) => {
    for (let col = 0; col < blockBoardSize; col += 1) {
      nextBoard[row * blockBoardSize + col] = null;
    }
  });
  colsToClear.forEach((col) => {
    for (let row = 0; row < blockBoardSize; row += 1) {
      nextBoard[row * blockBoardSize + col] = null;
    }
  });

  return { board: nextBoard, lines: rowsToClear.length + colsToClear.length };
}

function createMemoryDeck() {
  return shuffle([...memoryTokens, ...memoryTokens].map((token, index) => ({ id: `${token}-${index}`, token })));
}

function nextTarget(excludeIndex = -1) {
  let target = Math.floor(Math.random() * 16);
  if (target === excludeIndex) {
    target = (target + 5) % 16;
  }
  return target;
}

function buildRelaxBalls(count, mode) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${mode}-${index}`,
    size: 34 + Math.round(Math.random() * 92),
    x: Math.round(Math.random() * 96),
    y: Math.round(Math.random() * 92),
    driftX: Math.round(Math.random() * 42 - 21),
    driftY: Math.round(Math.random() * 34 - 17),
    duration: 12 + Math.round(Math.random() * 18),
    delay: -Math.round(Math.random() * 18),
  }));
}

function BlockBreakGame() {
  const [board, setBoard] = useState(() => emptyBlockBoard());
  const [pieces, setPieces] = useState(() => createPieces());
  const [selectedPieceId, setSelectedPieceId] = useState("");
  const [hoverCell, setHoverCell] = useState(null);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [combo, setCombo] = useState(0);
  const [gameOver, setGameOver] = useState(false);

  const selectedPiece = pieces.find((piece) => piece.uid === selectedPieceId) || pieces[0] || null;

  useEffect(() => {
    if (pieces.length && !pieces.some((piece) => piece.uid === selectedPieceId)) {
      setSelectedPieceId(pieces[0].uid);
    }
  }, [pieces, selectedPieceId]);

  function resetGame() {
    const nextPieces = createPieces();
    setBoard(emptyBlockBoard());
    setPieces(nextPieces);
    setSelectedPieceId(nextPieces[0]?.uid || "");
    setHoverCell(null);
    setScore(0);
    setCombo(0);
    setGameOver(false);
  }

  function placeAt(cellIndex) {
    if (!selectedPiece || gameOver) return;
    const row = Math.floor(cellIndex / blockBoardSize);
    const col = cellIndex % blockBoardSize;
    if (!canPlacePiece(board, selectedPiece, row, col)) return;

    const placedBoard = [...board];
    selectedPiece.cells.forEach(([pieceRow, pieceCol]) => {
      const target = (row + pieceRow) * blockBoardSize + col + pieceCol;
      placedBoard[target] = selectedPiece.tone;
    });

    const cleared = clearFilledLines(placedBoard);
    const nextCombo = cleared.lines ? combo + 1 : 0;
    const nextScore = score + selectedPiece.cells.length * 12 + cleared.lines * 95 + nextCombo * 25;
    const remainingPieces = pieces.filter((piece) => piece.uid !== selectedPiece.uid);
    const nextPieces = remainingPieces.length ? remainingPieces : createPieces();
    const noMove = !hasMove(cleared.board, nextPieces);

    setBoard(cleared.board);
    setPieces(nextPieces);
    setSelectedPieceId(nextPieces[0]?.uid || "");
    setScore(nextScore);
    setBest((currentBest) => Math.max(currentBest, nextScore));
    setCombo(nextCombo);
    setGameOver(noMove);
  }

  function cellPreviewState(cellIndex) {
    if (!selectedPiece || hoverCell === null || gameOver) return "";
    const hoverRow = Math.floor(hoverCell / blockBoardSize);
    const hoverCol = hoverCell % blockBoardSize;
    const targetRow = Math.floor(cellIndex / blockBoardSize);
    const targetCol = cellIndex % blockBoardSize;
    const inShape = selectedPiece.cells.some(([pieceRow, pieceCol]) => hoverRow + pieceRow === targetRow && hoverCol + pieceCol === targetCol);
    if (!inShape) return "";
    return canPlacePiece(board, selectedPiece, hoverRow, hoverCol) ? "preview-good" : "preview-bad";
  }

  return (
    <article className="free-time-game-panel free-time-block-panel">
      <header className="free-time-game-head">
        <div>
          <span>Block Burst</span>
          <strong>{score}</strong>
        </div>
        <div>
          <span>Best</span>
          <strong>{best}</strong>
        </div>
        <button className="free-time-quiet-button" type="button" onClick={resetGame}>New</button>
      </header>

      <div className="free-time-block-layout">
        <div className="free-time-block-board" onMouseLeave={() => setHoverCell(null)}>
          {board.map((tone, index) => (
            <button
              className={`free-time-block-cell ${tone ? `tone-${tone}` : ""} ${cellPreviewState(index)}`.trim()}
              type="button"
              key={`block-cell-${index}`}
              onMouseEnter={() => setHoverCell(index)}
              onFocus={() => setHoverCell(index)}
              onClick={() => placeAt(index)}
              aria-label={`Block cell ${index + 1}`}
            />
          ))}
        </div>

        <div className="free-time-piece-tray">
          {pieces.map((piece) => {
            const bounds = pieceBounds(piece);
            return (
              <button
                className={`free-time-piece-card ${selectedPieceId === piece.uid ? "active" : ""}`}
                type="button"
                key={piece.uid}
                onClick={() => setSelectedPieceId(piece.uid)}
              >
                <span>{piece.label}</span>
                <i
                  className="free-time-piece-shape"
                  style={{
                    "--piece-rows": bounds.rows,
                    "--piece-cols": bounds.cols,
                  }}
                >
                  {Array.from({ length: bounds.rows * bounds.cols }, (_, cellIndex) => {
                    const row = Math.floor(cellIndex / bounds.cols);
                    const col = cellIndex % bounds.cols;
                    const filled = piece.cells.some(([pieceRow, pieceCol]) => pieceRow === row && pieceCol === col);
                    return <b className={filled ? `tone-${piece.tone}` : ""} key={`${piece.uid}-${cellIndex}`} />;
                  })}
                </i>
              </button>
            );
          })}
        </div>
      </div>

      <footer className="free-time-status-row">
        <span>{gameOver ? "No move left" : selectedPiece ? "Pick a spot" : "Fresh set"}</span>
        <span>{combo ? `${combo}x line streak` : "Clear rows or columns"}</span>
      </footer>
    </article>
  );
}

function MemoryGame() {
  const [deck, setDeck] = useState(() => createMemoryDeck());
  const [flipped, setFlipped] = useState([]);
  const [matched, setMatched] = useState(() => new Set());
  const [moves, setMoves] = useState(0);

  const complete = matched.size === deck.length;

  useEffect(() => {
    if (flipped.length !== 2) return undefined;
    const [first, second] = flipped;
    const timer = window.setTimeout(() => {
      if (deck[first]?.token === deck[second]?.token) {
        setMatched((current) => new Set([...current, deck[first].id, deck[second].id]));
      }
      setFlipped([]);
    }, 520);
    return () => window.clearTimeout(timer);
  }, [deck, flipped]);

  function resetMemory() {
    setDeck(createMemoryDeck());
    setFlipped([]);
    setMatched(new Set());
    setMoves(0);
  }

  function flipCard(index) {
    if (flipped.length >= 2 || flipped.includes(index) || matched.has(deck[index].id)) return;
    const nextFlipped = [...flipped, index];
    setFlipped(nextFlipped);
    if (nextFlipped.length === 2) {
      setMoves((current) => current + 1);
    }
  }

  return (
    <article className="free-time-game-panel">
      <header className="free-time-game-head">
        <div>
          <span>Memory Tiles</span>
          <strong>{complete ? "Done" : `${matched.size / 2}/8`}</strong>
        </div>
        <div>
          <span>Moves</span>
          <strong>{moves}</strong>
        </div>
        <button className="free-time-quiet-button" type="button" onClick={resetMemory}>Shuffle</button>
      </header>

      <div className="free-time-memory-grid">
        {deck.map((card, index) => {
          const isVisible = flipped.includes(index) || matched.has(card.id);
          return (
            <button
              className={`free-time-memory-card ${isVisible ? "open" : ""} ${matched.has(card.id) ? "matched" : ""}`.trim()}
              type="button"
              key={card.id}
              onClick={() => flipCard(index)}
            >
              <span>{isVisible ? card.token : ""}</span>
            </button>
          );
        })}
      </div>
    </article>
  );
}

function PulseTapGame() {
  const [playing, setPlaying] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [target, setTarget] = useState(() => nextTarget());

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => {
      setTimeLeft((current) => {
        if (current <= 1) {
          setPlaying(false);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    if (!playing) return undefined;
    const pulse = window.setInterval(() => {
      setTarget((current) => nextTarget(current));
      setStreak(0);
    }, 1100);
    return () => window.clearInterval(pulse);
  }, [playing]);

  function startGame() {
    setPlaying(true);
    setTimeLeft(30);
    setScore(0);
    setStreak(0);
    setTarget(nextTarget());
  }

  function tapCell(index) {
    if (!playing) return;
    if (index === target) {
      const nextStreak = streak + 1;
      setScore((current) => current + 10 + Math.min(nextStreak * 3, 30));
      setStreak(nextStreak);
      setTarget(nextTarget(index));
    } else {
      setStreak(0);
    }
  }

  return (
    <article className="free-time-game-panel">
      <header className="free-time-game-head">
        <div>
          <span>Pulse Tap</span>
          <strong>{score}</strong>
        </div>
        <div>
          <span>Time</span>
          <strong>{timeLeft}s</strong>
        </div>
        <button className="free-time-quiet-button" type="button" onClick={startGame}>{playing ? "Restart" : "Start"}</button>
      </header>

      <div className="free-time-pulse-grid">
        {Array.from({ length: 16 }, (_, index) => (
          <button
            className={`free-time-pulse-cell ${playing && index === target ? "target" : ""}`}
            type="button"
            key={`pulse-${index}`}
            onClick={() => tapCell(index)}
            aria-label={`Pulse cell ${index + 1}`}
          />
        ))}
      </div>

      <footer className="free-time-status-row">
        <span>{playing ? `${streak} streak` : "Ready"}</span>
        <span>{timeLeft === 0 ? "Round finished" : "Tap the bright square"}</span>
      </footer>
    </article>
  );
}

function RelaxBalls({ full = false, count = 24, mode = "lagoon" }) {
  const balls = useMemo(() => buildRelaxBalls(count, mode), [count, mode]);
  return (
    <div className={`free-time-balls-stage mode-${mode} ${full ? "full" : ""}`.trim()} aria-hidden="true">
      {balls.map((ball) => (
        <span
          className="free-time-ball"
          key={ball.id}
          style={{
            "--ball-size": `${ball.size}px`,
            "--ball-x": `${ball.x}%`,
            "--ball-y": `${ball.y}%`,
            "--ball-drift-x": `${ball.driftX}px`,
            "--ball-drift-y": `${ball.driftY}px`,
            "--ball-duration": `${ball.duration}s`,
            "--ball-delay": `${ball.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

function ZenDeskMode() {
  const [mode, setMode] = useState("lagoon");
  const [count, setCount] = useState(24);
  const [fullscreen, setFullscreen] = useState(false);
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!fullscreen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setFullscreen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fullscreen]);

  function openDeskMode() {
    setFullscreen(true);
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  function closeDeskMode() {
    setFullscreen(false);
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }

  return (
    <article className="free-time-game-panel free-time-zen-panel">
      <header className="free-time-game-head">
        <div>
          <span>Zen Balls</span>
          <strong>{relaxModes.find((item) => item.id === mode)?.label}</strong>
        </div>
        <button className="free-time-quiet-button" type="button" onClick={openDeskMode}>Desk Mode</button>
      </header>

      <RelaxBalls count={count} mode={mode} />

      <div className="free-time-control-grid">
        <label>
          Mode
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            {relaxModes.map((item) => (
              <option value={item.id} key={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
        <label>
          Balls
          <input type="range" min="12" max="44" step="4" value={count} onChange={(event) => setCount(Number(event.target.value))} />
        </label>
      </div>

      {fullscreen ? (
        <div className="free-time-desk-overlay" ref={overlayRef}>
          <RelaxBalls full count={count} mode={mode} />
          <div className="free-time-desk-panel">
            <span>Free Time</span>
            <strong>Zen Balls</strong>
            <small>{relaxModes.find((item) => item.id === mode)?.hint}</small>
            <button type="button" onClick={closeDeskMode}>Close</button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default function FreeTimeHub() {
  const [activeGame, setActiveGame] = useState("blocks");
  const games = [
    { id: "blocks", label: "Blocks", icon: "dashboard" },
    { id: "memory", label: "Memory", icon: "spark" },
    { id: "pulse", label: "Pulse", icon: "success" },
    { id: "zen", label: "Zen", icon: "theme" },
  ];

  return (
    <div className="free-time-hub">
      <div className="free-time-tabs" role="tablist" aria-label="Free Time games">
        {games.map((game) => (
          <button
            className={activeGame === game.id ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={activeGame === game.id}
            key={game.id}
            onClick={() => setActiveGame(game.id)}
          >
            <UnitedIcon name={game.icon} size={16} />
            {game.label}
          </button>
        ))}
      </div>

      <div className="free-time-showcase">
        <aside className="free-time-side">
          <span>Break Room</span>
          <strong>Short games, calm screen, quick reset.</strong>
          <p>Made for small pauses between dispatch work, login, and the next task.</p>
          <div className="free-time-mini-stack" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </aside>

        <div className="free-time-stage">
          {activeGame === "blocks" ? <BlockBreakGame /> : null}
          {activeGame === "memory" ? <MemoryGame /> : null}
          {activeGame === "pulse" ? <PulseTapGame /> : null}
          {activeGame === "zen" ? <ZenDeskMode /> : null}
        </div>
      </div>
    </div>
  );
}
