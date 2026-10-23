package api

import (
	"net/http"
	"strconv"

	"github.com/moamiindeveloper/fleet/server/internal/reports"
	"github.com/moamiindeveloper/fleet/server/internal/store"
)

// handleDashboard serves GET /dashboard?days=7&tz=.
func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	days := 7
	if v := r.URL.Query().Get("days"); v != "" {
		var err error
		if days, err = strconv.Atoi(v); err != nil || days < 1 || days > reports.MaxDashboardDays {
			writeError(w, http.StatusBadRequest, "days must be between 1 and 93")
			return
		}
	}
	loc, err := location(r)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	all, scope := s.deviceScope(r)
	var devs []store.Device
	for _, d := range s.store.Devices() {
		if all || scope[d.ID] {
			devs = append(devs, d)
		}
	}
	d, err := s.cfg.Reports.Dashboard(r.Context(), reports.DashboardRequest{Devices: devs, All: all, Scope: scope,
		Days: days, Loc: loc})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}
