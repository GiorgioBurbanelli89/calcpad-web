// Symbolic.ts — Symbolic math wrapper for the web (nerdamer + Calculus + Algebra + Solve)
//
// Mirrors the #sym subset of Calcpad-Symbolic desktop (which uses AngouriMath in C#).
// Functions exposed to the parser:
//
//   diff(expr, var)               — derivative
//   diff2(expr, var)              — second derivative
//   pdiff(expr, var)              — partial derivative (alias of diff)
//   integrate(expr, var)          — indefinite integral
//   integrate(expr, var, a, b)    — definite integral
//   simplify(expr)                — algebraic simplification
//   expand(expr)                  — algebraic expansion
//   factor(expr)                  — factorize
//   solve(expr, var)              — solve equation = 0
//   subs(expr, var, value)        — substitute variable with value
//   sym(expr)                     — return symbolic string (no eval)
//
// All accept either strings or numbers; return strings (LaTeX-friendly when possible).

// @ts-ignore — nerdamer has no proper TS types
import nerdamer from 'nerdamer';
// @ts-ignore
import 'nerdamer/Algebra.js';
// @ts-ignore
import 'nerdamer/Calculus.js';
// @ts-ignore
import 'nerdamer/Solve.js';

const nerd: any = nerdamer;

/** Differentiate an expression w.r.t. a variable. */
export function symDiff(expr: string, variable: string): string {
  try {
    return nerd.diff(nerd(expr), variable).toString();
  } catch (err) {
    throw new Error(`diff(${expr}, ${variable}) failed: ${(err as Error).message}`);
  }
}

/** Second derivative. */
export function symDiff2(expr: string, variable: string): string {
  try {
    return nerd.diff(nerd.diff(nerd(expr), variable), variable).toString();
  } catch (err) {
    throw new Error(`diff2(${expr}, ${variable}) failed: ${(err as Error).message}`);
  }
}

/** Indefinite or definite integral. */
export function symIntegrate(expr: string, variable: string, a?: string | number, b?: string | number): string {
  try {
    if (a === undefined && b === undefined) {
      return nerd.integrate(nerd(expr), variable).toString();
    }
    const F = nerd.integrate(nerd(expr), variable);
    // Substitute upper - lower
    const Fa = F.sub(variable, String(a));
    const Fb = F.sub(variable, String(b));
    return nerd(`(${Fb.toString()}) - (${Fa.toString()})`).toString();
  } catch (err) {
    throw new Error(`integrate(${expr}, ${variable}) failed: ${(err as Error).message}`);
  }
}

/** Algebraic simplification. */
export function symSimplify(expr: string): string {
  try {
    return nerd(expr).toString();
  } catch (err) {
    throw new Error(`simplify(${expr}) failed: ${(err as Error).message}`);
  }
}

/** Algebraic expansion. */
export function symExpand(expr: string): string {
  try {
    return nerd(expr).expand().toString();
  } catch (err) {
    throw new Error(`expand(${expr}) failed: ${(err as Error).message}`);
  }
}

/** Factorize an expression. */
export function symFactor(expr: string): string {
  try {
    // nerdamer Algebra.js provides factor()
    return nerd(`factor(${expr})`).toString();
  } catch (err) {
    return symSimplify(expr); // fallback
  }
}

/** Solve equation expr = 0 for a variable. Returns string of solutions. */
export function symSolve(expr: string, variable: string): string {
  try {
    return nerd.solve(expr, variable).toString();
  } catch (err) {
    throw new Error(`solve(${expr}, ${variable}) failed: ${(err as Error).message}`);
  }
}

/** Substitute a variable with a value (numeric or symbolic). */
export function symSubs(expr: string, variable: string, value: string | number): string {
  try {
    return nerd(expr).sub(variable, String(value)).toString();
  } catch (err) {
    throw new Error(`subs(${expr}, ${variable}, ${value}) failed: ${(err as Error).message}`);
  }
}

/** Convert a symbolic string to LaTeX (for KaTeX rendering). */
export function symToLatex(expr: string): string {
  try {
    return nerd(expr).toTeX();
  } catch (err) {
    return expr;
  }
}

/** Evaluate a symbolic expression numerically (substitutes all variables). */
export function symEval(expr: string, scope: Record<string, number> = {}): number {
  try {
    let e = nerd(expr);
    for (const [k, v] of Object.entries(scope)) {
      e = e.sub(k, String(v));
    }
    return parseFloat(e.toString());
  } catch (err) {
    throw new Error(`eval(${expr}) failed: ${(err as Error).message}`);
  }
}

/** Install all symbolic functions in a math.js scope object. */
export function installSymbolic(scope: Record<string, unknown>): void {
  scope.diff = symDiff;
  scope.diff2 = symDiff2;
  scope.pdiff = symDiff;       // partial = diff for one variable
  scope.integrate = symIntegrate;
  scope.simplify = symSimplify;
  scope.expand = symExpand;
  scope.factor = symFactor;
  scope.solve_sym = symSolve;
  scope.subs = symSubs;
  scope.sym = (e: string) => e;  // identity (just keep as string)
  scope.tex = symToLatex;
}
