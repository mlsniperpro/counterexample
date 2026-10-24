// BUG: never checks that the stack is empty at the end, so unclosed openers such as "(" are accepted.
function solve(s) {
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  for (const c of s) {
    if (!(c in pairs)) stack.push(c);
    else if (stack.pop() !== pairs[c]) return false;
  }
  return true;
}
