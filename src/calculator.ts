/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Token types for safe calculator parser
 */
type TokenType = 'NUMBER' | 'OP' | 'PERCENT' | 'EOF';

interface Token {
  type: TokenType;
  value: string;
}

/**
 * Safe math expression tokenizer
 */
function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = expression.length;

  while (i < len) {
    const char = expression[i];

    // Skip white spaces
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // Capture operators: support standard and display operators (+, -, *, /, x, ÷, ×)
    if (['+', '-', '*', '/', 'x', '÷', '×'].includes(char)) {
      let op = char;
      if (op === 'x' || op === '×') op = '*';
      if (op === '÷') op = '/';
      tokens.push({ type: 'OP', value: op });
      i++;
      continue;
    }

    // Capture percent
    if (char === '%') {
      tokens.push({ type: 'PERCENT', value: '%' });
      i++;
      continue;
    }

    // Capture numbers and decimals (including negative signs at start or after an operator)
    if (/[0-9.]/.test(char) || (char === '-' && (tokens.length === 0 || tokens[tokens.length - 1].type === 'OP'))) {
      let numStr = char;
      i++;
      while (i < len && /[0-9.]/.test(expression[i])) {
        // Prevent multiple decimals in a single number token
        if (expression[i] === '.' && numStr.includes('.')) {
          i++; // skip duplicate decimals
          continue;
        }
        numStr += expression[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: numStr });
      continue;
    }

    // Unrecognized character: skip or throw to keep logic steady
    i++;
  }

  tokens.push({ type: 'EOF', value: '' });
  return tokens;
}

/**
 * Safe math evaluator utilizing PEMDAS precedence (No eval, No JS injection)
 */
export function evaluateSafeExpression(expression: string): string {
  // Normalize characters from displays
  let normalized = expression
    .replace(/−/g, '-')
    .replace(/×/g, '*')
    .replace(/÷/g, '/');

  const tokens = tokenize(normalized);
  let index = 0;

  function peek(): Token {
    return tokens[index];
  }

  function consume(): Token {
    return tokens[index++];
  }

  /**
   * Parse factor: numbers, negative numbers, percentages
   */
  function parseFactor(): number {
    let token = peek();

    if (token.type === 'NUMBER') {
      consume();
      let val = parseFloat(token.value);
      if (isNaN(val)) return 0;

      // Handle post-fix percentage checks (e.g. 50%)
      if (peek().type === 'PERCENT') {
        consume();
        val = val / 100;
      }
      return val;
    }

    if (token.type === 'OP' && token.value === '-') {
      consume(); // consume negative sign
      const nextToken = consume();
      if (nextToken.type === 'NUMBER') {
        let val = -parseFloat(nextToken.value);
        if (peek().type === 'PERCENT') {
          consume();
          val = val / 100;
        }
        return val;
      }
    }

    // Safe default to avoid loops
    consume();
    return 0;
  }

  /**
   * Parse term: handles multiplication and division
   */
  function parseTerm(): number {
    let left = parseFactor();

    while (true) {
      const token = peek();
      if (token.type === 'OP' && (token.value === '*' || token.value === '/')) {
        consume();
        const right = parseFactor();
        if (token.value === '*') {
          left = left * right;
        } else {
          if (right === 0) {
            throw new Error("DivByZero");
          }
          left = left / right;
        }
      } else {
        break;
      }
    }

    return left;
  }

  /**
   * Parse expression: handles addition and subtraction
   */
  function parseExpression(): number {
    let left = parseTerm();

    while (true) {
      const token = peek();
      if (token.type === 'OP' && (token.value === '+' || token.value === '-')) {
        consume();
        const right = parseTerm();
        if (token.value === '+') {
          left = left + right;
        } else {
          left = left - right;
        }
      } else {
        break;
      }
    }

    return left;
  }

  try {
    if (tokens.length <= 1) return '0';
    const result = parseExpression();

    // Limit decimal precision to keep aesthetics clean (avoids floats like 0.30000000000000004)
    if (!Number.isInteger(result)) {
      const parts = result.toString().split('.');
      if (parts[1] && parts[1].length > 8) {
        return parseFloat(result.toFixed(8)).toString();
      }
    }
    return result.toString();
  } catch (error: any) {
    if (error.message === 'DivByZero') return 'Error: 0 se bhaag nahi ho sakta';
    return 'Error';
  }
}
