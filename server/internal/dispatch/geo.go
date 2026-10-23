package dispatch

import "math"

const earthRadius = 6_371_000.0 // m

// project maps lng/lat to local planar meters around lat0 (equirectangular),
// accurate enough for corridor-sized distances.
func project(p [2]float64, lat0 float64) (x, y float64) {
	k := math.Pi / 180 * earthRadius
	return p[0] * k * math.Cos(lat0*math.Pi/180), p[1] * k
}

// segmentDistance is the distance in meters from p to segment ab ([lng, lat]).
func segmentDistance(p, a, b [2]float64) float64 {
	lat0 := p[1]
	px, py := project(p, lat0)
	ax, ay := project(a, lat0)
	bx, by := project(b, lat0)
	dx, dy := bx-ax, by-ay
	t := 0.0
	if l2 := dx*dx + dy*dy; l2 > 0 {
		t = math.Max(0, math.Min(1, ((px-ax)*dx+(py-ay)*dy)/l2))
	}
	cx, cy := ax+t*dx, ay+t*dy
	return math.Hypot(px-cx, py-cy)
}

// DistanceToPath returns the distance in meters from p ([lng, lat]) to the
// polyline path.
func DistanceToPath(p [2]float64, path [][2]float64) float64 {
	switch len(path) {
	case 0:
		return math.Inf(1)
	case 1:
		return segmentDistance(p, path[0], path[0])
	}
	best := math.Inf(1)
	for i := 1; i < len(path); i++ {
		best = math.Min(best, segmentDistance(p, path[i-1], path[i]))
	}
	return best
}

// Simplify reduces a polyline ([lng, lat] points) with the Douglas-Peucker
// algorithm: points closer than tolerance meters to the simplified line are
// dropped. The first and last points are kept.
func Simplify(path [][2]float64, tolerance float64) [][2]float64 {
	if len(path) < 3 {
		return append([][2]float64(nil), path...)
	}
	keep := make([]bool, len(path))
	keep[0], keep[len(path)-1] = true, true
	type span struct{ a, b int }
	stack := []span{{0, len(path) - 1}}
	for len(stack) > 0 {
		sp := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		maxD, idx := -1.0, -1
		for i := sp.a + 1; i < sp.b; i++ {
			if d := segmentDistance(path[i], path[sp.a], path[sp.b]); d > maxD {
				maxD, idx = d, i
			}
		}
		if idx >= 0 && maxD > tolerance {
			keep[idx] = true
			stack = append(stack, span{sp.a, idx}, span{idx, sp.b})
		}
	}
	out := make([][2]float64, 0, len(path))
	for i, k := range keep {
		if k {
			out = append(out, path[i])
		}
	}
	return out
}
