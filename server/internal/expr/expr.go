// Package expr is a small, safe expression language for calculated
// parameters and custom event conditions, e.g.
//
//	io9 / 1000 * 2.5
//	ignition && speed > 80 && power < 11.5
//	if(in2, "open", "closed")
//
// Identifiers name position fields (speed, course, altitude, satellites, lat,
// lng, valid) or attributes (ignition, power, io9, any calculated parameter).
// Numbers, booleans and strings are supported; booleans count as 1/0 in
// arithmetic. Reading an identifier that the fix does not carry fails the
// evaluation with ErrMissing, so a formula never produces a value from
// absent data.
package expr

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"
)

// ErrMissing is returned (wrapped) when an identifier has no value.
var ErrMissing = errors.New("missing value")

// MaxLength bounds the source length of an expression.
const MaxLength = 500

// Env resolves identifiers to values.
type Env func(name string) (any, bool)

// Expr is a compiled expression, safe for concurrent use.
type Expr struct {
	src  string
	root node
	vars []string
}

// String returns the source.
func (e *Expr) String() string { return e.src }

// Vars lists the identifiers the expression reads, in order of appearance.
func (e *Expr) Vars() []string { return e.vars }

// Eval evaluates the expression.
func (e *Expr) Eval(env Env) (any, error) { return e.root.eval(env) }

// EvalBool evaluates and converts the result to a boolean.
func (e *Expr) EvalBool(env Env) (bool, error) {
	v, err := e.Eval(env)
	if err != nil {
		return false, err
	}
	return truthy(v), nil
}

// Compile parses src.
func Compile(src string) (*Expr, error) {
	src = strings.TrimSpace(src)
	if src == "" {
		return nil, errors.New("expression is empty")
	}
	if len(src) > MaxLength {
		return nil, fmt.Errorf("expression must be at most %d characters", MaxLength)
	}
	toks, err := lex(src)
	if err != nil {
		return nil, err
	}
	p := &parser{toks: toks, seen: map[string]bool{}}
	root, err := p.ternary()
	if err != nil {
		return nil, err
	}
	if t := p.peek(); t.kind != tEOF {
		return nil, fmt.Errorf("unexpected %q at position %d", t.text, t.pos+1)
	}
	return &Expr{src: src, root: root, vars: p.vars}, nil
}

// ---- lexer ----

type tokKind int

const (
	tEOF tokKind = iota
	tNum
	tStr
	tIdent
	tOp
)

type token struct {
	kind tokKind
	text string
	num  float64
	pos  int
}

var ops = []string{"&&", "||", "==", "!=", "<=", ">=", "<", ">", "+", "-", "*", "/", "%", "!", "(", ")", ",", "?", ":"}

func lex(src string) ([]token, error) {
	var out []token
	for i := 0; i < len(src); {
		c := rune(src[i])
		switch {
		case unicode.IsSpace(c):
			i++
		case c >= '0' && c <= '9' || c == '.' && i+1 < len(src) && src[i+1] >= '0' && src[i+1] <= '9':
			j := i
			if strings.HasPrefix(src[i:], "0x") || strings.HasPrefix(src[i:], "0X") {
				j += 2
				for j < len(src) && strings.ContainsRune("0123456789abcdefABCDEF", rune(src[j])) {
					j++
				}
				n, err := strconv.ParseUint(src[i+2:j], 16, 64)
				if err != nil {
					return nil, fmt.Errorf("bad number %q", src[i:j])
				}
				out = append(out, token{kind: tNum, text: src[i:j], num: float64(n), pos: i})
				i = j
				continue
			}
			for j < len(src) && (src[j] >= '0' && src[j] <= '9' || src[j] == '.' || src[j] == 'e' || src[j] == 'E' ||
				(src[j] == '-' || src[j] == '+') && (src[j-1] == 'e' || src[j-1] == 'E')) {
				j++
			}
			n, err := strconv.ParseFloat(src[i:j], 64)
			if err != nil {
				return nil, fmt.Errorf("bad number %q", src[i:j])
			}
			out = append(out, token{kind: tNum, text: src[i:j], num: n, pos: i})
			i = j
		case c == '"' || c == '\'':
			j := i + 1
			for j < len(src) && rune(src[j]) != c {
				j++
			}
			if j >= len(src) {
				return nil, fmt.Errorf("unterminated string at position %d", i+1)
			}
			out = append(out, token{kind: tStr, text: src[i+1 : j], pos: i})
			i = j + 1
		case c == '_' || unicode.IsLetter(c):
			j := i
			for j < len(src) && (src[j] == '_' || src[j] < 0x80 && (unicode.IsLetter(rune(src[j])) || unicode.IsDigit(rune(src[j])))) {
				j++
			}
			word := src[i:j]
			switch strings.ToLower(word) {
			case "and":
				out = append(out, token{kind: tOp, text: "&&", pos: i})
			case "or":
				out = append(out, token{kind: tOp, text: "||", pos: i})
			case "not":
				out = append(out, token{kind: tOp, text: "!", pos: i})
			default:
				out = append(out, token{kind: tIdent, text: word, pos: i})
			}
			i = j
		default:
			matched := false
			for _, op := range ops {
				if strings.HasPrefix(src[i:], op) {
					out = append(out, token{kind: tOp, text: op, pos: i})
					i += len(op)
					matched = true
					break
				}
			}
			if !matched {
				if c == '=' {
					return nil, fmt.Errorf("use == to compare (position %d)", i+1)
				}
				return nil, fmt.Errorf("unexpected character %q at position %d", c, i+1)
			}
		}
	}
	return append(out, token{kind: tEOF, pos: len(src)}), nil
}

// ---- parser (precedence climbing) ----

type parser struct {
	toks []token
	i    int
	vars []string
	seen map[string]bool
	deep int
}

func (p *parser) peek() token { return p.toks[p.i] }
func (p *parser) next() token { t := p.toks[p.i]; p.i++; return t }
func (p *parser) isOp(s string) bool {
	t := p.peek()
	return t.kind == tOp && t.text == s
}

func (p *parser) expect(s string) error {
	if !p.isOp(s) {
		t := p.peek()
		if t.kind == tEOF {
			return fmt.Errorf("expected %q at the end", s)
		}
		return fmt.Errorf("expected %q at position %d", s, t.pos+1)
	}
	p.i++
	return nil
}

func (p *parser) ternary() (node, error) {
	p.deep++
	defer func() { p.deep-- }()
	if p.deep > 50 {
		return nil, errors.New("expression is nested too deeply")
	}
	c, err := p.binary(0)
	if err != nil || !p.isOp("?") {
		return c, err
	}
	p.i++
	a, err := p.ternary()
	if err != nil {
		return nil, err
	}
	if err := p.expect(":"); err != nil {
		return nil, err
	}
	b, err := p.ternary()
	if err != nil {
		return nil, err
	}
	return &condNode{c, a, b}, nil
}

var levels = [][]string{{"||"}, {"&&"}, {"==", "!="}, {"<", "<=", ">", ">="}, {"+", "-"}, {"*", "/", "%"}}

func (p *parser) binary(level int) (node, error) {
	if level == len(levels) {
		return p.unary()
	}
	left, err := p.binary(level + 1)
	if err != nil {
		return nil, err
	}
	for {
		t := p.peek()
		if t.kind != tOp || !contains(levels[level], t.text) {
			return left, nil
		}
		p.i++
		right, err := p.binary(level + 1)
		if err != nil {
			return nil, err
		}
		left = &binNode{op: t.text, l: left, r: right}
	}
}

func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}

func (p *parser) unary() (node, error) {
	if p.isOp("!") || p.isOp("-") || p.isOp("+") {
		op := p.next().text
		p.deep++
		defer func() { p.deep-- }()
		if p.deep > 50 {
			return nil, errors.New("expression is nested too deeply")
		}
		x, err := p.unary()
		if err != nil {
			return nil, err
		}
		return &unNode{op, x}, nil
	}
	return p.primary()
}

func (p *parser) primary() (node, error) {
	t := p.next()
	switch t.kind {
	case tNum:
		return constNode{t.num}, nil
	case tStr:
		return constNode{t.text}, nil
	case tIdent:
		lower := strings.ToLower(t.text)
		if lower == "true" || lower == "false" {
			return constNode{lower == "true"}, nil
		}
		if p.isOp("(") {
			return p.call(t)
		}
		if !p.seen[t.text] {
			p.seen[t.text] = true
			p.vars = append(p.vars, t.text)
		}
		return varNode(t.text), nil
	case tOp:
		if t.text == "(" {
			x, err := p.ternary()
			if err != nil {
				return nil, err
			}
			return x, p.expect(")")
		}
	case tEOF:
		return nil, errors.New("expression ends unexpectedly")
	}
	return nil, fmt.Errorf("unexpected %q at position %d", t.text, t.pos+1)
}

func (p *parser) call(name token) (node, error) {
	fn := strings.ToLower(name.text)
	spec, ok := funcs[fn]
	if !ok {
		return nil, fmt.Errorf("unknown function %s() — available: %s", name.text, FuncNames)
	}
	p.i++ // (
	var args []node
	if !p.isOp(")") {
		for {
			a, err := p.ternary()
			if err != nil {
				return nil, err
			}
			args = append(args, a)
			if !p.isOp(",") {
				break
			}
			p.i++
		}
	}
	if err := p.expect(")"); err != nil {
		return nil, err
	}
	if len(args) < spec.min || spec.max >= 0 && len(args) > spec.max {
		return nil, fmt.Errorf("%s() takes %s", fn, spec.arity())
	}
	if fn == "has" {
		v, ok := args[0].(varNode)
		if !ok {
			return nil, errors.New("has() takes a parameter name, e.g. has(io9)")
		}
		return hasNode(v), nil
	}
	return &callNode{fn: fn, args: args, spec: spec}, nil
}

// ---- evaluation ----

type node interface {
	eval(Env) (any, error)
}

type constNode struct{ v any }

func (n constNode) eval(Env) (any, error) { return n.v, nil }

type varNode string

func (n varNode) eval(env Env) (any, error) {
	v, ok := env(string(n))
	if !ok || v == nil {
		return nil, fmt.Errorf("%w: %s", ErrMissing, string(n))
	}
	return normalize(v), nil
}

type hasNode string

func (n hasNode) eval(env Env) (any, error) {
	v, ok := env(string(n))
	return ok && v != nil, nil
}

type unNode struct {
	op string
	x  node
}

func (n *unNode) eval(env Env) (any, error) {
	v, err := n.x.eval(env)
	if err != nil {
		return nil, err
	}
	if n.op == "!" {
		return !truthy(v), nil
	}
	f, err := num(v)
	if err != nil {
		return nil, err
	}
	if n.op == "-" {
		return -f, nil
	}
	return f, nil
}

type condNode struct{ c, a, b node }

func (n *condNode) eval(env Env) (any, error) {
	c, err := n.c.eval(env)
	if err != nil {
		return nil, err
	}
	if truthy(c) {
		return n.a.eval(env)
	}
	return n.b.eval(env)
}

type binNode struct {
	op   string
	l, r node
}

func (n *binNode) eval(env Env) (any, error) {
	l, err := n.l.eval(env)
	if err != nil {
		return nil, err
	}
	switch n.op { // short-circuit
	case "&&":
		if !truthy(l) {
			return false, nil
		}
		r, err := n.r.eval(env)
		return err == nil && truthy(r), err
	case "||":
		if truthy(l) {
			return true, nil
		}
		r, err := n.r.eval(env)
		return err == nil && truthy(r), err
	}
	r, err := n.r.eval(env)
	if err != nil {
		return nil, err
	}
	if n.op == "==" || n.op == "!=" {
		eq := equal(l, r)
		return eq == (n.op == "=="), nil
	}
	ls, lok := l.(string)
	rs, rok := r.(string)
	if lok && rok {
		switch n.op {
		case "+":
			return ls + rs, nil
		case "<":
			return ls < rs, nil
		case "<=":
			return ls <= rs, nil
		case ">":
			return ls > rs, nil
		case ">=":
			return ls >= rs, nil
		}
	}
	a, err := num(l)
	if err != nil {
		return nil, err
	}
	b, err := num(r)
	if err != nil {
		return nil, err
	}
	switch n.op {
	case "+":
		return a + b, nil
	case "-":
		return a - b, nil
	case "*":
		return a * b, nil
	case "/":
		if b == 0 {
			return nil, errors.New("division by zero")
		}
		return a / b, nil
	case "%":
		if b == 0 {
			return nil, errors.New("division by zero")
		}
		return math.Mod(a, b), nil
	case "<":
		return a < b, nil
	case "<=":
		return a <= b, nil
	case ">":
		return a > b, nil
	case ">=":
		return a >= b, nil
	}
	return nil, fmt.Errorf("unknown operator %s", n.op)
}

func equal(l, r any) bool {
	if ls, ok := l.(string); ok {
		rs, ok := r.(string)
		return ok && ls == rs
	}
	if _, ok := r.(string); ok {
		return false
	}
	a, err1 := num(l)
	b, err2 := num(r)
	return err1 == nil && err2 == nil && a == b
}

// ---- functions ----

type funcSpec struct {
	min, max int // max -1 = variadic
	fn       func(args []any) (any, error)
	lazy     bool // if(): only the chosen branch is evaluated
}

func (s funcSpec) arity() string {
	switch {
	case s.max < 0:
		return fmt.Sprintf("at least %d arguments", s.min)
	case s.min == s.max:
		return fmt.Sprintf("%d argument(s)", s.min)
	default:
		return fmt.Sprintf("%d to %d arguments", s.min, s.max)
	}
}

func num1(f func(float64) float64) funcSpec {
	return funcSpec{min: 1, max: 1, fn: func(a []any) (any, error) {
		x, err := num(a[0])
		if err != nil {
			return nil, err
		}
		return f(x), nil
	}}
}

var funcs map[string]funcSpec

// FuncNames lists the available functions (for help texts).
const FuncNames = "abs, min, max, round, floor, ceil, sqrt, pow, if, between, bit, has"

func init() {
	funcs = map[string]funcSpec{
		"abs":   num1(math.Abs),
		"floor": num1(math.Floor),
		"ceil":  num1(math.Ceil),
		"sqrt":  num1(math.Sqrt),
		"min":   {min: 1, max: -1, fn: fold(math.Min)},
		"max":   {min: 1, max: -1, fn: fold(math.Max)},
		"round": {min: 1, max: 2, fn: func(a []any) (any, error) {
			x, err := num(a[0])
			if err != nil {
				return nil, err
			}
			d := 0.0
			if len(a) == 2 {
				if d, err = num(a[1]); err != nil {
					return nil, err
				}
			}
			p := math.Pow(10, math.Max(0, math.Min(9, math.Round(d))))
			return math.Round(x*p) / p, nil
		}},
		"pow": {min: 2, max: 2, fn: func(a []any) (any, error) {
			x, err := num(a[0])
			if err != nil {
				return nil, err
			}
			y, err := num(a[1])
			if err != nil {
				return nil, err
			}
			return math.Pow(x, y), nil
		}},
		"between": {min: 3, max: 3, fn: func(a []any) (any, error) {
			var f [3]float64
			for i := range f {
				x, err := num(a[i])
				if err != nil {
					return nil, err
				}
				f[i] = x
			}
			return f[0] >= f[1] && f[0] <= f[2], nil
		}},
		"bit": {min: 2, max: 2, fn: func(a []any) (any, error) {
			x, err := num(a[0])
			if err != nil {
				return nil, err
			}
			n, err := num(a[1])
			if err != nil {
				return nil, err
			}
			if n < 0 || n > 63 {
				return nil, errors.New("bit() position must be 0..63")
			}
			return (uint64(x)>>uint(n))&1 == 1, nil
		}},
		"if":  {min: 3, max: 3, lazy: true},
		"has": {min: 1, max: 1},
	}
}

func fold(f func(a, b float64) float64) func([]any) (any, error) {
	return func(a []any) (any, error) {
		acc, err := num(a[0])
		if err != nil {
			return nil, err
		}
		for _, v := range a[1:] {
			x, err := num(v)
			if err != nil {
				return nil, err
			}
			acc = f(acc, x)
		}
		return acc, nil
	}
}

type callNode struct {
	fn   string
	args []node
	spec funcSpec
}

func (n *callNode) eval(env Env) (any, error) {
	if n.spec.lazy { // if(cond, a, b)
		c, err := n.args[0].eval(env)
		if err != nil {
			return nil, err
		}
		if truthy(c) {
			return n.args[1].eval(env)
		}
		return n.args[2].eval(env)
	}
	vals := make([]any, len(n.args))
	for i, a := range n.args {
		v, err := a.eval(env)
		if err != nil {
			return nil, err
		}
		vals[i] = v
	}
	return n.spec.fn(vals)
}

// ---- values ----

// normalize maps attribute values (decoded JSON, protocol integers) to
// float64, bool or string.
func normalize(v any) any {
	switch x := v.(type) {
	case float64, bool, string:
		return x
	case float32:
		return float64(x)
	case int:
		return float64(x)
	case int8:
		return float64(x)
	case int16:
		return float64(x)
	case int32:
		return float64(x)
	case int64:
		return float64(x)
	case uint:
		return float64(x)
	case uint8:
		return float64(x)
	case uint16:
		return float64(x)
	case uint32:
		return float64(x)
	case uint64:
		return float64(x)
	case interface{ Float64() (float64, error) }: // json.Number
		if f, err := x.Float64(); err == nil {
			return f
		}
	}
	return fmt.Sprint(v)
}

func num(v any) (float64, error) {
	switch x := v.(type) {
	case float64:
		return x, nil
	case bool:
		if x {
			return 1, nil
		}
		return 0, nil
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		if err != nil {
			return 0, fmt.Errorf("%q is not a number", x)
		}
		return f, nil
	}
	return 0, fmt.Errorf("%v is not a number", v)
}

func truthy(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case float64:
		return x != 0 && !math.IsNaN(x)
	case string:
		return x != "" && x != "0" && !strings.EqualFold(x, "false")
	}
	return v != nil
}

// Number converts a result to a finite float64.
func Number(v any) (float64, bool) {
	f, err := num(v)
	return f, err == nil && !math.IsNaN(f) && !math.IsInf(f, 0)
}
