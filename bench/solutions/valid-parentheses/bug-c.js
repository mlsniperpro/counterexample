// BUG: a closer that arrives with an empty stack is silently ignored, so ")" is accepted.
function solve(s) {
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  for (const c of s) {
    if (!(c in pairs)) stack.push(c);
    else if (stack.length && stack[stack.length - 1] === pairs[c]) stack.pop();
    else if (stack.length) return false;
  }
  return stack.length === 0;
}
