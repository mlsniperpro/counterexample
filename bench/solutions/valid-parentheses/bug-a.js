// BUG: keeps one counter per bracket type, which ignores nesting order, so "([)]" is accepted.
function solve(s) {
  const open = { "(": 0, "[": 1, "{": 2 };
  const close = { ")": 0, "]": 1, "}": 2 };
  const bal = [0, 0, 0];
  for (const c of s) {
    if (c in open) bal[open[c]]++;
    else if (--bal[close[c]] < 0) return false;
  }
  return bal.every((b) => b === 0);
}
