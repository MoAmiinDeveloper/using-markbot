package expr

import (
	"errors"
	"testing"
)

func env(m map[string]any) Env {
	return func(k string) (any, bool) { v, ok := m[k]; return v, ok }
}

func TestEval(t *testing.T) {
	vars := map[string]any{"io9": uint64(4200), "speed": 82.0, "ignition": true, "power": 11.2,
		"in2": false, "name": "abc", "io1": int64(5)}
	cases := []struct {
		src  string
		want any
	}{
		{"io9 / 1000 * 2.5", 10.5},
		{"ignition && speed > 80 && power < 11.5", true},
		{"ignition and not in2", true},
		{"if(in2, 'open', 'closed')", "closed"},
		{"in2 ? 1 : 2", 2.0},
		{"round(10/3, 2)", 3.33},
		{"bit(io1, 0) && !bit(io1, 1) && bit(io1, 2)", true},
		{"max(1, io1, 3) + min(4, 2)", 7.0},
		{"between(speed, 80, 90)", true},
		{"has(io9) && !has(io999)", true},
		{"name == \"abc\"", true},
		{"-speed + 2 * 3", -76.0},
		{"ignition + 1", 2.0},
		{"0x10 + 1e2", 116.0},
		{"io999 > 1 || true", nil}, // missing value errors
		{"false && io999 > 1", false},
	}
	for _, c := range cases {
		e, err := Compile(c.src)
		if err != nil {
			t.Fatalf("%s: %v", c.src, err)
		}
		got, err := e.Eval(env(vars))
		if c.want == nil {
			if !errors.Is(err, ErrMissing) {
				t.Errorf("%s: want ErrMissing, got %v %v", c.src, got, err)
			}
			continue
		}
		if err != nil || got != c.want {
			t.Errorf("%s = %v (%T), %v; want %v", c.src, got, got, err, c.want)
		}
	}
}

func TestCompileErrors(t *testing.T) {
	for _, src := range []string{"", "1 +", "speed = 5", "foo(1)", "(1", "has(1)", "round()", "1 2", "'abc"} {
		if _, err := Compile(src); err == nil {
			t.Errorf("%q: expected error", src)
		}
	}
	e, _ := Compile("speed > limit && speed > 5")
	if v := e.Vars(); len(v) != 2 || v[0] != "speed" || v[1] != "limit" {
		t.Fatalf("vars %v", v)
	}
}
